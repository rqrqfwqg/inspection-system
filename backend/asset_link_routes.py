"""资产可视化 × 数据表管理 · 联动与关联（画像只读 + 关联写入）

挂载前缀：/assets/link
（main.py 的 api_router(prefix="/ops/api") + 本 router(prefix="/assets/link") → /ops/api/assets/link）

为什么需要这个模块
------------------
改造前「资产可视化」给人「像死数据」的感觉，根因有三层：
  1) 可视化侧只消费了 /search 的一小部分字段，且类型契约停留在旧版（`device`/`relations`），
     后端早已换成 `target`/`nodes`/`edges`/`groups`/`profile`/`power_chain` ——
     于是设备详情里「基础信息」「关联设备」读到的永远是 undefined。
  2) 后端已算好的 `groups`（子系统 → 资料表 → records）等联动数据，可视化侧一个都没渲染。
  3) 「资料配置」把字段列表写死传空数组，且没有任何数据画像，配置页看不到真实数据。

本模块补齐「资料表 ↔ 设备 ↔ 关联」这条链路的**全局口径**，供概览页 / 数据表管理 / 资料配置 /
联动中心共用：

  只读画像
    GET  /assets/link/overview          全局联动画像（总量 + 子系统×资料表 + 关系分布 + 未解析）
    GET  /assets/link/table/{tid}       单表画像（覆盖率 + 字段填充率 + 未解析 TOP）
    GET  /assets/link/device/{code}     单设备联动总览（资料记录 + 关联边 + 供电链 + 来源标注）

  关联自动化
    GET  /assets/link/auto-rules        自动关联规则清单 + 各规则候选规模（预览，不写库）
    POST /assets/link/auto-associate    执行自动关联（写 meta.source="auto"；支持 dry_run）

  人工关联（桌面 + 小程序共用）
    GET  /assets/link/manual-queue      待人工关联队列（未解析编号 + 候选建议）
    POST /assets/link/manual-associate  人工建边（写 meta.source="manual"）

口径（重要，勿随手改）
--------------------
- **解析命中** = `records.device_code` 能在 `devices.device_code` 或 `rooms.code` 找到对应行；
  两者同时命中时按 devices 优先（设备是主对象）。
- **未解析 ≠ 错误**：图纸提取类资料（`elec_dwg`）的关联键是图元 / 回路编号，
  本就不对应台账设备。故本模块只**如实呈现**规模与 TOP 编号，不做「数据质量报错」定性。
- 聚合一律用 **「取回 (table_id, device_code) 轻量元组 → Python 内计数」**，
  **不用 SQL JOIN**：`devices.device_code` 不保证唯一，JOIN 会扇出导致计数虚高。
- 关联来源区分（用户要求）：
    `manual` = 人工建立（桌面建边 / 小程序现场建边 / 历史脚本导入，无 meta 标记的按此归类）
    `auto`   = 规则引擎产出，meta 里带 `source/rule/confidence/evidence`，**可解释、可回滚**
  自动关联**只做确定性编号等值匹配**（实测可解析），绝不做模糊猜测；
  两端的**自环候选**（同一编号同时在电柜表与配电箱表，实测 14 例）单独上报并剔除。

自动关联的真实数据基础（2026-09-15 线上实测，勿凭想象加规则）
-----------------------------------------------------------
- `records.device_code` → `devices`：16982 条记录中 **7954 条**命中（19 张表近 100%）→ 走 coverage 呈现。
- `records.device_code` → `rooms`：**517 条**命中房间码。
- **电柜清单（584 条）与资产台账（devices）同号数 = 0** —— `G-` 体系与台账编号不同构，
  因此「电柜 → 上级电柜」**无法**靠编号直接连；
- 但**回路号是跨表钥匙**：`elec_box_circuit.upstream_circuits` ↔ `power_cabinets.branch_control_*`
  可互解（563/584），图纸 `elec_circuit.circuit_code` ↔ 电柜 branch_control **257/265 互验命中**。
  → 这两条即 R1 / R2 自动关联规则的依据，规则产出的边**两端都在资料域内**（非台账设备），
    故带 `meta.domain="records"` 标记，前端单独分组展示。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import json
from sqlalchemy.orm import Session
from sqlalchemy import func, text as sa_text
from typing import Dict, List, Any, Optional, Set, Tuple

from database import (
    get_db, User, Device, Room, Subsystem, DataTable, FieldDef, Record,
    DeviceRelation, RelationType,
)
from dependencies import get_current_user as _get_current_user
from asset_routes import RELATION_CODE_LABEL

router = APIRouter(prefix="/assets/link", tags=["asset-link"])

_UNRESOLVED_TOP = 20
_UNRESOLVED_SAMPLE_PER_TABLE = 12
_MANUAL_QUEUE_LIMIT = 120
_MANUAL_SUGGEST = 3
_AUTO_BATCH = 800          # 单次写入上限，防一次请求写爆
_AUTO_MIN_EVIDENCE = 1

# 自动关联：受控关系类型（用 relation_types 的 label，勿写裸文本）
_REL_PARENT_DIST = RELATION_CODE_LABEL["parent_dist"]        # 上级配电
_REL_LOCATE = RELATION_CODE_LABEL["locate_in_room"]          # 所在机房


# =====================================================================
# 内部工具
# =====================================================================

def _resolvable_codesets(db: Session) -> Tuple[Set[str], Set[str]]:
    """可解析编号集合：(devices.device_code, rooms.code)。

    不过滤 is_active —— 软删设备依然是一次真实登记；是否活跃在别处另行呈现。
    返回的是 **upper 归一键**（比较用），原值另存。
    """
    dev = {c for (c,) in db.query(Device.device_code).all() if c}
    room = {c for (c,) in db.query(Room.code).all() if c}
    return dev, room


def _classify(code: Any, dev: Set[str], room: Set[str]) -> str:
    """单条记录的关联键归属：empty / device / room / none。"""
    c = (code or "").strip()
    if not c:
        return "empty"
    if c in dev:
        return "device"
    if c in room:
        return "room"
    return "none"


def _relation_kind_map(db: Session) -> Dict[str, str]:
    """relation_type（存中文 label）→ kind。字典缺失时按关键字兜底。"""
    m = {label: kind for label, kind in db.query(RelationType.label, RelationType.kind).all() if label}
    return m


def _guess_kind(label: str) -> str:
    if not label:
        return "other"
    if "供" in label or "配电" in label or "取电" in label:
        return "power"
    if "冷" in label:
        return "cooling"
    if "机房" in label or "位置" in label or "所在" in label:
        return "locate"
    if "控制" in label:
        return "control"
    if "信号" in label:
        return "signal"
    if "管" in label:
        return "pipe"
    if "网络" in label or "光纤" in label:
        return "network"
    return "other"


def _pct(n: int, d: int) -> float:
    return round(n / d, 4) if d else 0.0


_UNICODE_SPLIT = "、，,；;：:／/|｜\n\r\t 　"

# 归一键：去空白 + 全角转半角 + 大写 + 去 -_./ 分隔符（与 asset_code_match.normalize_code
# 的 loose 形态同口径，但此处独立实现以避免本模块与匹配内核耦合）。
def _norm_key(s: Any) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKC", str(s or "")).strip()
    t = "".join(t.split()).upper()
    for ch in "-_./":
        t = t.replace(ch, "")
    return t


def _multi_codes(v: Any) -> List[str]:
    """多值单元格 → 编号列表。'5SN4-1、2N1-1' → ['5SN4-1','2N1-1']。"""
    if v is None:
        return []
    raw = str(v)
    for sep in _UNICODE_SPLIT:
        raw = raw.replace(sep, "|")
    return [p.strip() for p in raw.split("|") if p.strip()]


def _rel_source(rel: DeviceRelation) -> Dict[str, Any]:
    """关联边来源标注：auto=规则引擎产出 / manual=人工（含历史导入，无标记）。

    meta 结构（自动关联写入）：
      {"source":"auto", "rule":"cabinet_box", "confidence":0.95,
       "domain":"records", "evidence":"回路 5SN4-1 命中电柜 G-1D2APwb1a", "batch":"2026-09-15T..."}
    """
    meta = rel.meta if isinstance(rel.meta, dict) else {}
    src = str(meta.get("source") or "").strip().lower()
    is_auto = src == "auto"
    return {
        "source": "auto" if is_auto else "manual",
        "source_label": "自动关联" if is_auto else "人工关联",
        "rule": meta.get("rule") if is_auto else None,
        "confidence": meta.get("confidence") if is_auto else None,
        "evidence": meta.get("evidence") if is_auto else None,
        "domain": meta.get("domain") if is_auto else None,
        "batch": meta.get("batch") if is_auto else None,
    }


def _endpoint_index(db: Session) -> Dict[str, Dict[str, Any]]:
    """归一编号 → 端点信息（device/room/record）。

    record 端点：既非设备也非房间、但确实出现在 records.device_code 里的编号
    （如电柜 `G-1D1AL`、图纸回路 `1N1-1`）——自动关联的两端常落在这里。
    """
    idx: Dict[str, Dict[str, Any]] = {}
    for code, name, sub in db.query(Device.device_code, Device.name, Device.subsystem_id).all():
        if not code:
            continue
        idx.setdefault(_norm_key(code), {"kind": "device", "code": code, "name": name, "subsystem_id": sub})
    for code, name in db.query(Room.code, Room.name).all():
        if not code:
            continue
        idx.setdefault(_norm_key(code), {"kind": "room", "code": code, "name": name})
    for (code,) in db.query(Record.device_code).distinct().all():
        if not code:
            continue
        idx.setdefault(_norm_key(code), {"kind": "record", "code": code, "name": None})
    return idx


# =====================================================================
# 自动关联规则
# =====================================================================

def _rule_circuit_links(db: Session) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]]]:
    """构建回路号索引（R1/R2 共用的核心）。

    Returns:
      cabinet_by_circuit: {回路归一键: {cabinet_code, circuit, field}}   ← 电柜的主/备控制（抽屉柜）回路
      boxes_by_circuit:   {回路归一键: [{box_code, field}, ...]}         ← 配电箱的上级回路
    """
    t_ids = dict(db.query(DataTable.code, DataTable.id).all())
    pc_tid = t_ids.get("power_cabinets")
    bc_tid = t_ids.get("elec_box_circuit")

    cabinet_by_circuit: Dict[str, Dict[str, Any]] = {}
    boxes_by_circuit: Dict[str, List[Dict[str, Any]]] = {}

    if pc_tid:
        for code, data in db.query(Record.device_code, Record.data).filter(Record.table_id == pc_tid).all():
            d = data or {}
            for field in ("branch_control_primary", "branch_control_backup"):
                for token in _multi_codes(d.get(field)):
                    k = _norm_key(token)
                    if k and k not in cabinet_by_circuit:
                        cabinet_by_circuit[k] = {"cabinet_code": code, "circuit": token, "field": field}

    if bc_tid:
        for code, data in db.query(Record.device_code, Record.data).filter(Record.table_id == bc_tid).all():
            d = data or {}
            for token in _multi_codes(d.get("upstream_circuits")):
                k = _norm_key(token)
                if k:
                    boxes_by_circuit.setdefault(k, []).append({"box_code": code, "circuit": token})

    return cabinet_by_circuit, boxes_by_circuit


def _auto_candidates(db: Session, rule_ids: Optional[List[str]] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """按规则生成候选关联边（**纯计算，不写库**）。

    Returns:
      (cands, skipped_self)
      - cands: 每条为 {rule, relation_type, from_code, to_code, confidence, evidence, domain}
      - skipped_self: 因两端同号被剔除的候选（线上实测存在 —— 同一编号既在电柜表
        又在配电箱表，如 `WP-2D4ALE`；这类"自己连自己"无意义，单列上报而非静默丢弃）
    """
    want = set(rule_ids) if rule_ids else None
    out: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    emitted: Set[Tuple[str, str, str]] = set()

    def emit(c: Dict[str, Any]) -> None:
        """去重 + 剔自环：同一 (起点, 终点, 类型) 只留一条。"""
        key = (_norm_key(c["from_code"]), _norm_key(c["to_code"]), c["relation_type"])
        if key in emitted:
            return
        emitted.add(key)
        if key[0] == key[1]:
            skipped.append(c)
        else:
            out.append(c)

    # ---------- R1: 配电箱 ← 上级抽屉柜（回路号跨表等值） ----------
    if want is None or "cabinet_box" in want:
        cabinet_by_circuit, boxes_by_circuit = _rule_circuit_links(db)
        for k, boxes in boxes_by_circuit.items():
            cab = cabinet_by_circuit.get(k)
            if not cab:
                continue
            for b in boxes:
                emit({
                    "rule": "cabinet_box",
                    "relation_type": _REL_PARENT_DIST,
                    "from_code": cab["cabinet_code"],
                    "to_code": b["box_code"],
                    "confidence": 0.95,
                    "domain": "records",
                    "evidence": f"回路 {cab['circuit']} 同时出现在电柜 {cab['cabinet_code']}"
                                f"（{cab['field']}）与配电箱 {b['box_code']}（上级回路）",
                })

    # ---------- R2: 图纸回路 → 电柜（回路编号 ≡ branch_control，同源可互验） ----------
    if want is None or "circuit_cabinet" in want:
        t_ids = dict(db.query(DataTable.code, DataTable.id).all())
        cc_tid = t_ids.get("elec_circuit")
        pc_tid = t_ids.get("power_cabinets")
        if cc_tid and pc_tid:
            # 预构建「电柜归一回路键 → 电柜编号」索引，避免 O(回路×电柜) 的重复归一开销
            pack: Dict[str, Tuple[str, str]] = {}
            for code, data in db.query(Record.device_code, Record.data).filter(
                Record.table_id == pc_tid
            ).all():
                cd = data or {}
                for label, val in (("主用", cd.get("branch_control_primary")),
                                   ("备用", cd.get("branch_control_backup"))):
                    for token in _multi_codes(val):
                        pack.setdefault(_norm_key(token), (str(code), label))
            for circ_code, data in db.query(Record.device_code, Record.data).filter(
                Record.table_id == cc_tid
            ).all():
                cc = (data or {}).get("circuit_code") or circ_code
                k = _norm_key(cc)
                if not k:
                    continue
                hit = pack.get(k)
                if not hit:
                    continue
                cab_code, which = hit
                emit({
                    "rule": "circuit_cabinet",
                    "relation_type": _REL_PARENT_DIST,
                    "from_code": str(cc),
                    "to_code": cab_code,
                    "confidence": 0.9,
                    "domain": "records",
                    "evidence": f"图纸回路 {cc} 与电柜 {cab_code} 的{which}控制回路一致",
                })
    return out, skipped


def _auto_dedup_and_filter(db: Session, cands: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """剔除已存在的边（from/to/type 三元组，含人工建的同向边），返回 (待建, 已存在数)。"""
    existing = {
        (_norm_key(f), _norm_key(t), (rt or ""))
        for f, t, rt in db.query(
            DeviceRelation.from_code, DeviceRelation.to_code, DeviceRelation.relation_type
        ).all()
    }
    fresh: List[Dict[str, Any]] = []
    dup = 0
    seen_self: Set[Tuple[str, str, str]] = set()
    for c in cands:
        f, t = str(c["from_code"]), str(c["to_code"])
        if not f or not t or _norm_key(f) == _norm_key(t):
            dup += 1
            continue
        key = (_norm_key(f), _norm_key(t), c["relation_type"])
        if key in existing or key in seen_self:
            dup += 1
            continue
        seen_self.add(key)
        fresh.append(c)
    return fresh, dup


class AutoAssociateBody(BaseModel):
    rule_ids: Optional[List[str]] = None
    dry_run: bool = False
    limit: int = _AUTO_BATCH


@router.get("/auto-rules")
def auto_rules(db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """自动关联规则清单 + 各规则候选规模（**预览，不写库**）。

    规则只做确定性编号等值匹配，每条候选都带 evidence（可解释）。
    """
    cands, skipped_self = _auto_candidates(db)
    fresh, dup = _auto_dedup_and_filter(db, cands)

    rules_meta = [
        {
            "id": "cabinet_box",
            "name": "配电箱 ← 上级抽屉柜",
            "relation_type": _REL_PARENT_DIST,
            "kind": "power",
            "basis": "回路号跨表等值：电柜 branch_control_primary/backup ↔ 配电箱 upstream_circuits",
            "domain": "records",
        },
        {
            "id": "circuit_cabinet",
            "name": "图纸回路 → 电柜",
            "relation_type": _REL_PARENT_DIST,
            "kind": "power",
            "basis": "回路编号同源：图纸 elec_circuit.circuit_code ↔ 电柜 branch_control_*",
            "domain": "records",
        },
    ]
    for r in rules_meta:
        rs = [c for c in cands if c["rule"] == r["id"]]
        fs = [c for c in fresh if c["rule"] == r["id"]]
        r["candidates"] = len(rs)
        r["pending"] = len(fs)
        r["already_linked"] = len(rs) - len(fs)

    by_source = _relation_source_counts(db)
    return {
        "rules": rules_meta,
        "total_candidates": len(cands),
        "total_pending": len(fresh),
        "already_linked": dup,
        "skipped_self_loop": len(skipped_self),
        "skipped_sample": [
            {"from_code": s["from_code"], "to_code": s["to_code"], "rule": s["rule"],
             "reason": "同一编号在电柜表与配电箱表中同时存在，构成自环"}
            for s in skipped_self[:5]
        ],
        "existing_relations": by_source,
        "note": "候选为确定性等值匹配结果；执行后写入 meta.source=auto，可随时按 batch 回滚。",
    }


@router.post("/auto-associate")
def auto_associate(
    body: AutoAssociateBody,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """执行自动关联（幂等：已存在的边自动跳过）。

    - `dry_run=true` 只返回将要写入的清单，不落库；
    - 写入的边带 `meta.source="auto"` + `rule` + `confidence` + `evidence` + `batch`，
      前端可据此与人工关联区分，并可整批回滚（DELETE /auto-associate?batch=）。
    """
    import datetime as _dt

    cands, skipped_self = _auto_candidates(db, body.rule_ids)
    fresh, dup = _auto_dedup_and_filter(db, cands)
    limit = max(1, min(int(body.limit or _AUTO_BATCH), 5000))
    todo = fresh[:limit]

    if body.dry_run:
        return {
            "dry_run": True,
            "would_create": len(todo),
            "pending_total": len(fresh),
            "already_linked": dup,
            "skipped_self_loop": len(skipped_self),
            "sample": todo[:20],
        }

    batch = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    created = 0
    for c in todo:
        db.add(DeviceRelation(
            from_code=c["from_code"], to_code=c["to_code"], relation_type=c["relation_type"],
            subsystem_id=None,
            meta={
                "source": "auto", "rule": c["rule"], "confidence": c["confidence"],
                "domain": c["domain"], "evidence": c["evidence"], "batch": batch,
            },
        ))
        created += 1
    db.commit()

    return {
        "dry_run": False,
        "batch": batch,
        "created": created,
        "pending_left": max(0, len(fresh) - created),
        "already_linked": dup,
        "skipped_self_loop": len(skipped_self),
        "by_rule": _count_by(todo, "rule"),
        "by_type": _count_by(todo, "relation_type"),
        "rollback_hint": f"DELETE /ops/api/assets/link/auto-associate?batch={batch} 可整批撤销",
    }


@router.delete("/auto-associate")
def auto_associate_rollback(
    batch: Optional[str] = None,
    rule: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """按批次 / 规则回滚自动关联（**只删 auto**，绝不误删人工关联）。"""
    q = db.query(DeviceRelation)
    rows = [r for r in q.all() if _rel_source(r)["source"] == "auto"]
    targets = []
    for r in rows:
        meta = r.meta if isinstance(r.meta, dict) else {}
        if batch and str(meta.get("batch")) != batch:
            continue
        if rule and str(meta.get("rule")) != rule:
            continue
        targets.append(r)
    for r in targets:
        db.delete(r)
    db.commit()
    return {"deleted": len(targets), "batch": batch, "rule": rule}


def _count_by(rows: List[Dict[str, Any]], key: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        k = str(r.get(key))
        out[k] = out.get(k, 0) + 1
    return out


def _relation_source_counts(db: Session) -> Dict[str, Any]:
    """关联边按来源统计（auto / manual），并给出未标注的历史边数。"""
    total = auto = manual = unmarked = 0
    by_type_auto: Dict[str, int] = {}
    by_rule: Dict[str, int] = {}
    for r in db.query(DeviceRelation).all():
        total += 1
        meta = r.meta if isinstance(r.meta, dict) else {}
        if str(meta.get("source") or "").lower() == "auto":
            auto += 1
            t = r.relation_type or "关联"
            by_type_auto[t] = by_type_auto.get(t, 0) + 1
            rl = str(meta.get("rule") or "unknown")
            by_rule[rl] = by_rule.get(rl, 0) + 1
        else:
            manual += 1
            if not meta:
                unmarked += 1
    return {
        "total": total,
        "auto": auto,
        "manual": manual,
        "unmarked_legacy": unmarked,
        "auto_by_type": by_type_auto,
        "auto_by_rule": by_rule,
    }


# =====================================================================
# 人工关联（桌面 + 小程序共用）
# =====================================================================

class ManualAssociateBody(BaseModel):
    from_code: str
    to_code: str
    relation_type: str
    operator: Optional[str] = None        # 操作人（小程序传 openid/手机号后四位）
    note: Optional[str] = None
    source_kind: str = "manual"           # 固定 manual；保留字段便于审计
    meta: Dict[str, Any] = {}


@router.get("/manual-queue")
def manual_queue(
    limit: int = _MANUAL_QUEUE_LIMIT,
    only_table: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """待人工关联队列：**无法自动关联的编号** + 候选建议（供桌面/小程序处理）。

    典型场景（实测）：电柜清单为 `G-` 体系、资产台账为另一套编号，两者同号数为 0，
    无法靠编号自动连接 —— 例如现场扫码确认「这台电柜属于哪台设备」即人工关联。
    """
    dev_codes, room_codes = _resolvable_codesets(db)

    q = db.query(Record.table_id, Record.device_code, Record.data)
    if only_table:
        q = q.filter(Record.table_id == only_table)
    rows = q.all()

    tbls = {t.id: t for t in db.query(DataTable).all()}
    unresolved: Dict[str, Dict[str, Any]] = {}
    for tid, code, data in rows:
        c = (code or "").strip()
        if not c or _classify(c, dev_codes, room_codes) != "none":
            continue
        e = unresolved.setdefault(c, {
            "code": c, "records": 0, "table_ids": set(), "sample": None,
        })
        e["records"] += 1
        e["table_ids"].add(tid)
        if e["sample"] is None:
            d = data or {}
            e["sample"] = {k: v for k, v in list(d.items())[:6] if v not in (None, "")}

    # 候选建议：归一 loos e 等值 → 前缀包含（确定性规则，不做模糊打分猜测）
    dev_all = [(c, n) for c, n in db.query(Device.device_code, Device.name).all() if c]
    room_all = [(c, n) for c, n in db.query(Room.code, Room.name).all() if c]
    dev_keys = [(_norm_key(c), c, n, "device") for c, n in dev_all]
    room_keys = [(_norm_key(c), c, n, "room") for c, n in room_all]

    def suggest(code: str) -> List[Dict[str, Any]]:
        k = _norm_key(code)
        out: List[Dict[str, Any]] = []
        if not k:
            return out
        for pool in (dev_keys, room_keys):
            for kk, raw, name, kind in pool:
                if not kk:
                    continue
                if kk == k:
                    out.append({"code": raw, "name": name, "kind": kind, "score": 1.0,
                                "reason": "归一编号完全一致"})
                elif len(k) >= 5 and (kk.endswith(k) or kk.startswith(k)):
                    out.append({"code": raw, "name": name, "kind": kind, "score": 0.7,
                                "reason": "编号前缀/后缀包含"})
                if len(out) >= _MANUAL_SUGGEST * 3:
                    break
            if len(out) >= _MANUAL_SUGGEST * 3:
                break
        out.sort(key=lambda x: -x["score"])
        return out[:_MANUAL_SUGGEST]

    items = sorted(unresolved.values(), key=lambda x: -x["records"])[: max(1, min(limit, 500))]
    payload = [
        {
            "code": e["code"],
            "records": e["records"],
            "tables": [
                {"table_id": i, "name": tbls[i].name if i in tbls else f"表#{i}",
                 "code": tbls[i].code if i in tbls else None}
                for i in sorted(e["table_ids"])
            ],
            "sample": e["sample"],
            "suggestions": suggest(e["code"]),
        }
        for e in items
    ]
    return {
        "total_unresolved_codes": len(unresolved),
        "returned": len(payload),
        "items": payload,
        "hint": "小程序「扫码关联」可现场扫两端编号直接建边；建边后带 人工关联 标记。",
    }


@router.post("/manual-associate")
def manual_associate(
    body: ManualAssociateBody,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """人工建边（桌面 / 小程序共用）。

    与 `/assets/relations` 的差别：**放宽端点要求** —— 端点可以是设备、机房，
    也可以是资料域编号（如电柜 `G-xxx`）。因为现场实际存在「台账没有、但资料里有」的对象，
    强行要求两端都在 devices 里会让这类关联永远建不起来。
    """
    from_code = (body.from_code or "").strip()
    to_code = (body.to_code or "").strip()
    if not from_code or not to_code:
        raise HTTPException(status_code=400, detail="from_code / to_code 均必填")
    if _norm_key(from_code) == _norm_key(to_code):
        raise HTTPException(status_code=400, detail="不能建立到自身的关联")

    # 关系类型归一：走 asset_routes 的受控字典（label / code / 历史文本都接受）
    from asset_routes import _canonical_relation_label
    rtype = _canonical_relation_label(body.relation_type)

    idx = _endpoint_index(db)
    f_ep = idx.get(_norm_key(from_code))
    t_ep = idx.get(_norm_key(to_code))
    if not f_ep:
        raise HTTPException(status_code=404, detail=f"起点编号在设备台账 / 机房 / 资料记录中均不存在：{from_code}")
    if not t_ep:
        raise HTTPException(status_code=404, detail=f"终点编号在设备台账 / 机房 / 资料记录中均不存在：{to_code}")

    dup = db.query(DeviceRelation).filter(
        DeviceRelation.from_code == from_code, DeviceRelation.to_code == to_code,
        DeviceRelation.relation_type == rtype,
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"相同关联已存在（{from_code} → {to_code} · {rtype}）")

    import datetime as _dt
    meta = dict(body.meta or {})
    meta.update({
        "source": "manual",
        "operator": body.operator or "unknown",
        "note": body.note or "",
        "created_via": "link-center",
        "created_at": _dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "from_kind": f_ep["kind"],
        "to_kind": t_ep["kind"],
    })
    obj = DeviceRelation(from_code=from_code, to_code=to_code, relation_type=rtype, meta=meta)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "success": True,
        "id": obj.id,
        "from": {"code": from_code, "kind": f_ep["kind"], "name": f_ep.get("name")},
        "to": {"code": to_code, "kind": t_ep["kind"], "name": t_ep.get("name")},
        "relation_type": rtype,
        "source": "manual",
    }


# =====================================================================
# 单设备联动总览（抽屉 / 小程序共用）
# =====================================================================

@router.get("/device/{code}")
def device_link(
    code: str,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """单设备联动总览：资料记录（按表分组）+ 关联边（按来源/类型分组）+ 供电链。

    这是「可视化不再像死数据」的直接来源：一次请求把资料表管理里的真实记录、
    关联中心里的真实边、供电上下游全部串起来，且每条边都标注自动/人工。
    """
    dev = db.query(Device).filter(Device.device_code == code).first()
    room = db.query(Room).filter(Room.code == code).first()
    target = dev or room
    if not target:
        raise HTTPException(status_code=404, detail=f"设备/机房不存在：{code}")

    t_ids = dict(db.query(DataTable.id, DataTable.code).all())
    t_names = dict(db.query(DataTable.id, DataTable.name).all())
    subs = {s.id: {"id": s.id, "code": s.code, "name": s.name, "icon": s.icon} for s in db.query(Subsystem).all()}

    # ---- 资料记录（records.device_code == code）----
    recs = db.query(Record).filter(Record.device_code == code).all()
    by_table: Dict[int, List[Dict[str, Any]]] = {}
    for r in recs:
        by_table.setdefault(r.table_id, []).append({
            "id": r.id, "table_id": r.table_id, "device_code": r.device_code,
            "data": r.data or {},
        })
    groups = []
    for tid, items in sorted(by_table.items(), key=lambda x: -len(x[1])):
        t = db.query(DataTable).filter(DataTable.id == tid).first()
        groups.append({
            "table_id": tid, "table_code": t.code if t else None,
            "table_name": t_names.get(tid) or f"表#{tid}",
            "subsystem": subs.get(t.subsystem_id if t else None),
            "records": items,
        })

    # ---- 关联边（双向合并）----
    edges = db.query(DeviceRelation).filter(
        (DeviceRelation.from_code == code) | (DeviceRelation.to_code == code)
    ).order_by(DeviceRelation.id.desc()).all()
    idx = _endpoint_index(db)
    edge_rows = []
    for e in edges:
        other = e.to_code if e.from_code == code else e.from_code
        ep = idx.get(_norm_key(other)) or {"kind": "unknown", "code": other, "name": None}
        src = _rel_source(e)
        edge_rows.append({
            "id": e.id, "from_code": e.from_code, "to_code": e.to_code,
            "other_code": other, "other_kind": ep["kind"], "other_name": ep.get("name"),
            "relation_type": e.relation_type, "kind": _guess_kind(e.relation_type or ""),
            "direction": "out" if e.from_code == code else "in",
            **src,
        })

    auto_edges = [x for x in edge_rows if x["source"] == "auto"]
    manual_edges = [x for x in edge_rows if x["source"] == "manual"]

    return {
        "code": code,
        "kind": "device" if dev else "room",
        "name": (dev.name if dev else room.name),
        "subsystem": subs.get(dev.subsystem_id) if dev else None,
        "building": getattr(target, "building", None),
        "floor": getattr(target, "floor", None),
        "record_count": len(recs),
        "table_count": len(groups),
        "groups": groups,
        "edges": edge_rows,
        "edges_auto": auto_edges,
        "edges_manual": manual_edges,
        "edge_summary": {
            "total": len(edge_rows),
            "auto": len(auto_edges),
            "manual": len(manual_edges),
            "by_type": _count_by(edge_rows, "relation_type"),
        },
    }


# =====================================================================
# 全局联动画像
# =====================================================================

@router.get("/overview")
def link_overview(db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """全局联动画像：一次请求喂饱「概览页」与「数据表管理」的所有统计。

    返回：
      global          总量与总覆盖率 + 关联来源分布（auto/manual）
      subsystems      子系统 → {资料表数, 记录数, 登记设备数, 解析命中, 覆盖率}
      tables          资料表 → {记录数, 解析命中设备/机房, 未解析, 覆盖率, 去重设备数}
      relations       关系类型分布（含 kind，供前端分组配色）
      unresolved_top  未解析关联键 TOP（在 records 出现、但既非设备也非机房编号）
    """
    subs = db.query(Subsystem).order_by(Subsystem.sort_order, Subsystem.id).all()
    # 只统计启用中的表 —— 合表后旧表 is_active=False，不得进入任何计数（表数/记录数/覆盖率）
    tables = db.query(DataTable).filter(DataTable.is_active == True) \
        .order_by(DataTable.sort_order, DataTable.id).all()

    field_cnt = dict(
        db.query(FieldDef.table_id, func.count(FieldDef.id)).group_by(FieldDef.table_id).all()
    )
    rel_key_label: Dict[int, str] = {}
    for tid, label in db.query(FieldDef.table_id, FieldDef.label).filter(
        FieldDef.is_relation_key == True  # noqa: E712
    ).all():
        rel_key_label.setdefault(tid, label)

    dev_codes, room_codes = _resolvable_codesets(db)

    # 一次取回 (table_id, device_code)，Python 内聚合（避免 JOIN 扇出）
    # 同样只取启用表的记录，避免停用表残留记录污染总量/覆盖率
    _active_tids = {t.id for t in tables}
    pairs: List[Tuple[int, Any]] = [
        (tid, code)
        for tid, code in db.query(Record.table_id, Record.device_code).all()
        if tid in _active_tids
    ]

    per_table: Dict[int, Dict[str, Any]] = {}
    unresolved: Dict[str, Dict[str, Any]] = {}

    for tid, code in pairs:
        a = per_table.setdefault(
            tid, {"records": 0, "empty": 0, "hit_dev": 0, "hit_room": 0, "distinct_dev": set()}
        )
        a["records"] += 1
        kind = _classify(code, dev_codes, room_codes)
        if kind == "empty":
            a["empty"] += 1
        elif kind == "device":
            a["hit_dev"] += 1
            a["distinct_dev"].add(str(code).strip())
        elif kind == "room":
            a["hit_room"] += 1
        else:
            e = unresolved.setdefault(
                str(code).strip(), {"code": str(code).strip(), "records": 0, "table_ids": set()}
            )
            e["records"] += 1
            e["table_ids"].add(tid)

    # ---- 资料表维度 ----
    table_rows: List[Dict[str, Any]] = []
    for t in tables:
        a = per_table.get(t.id) or {}
        rec = int(a.get("records", 0))
        hit_dev = int(a.get("hit_dev", 0))
        hit_room = int(a.get("hit_room", 0))
        sub = next((s for s in subs if s.id == t.subsystem_id), None)
        table_rows.append({
            "table_id": t.id,
            "code": t.code,
            "name": t.name,
            "subsystem_id": t.subsystem_id,
            "subsystem_code": sub.code if sub else None,
            "subsystem_name": sub.name if sub else "未归类",
            "relation_key_label": rel_key_label.get(t.id),
            "field_count": int(field_cnt.get(t.id, 0)),
            "records": rec,
            "empty_code": int(a.get("empty", 0)),
            "resolved_devices": hit_dev,
            "resolved_rooms": hit_room,
            "unresolved": rec - hit_dev - hit_room,
            "coverage": _pct(hit_dev + hit_room, rec),
            "distinct_devices": len(a.get("distinct_dev") or ()),
        })

    # ---- 子系统维度 ----
    devices_by_sub = dict(
        db.query(Device.subsystem_id, func.count(Device.id)).group_by(Device.subsystem_id).all()
    )
    sub_rows: List[Dict[str, Any]] = []
    for s in subs:
        ts = [r for r in table_rows if r["subsystem_id"] == s.id]
        rec = sum(r["records"] for r in ts)
        ok = sum(r["resolved_devices"] + r["resolved_rooms"] for r in ts)
        sub_rows.append({
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "icon": s.icon,
            "table_count": len(ts),
            "records": rec,
            "devices": int(devices_by_sub.get(s.id, 0)),
            "resolved": ok,
            "unresolved": rec - ok,
            "coverage": _pct(ok, rec),
        })

    # ---- 全局 ----
    records_total = len(pairs)
    hit_dev_total = sum(r["resolved_devices"] for r in table_rows)
    hit_room_total = sum(r["resolved_rooms"] for r in table_rows)

    rel_kinds = _relation_kind_map(db)
    src_counts = _relation_source_counts(db)
    rel_rows = [
        {"type": rt or "关联", "kind": rel_kinds.get(rt or "关联") or _guess_kind(rt or ""), "count": int(c)}
        for rt, c in db.query(DeviceRelation.relation_type, func.count(DeviceRelation.id))
        .group_by(DeviceRelation.relation_type)
        .order_by(func.count(DeviceRelation.id).desc())
        .all()
    ]

    # ---- 未解析 TOP ----
    tbl_name = {t.id: t.name for t in tables}
    top = sorted(unresolved.values(), key=lambda x: -x["records"])[:_UNRESOLVED_TOP]
    unresolved_top = [
        {
            "code": e["code"],
            "records": e["records"],
            "tables": [tbl_name.get(i) or f"表#{i}" for i in sorted(e["table_ids"])],
        }
        for e in top
    ]

    return {
        "global": {
            "devices": int(db.query(func.count(Device.id)).scalar() or 0),
            "rooms": int(db.query(func.count(Room.id)).scalar() or 0),
            "tables": len(tables),
            "fields": int(
                db.query(func.count(FieldDef.id))
                .filter(FieldDef.table_id.in_(_active_tids))
                .scalar() or 0
            ) if _active_tids else 0,
            "records": records_total,
            "relations": src_counts["total"],
            "relations_auto": src_counts["auto"],
            "relations_manual": src_counts["manual"],
            "relations_unmarked": src_counts["unmarked_legacy"],
            "resolved_devices": hit_dev_total,
            "resolved_rooms": hit_room_total,
            "unresolved": records_total - hit_dev_total - hit_room_total,
            "coverage": _pct(hit_dev_total + hit_room_total, records_total),
            "device_codes_in_records": len({str(c).strip() for _, c in pairs if (c or "").strip()}),
            "unresolved_codes": len(unresolved),
            "resolvable_device_codes": len(dev_codes),
            "resolvable_room_codes": len(room_codes),
        },
        "subsystems": sub_rows,
        "tables": table_rows,
        "relations": rel_rows,
        "relations_by_source": src_counts,
        "unresolved_top": unresolved_top,
    }


# =====================================================================
# 单表联动画像
# =====================================================================

@router.get("/table/{tid}")
def link_table(tid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """单张资料表的联动画像：覆盖率 + 每个字段的真实填充率 + 未解析编号 TOP
    + 该表编号参与了多少关联边（自动 / 人工分列）。

    「字段填充率」回答的是配置侧的真问题：**这个字段到底有没有人在用**。
    填充率长期为 0 的字段即为可清理/待补录对象。
    """
    t = db.query(DataTable).filter(DataTable.id == tid).first()
    if not t:
        raise HTTPException(status_code=404, detail="资料表不存在")

    fields = db.query(FieldDef).filter(FieldDef.table_id == tid).order_by(
        FieldDef.sort_order, FieldDef.id
    ).all()
    recs: List[Tuple[Any, Any]] = db.query(Record.device_code, Record.data).filter(
        Record.table_id == tid
    ).all()

    dev_codes, room_codes = _resolvable_codesets(db)
    sub = db.query(Subsystem).filter(Subsystem.id == t.subsystem_id).first()

    filled: Dict[str, int] = {f.key: 0 for f in fields}
    hit_dev = hit_room = empty = 0
    devs: Set[str] = set()
    unres: Dict[str, int] = {}
    own_codes: Set[str] = set()

    for code, data in recs:
        d = data or {}
        for k in filled:
            v = d.get(k)
            if v is not None and str(v).strip() != "":
                filled[k] += 1
        c = (code or "").strip()
        if c:
            own_codes.add(_norm_key(c))
        kind = _classify(code, dev_codes, room_codes)
        if kind == "empty":
            empty += 1
        elif kind == "device":
            hit_dev += 1
            devs.add(str(code).strip())
        elif kind == "room":
            hit_room += 1
        else:
            unres[c] = unres.get(c, 0) + 1

    # 本表编号参与的关联边（来源分列）
    tbl_edge_auto = tbl_edge_manual = 0
    for r in db.query(DeviceRelation).all():
        if _norm_key(r.from_code) in own_codes or _norm_key(r.to_code) in own_codes:
            if _rel_source(r)["source"] == "auto":
                tbl_edge_auto += 1
            else:
                tbl_edge_manual += 1

    total = len(recs)
    unresolved_top = sorted(
        ({"code": c, "records": n} for c, n in unres.items()), key=lambda x: -x["records"]
    )[:_UNRESOLVED_SAMPLE_PER_TABLE]

    returned = len(fields)
    return {
        "table": {
            "table_id": t.id,
            "code": t.code,
            "name": t.name,
            "subsystem_id": t.subsystem_id,
            "subsystem_code": sub.code if sub else None,
            "subsystem_name": sub.name if sub else "未归类",
        },
        "coverage": {
            "records": total,
            "empty_code": empty,
            "resolved_devices": hit_dev,
            "resolved_rooms": hit_room,
            "unresolved": total - hit_dev - hit_room,
            "coverage": _pct(hit_dev + hit_room, total),
            "distinct_devices": len(devs),
            "unresolved_codes": len(unres),
        },
        "relations": {
            "auto": tbl_edge_auto,
            "manual": tbl_edge_manual,
            "total": tbl_edge_auto + tbl_edge_manual,
            "distinct_codes": len(own_codes),
        },
        "fields": [
            {
                "id": f.id,
                "key": f.key,
                "label": f.label,
                "type": f.type,
                "is_required": bool(f.is_required),
                "is_relation_key": bool(f.is_relation_key),
                "filled": filled.get(f.key, 0),
                "fill_rate": _pct(filled.get(f.key, 0), total),
            }
            for f in fields
        ],
        "unresolved_top": unresolved_top,
        "field_count": returned,
    }


# =====================================================================
# 跨表字段关联（cross-table drill-through，2026-09-15 用户提出）
# =====================================================================
# 场景：在一张资料表选中某条记录，拿它的编号字段值（device_code + 各 *_code /
# is_relation_key 字段）到其他启用资料表里搜索：哪张表命中、命中哪个字段、
# 具体是哪个编号值命中几条 —— 前端「关联」弹窗据此一键跳转。
# 纯只读，不写库；VALUES 经 json_each 展开做等值匹配（兼容目标字段为数组的情况）。

_CROSSREF_MIN_LEN = 2          # 钥匙值最短长度（过滤空串/单字符脏值）
_CROSSREF_VALUE_LIMIT = 5      # 每个命中字段回显的编号样例上限


def _codeish_keys(fields) -> List[Tuple[str, str]]:
    """可作跨表钥匙的字段 (key, label)：is_relation_key 或 key 以 _code 结尾。"""
    out, seen = [], set()
    ordered = sorted(fields, key=lambda x: (0 if x.is_relation_key else 1, x.sort_order or 0))
    for f in ordered:
        if f.key in seen:
            continue
        if f.is_relation_key or f.key == "device_code" or f.key.endswith("_code"):
            seen.add(f.key)
            out.append((f.key, f.label))
    return out


def _cr_match(col_expr: str) -> str:
    """col_expr（标量或 JSON 数组）与 :vals 数组存在等值成员的 SQLite 表达式。"""
    return (
        # 服务器 SQLite 无 json_typeof（3.45.1 Ubuntu 构建缺失，2026-09-15 实测）：
        # 数组判定改用 json_valid + 首字符是否 '['；json_valid 兜底防
        # 「以 [ 开头的普通文本」被 json_each 解析报 malformed JSON。
        "EXISTS (SELECT 1 FROM json_each(:vals) je, "
        "json_each(CASE WHEN json_valid({c}) = 1 "
        "AND substr(CAST({c} AS TEXT), 1, 1) = '[' THEN {c} "
        "ELSE json_array({c}) END) de "
        "WHERE CAST(de.value AS TEXT) = CAST(je.value AS TEXT))"
    ).format(c=col_expr)


@router.get("/crossrefs")
def link_crossrefs(
    table_id: int,
    record_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """跨表字段关联：拿一条记录的编号值到其他启用资料表搜索命中。

    返回 targets: [{table, total, matches: [{field, label, count, values[]}]}]
    按命中数降序；只返回 total>0 的表。纯只读。
    """
    src = db.query(DataTable).filter(DataTable.id == table_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="source table not found")
    rec = db.query(Record).filter(
        Record.table_id == table_id, Record.id == record_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="record not found")

    # ---- 1) 本条记录的钥匙值（去重保序，跳过空/脏值）----
    keys_meta: Dict[str, Dict[str, str]] = {}
    vals: List[str] = []

    def _add(v, key: str, label: str) -> None:
        if isinstance(v, (list, tuple)):
            for x in v:
                _add(x, key, label)
            return
        t = str(v).strip() if v is not None else ""
        if len(t) < _CROSSREF_MIN_LEN or t.lower() in ("none", "null", "-"):
            return
        keys_meta.setdefault(key, {"key": key, "label": label})
        if t not in vals:
            vals.append(t)

    if rec.device_code:
        _add(rec.device_code, "device_code", "关联键")
    for k, lb in _codeish_keys(db.query(FieldDef).filter(FieldDef.table_id == table_id).all()):
        _add((rec.data or {}).get(k), k, lb)

    payload = {
        "record": {
            "id": rec.id, "device_code": rec.device_code,
            "table_id": table_id, "table_name": src.name, "table_code": src.code,
        },
        "keys": [],
        "targets": [],
        "scanned": 0,
    }
    # keys：值 -> 来源字段（一个值可能来自多个字段，取第一个来源）
    val_src: Dict[str, Tuple[str, str]] = {}
    if rec.device_code and str(rec.device_code).strip():
        val_src[str(rec.device_code).strip()] = ("device_code", "关联键")
    for k, lb in _codeish_keys(db.query(FieldDef).filter(FieldDef.table_id == table_id).all()):
        v = (rec.data or {}).get(k)
        items = v if isinstance(v, (list, tuple)) else [v]
        for x in items:
            t = str(x).strip() if x is not None else ""
            if len(t) >= _CROSSREF_MIN_LEN and t.lower() not in ("none", "null", "-") and t not in val_src:
                val_src[t] = (k, lb)
    payload["keys"] = [
        {"key": val_src[v][0], "label": val_src[v][1], "value": v} for v in vals if v in val_src
    ]

    if not vals:
        return payload

    vals_json = json.dumps(vals, ensure_ascii=False)

    # ---- 2) 逐张启用表统计命中 ----
    others = db.query(DataTable).filter(
        DataTable.is_active == True, DataTable.id != table_id).all()
    scanned = 0
    for t in others:
        tfields = db.query(FieldDef).filter(FieldDef.table_id == t.id).all()
        seen, cols = set(), []
        for k, lb in [("device_code", "关联键")] + _codeish_keys(tfields):
            if k in seen:
                continue
            seen.add(k)
            col = ("r.device_code" if k == "device_code"
                   else "json_extract(r.data, '$.%s')" % k)
            cols.append((k, lb, col))
        if not cols:
            continue
        scanned += 1
        cond = " OR ".join("(%s)" % _cr_match(c) for _, _, c in cols)
        sums = ", ".join(
            "SUM(CASE WHEN %s THEN 1 ELSE 0 END) AS c%d" % (_cr_match(c), i)
            for i, (k, lb, c) in enumerate(cols))
        sql = sa_text(
            "SELECT COUNT(*) AS total, %(sums)s "
            "FROM records r JOIN data_tables t ON t.id = r.table_id "
            "WHERE t.is_active = 1 AND t.id = :tid AND (%(cond)s)"
            % {"sums": sums, "cond": cond})
        row = db.execute(sql, {"vals": vals_json, "tid": t.id}).fetchone()
        total = int(row[0] or 0)
        if total <= 0:
            continue
        matches = []
        for i, (k, lb, c) in enumerate(cols):
            n = int(row[i + 1] or 0)
            if n <= 0:
                continue
            # 回显该字段命中的具体编号（本记录钥匙值的交集样例）
            vsql = sa_text(
                "SELECT je.value FROM json_each(:vals) je "
                "WHERE EXISTS (SELECT 1 FROM records r JOIN data_tables t ON t.id = r.table_id "
                "WHERE t.id = :tid AND t.is_active = 1 AND (%(m)s)) LIMIT %(lim)d"
                % {"m": _cr_match(c), "lim": _CROSSREF_VALUE_LIMIT})
            try:
                hit_vals = [str(x[0]) for x in db.execute(
                    vsql, {"vals": vals_json, "tid": t.id}).fetchall()]
            except Exception:
                hit_vals = []
            matches.append({"field": k, "label": lb, "count": n, "values": hit_vals})
        matches.sort(key=lambda m: -m["count"])
        targets.append({
            "table_id": t.id, "code": t.code, "name": t.name,
            "subsystem_id": t.subsystem_id,
            "total": total, "matches": matches,
        })

    targets.sort(key=lambda x: -x["total"])
    payload["targets"] = targets
    payload["scanned"] = scanned
    return payload
