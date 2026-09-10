"""资产总台账 · 设备台账升级（接真实固定资产 / 台账记录）

挂载前缀：/assets（由 main.py 的 api_router(prefix="/ops/api") 拼装为 /ops/api/assets）

背景
----
原「设备台账」页（DeviceLedgerPage）只读 devices 表，有两个致命问题：
  1) devices 的 building/floor/location_desc 几乎全空（线上 7868/7878 无楼栋、7871/7878
     无位置），页面看起来「只有编号、没有内容」；
  2) 真正可读的资产数据在 fixed_assets（7237 条，location / asset_name / brand_model /
     use_dept / owner_unit 均 100% 填充）以及 records（20 张台账表），页面一条都没接。
  另外线上还有 **1099 台设备只存在于台账 records、从未登记进 devices**，原页面直接漏掉。

本模块把「devices ∪ 台账 records ∪ 固定资产」求全集合，合成一张可检索、可筛选、可预警
的总台账，三条只读接口：
  GET /assets/asset-ledger          分页列表（关键字/子系统/区域/使用单位/状态/排序）
  GET /assets/asset-ledger/summary  汇总（规模、金额、区域、子系统、使用单位、保修预警）
  GET /assets/asset-ledger/detail   单设备全字段详情（固定资产 + 档案 + 台账记录 + 关联）

口径说明（重要）
----------------
- 行来源用 `source` 标识：`devices`（已登记）/ `ledger_only`（只在台账，未登记）。
  两条都展示，绝不隐藏——这正是原页面漏数据的地方。
- 区域（area）由「固定资产所在地点 / 设备位置 / 台账反查位置」文本推导，只做确定性命中；
  纯编号式地点按前缀归为「编号区 X」，推不出来就写「未标注」，不猜楼栋。
- 金额一律取含税价 price_tax，单位元。
- 软删除设备（is_active=false）默认不出现，与既有 /devices 行为一致。
- 全量行在进程内缓存 60s（约 9000 行），筛选/分页/排序在内存里做，保证口径一致且翻页秒回。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text
from typing import Optional, List, Dict, Any
import re
import time
from datetime import datetime, date

from database import (
    get_db, User, Device, Subsystem, DataTable, Record, DeviceRelation,
    FixedAsset, DeviceArchive,
)
from dependencies import get_current_user as _get_current_user
from asset_routes import (
    _fa_to_dict, _da_to_dict, _records_profiles, _relation_type_meta,
    _subsystem_name, _canonical_relation_label,
)

router = APIRouter(prefix="/assets", tags=["asset-ledger"])

# 保修即将到期阈值（天）
WARRANTY_SOON_DAYS = 90
# 全量行缓存 TTL（秒）
_ALL_TTL = 60
_ALL_CACHE: Dict[str, Any] = {"key": None, "ts": 0.0, "rows": []}


# ========================= 文本 / 口径工具 =========================

def _norm_ws(v: Any) -> str:
    """压平空白（固定资产「使用单位」存在 '股份公司\\n公共区管理分公司' 这类换行变体）。"""
    return re.sub(r"\s+", " ", str(v or "")).strip()


def _iso_date(v: Any) -> Optional[str]:
    """DATE 列 → 'YYYY-MM-DD'（兼容 sqlite3 返回字符串 / Python date 两种形态）。"""
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    s = str(v).strip()
    return s[:10] if s else None


def _to_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _ledger_area(location: Optional[str], building: Optional[str] = "") -> str:
    """位置文本 → 区域大类（停车楼 / GTC / 市政 / 工作区 / N#楼 / 编号区 X / 未标注）。

    只做确定性命中，推不出来就明说「未标注」，不猜楼栋。
    """
    text = f"{_norm_ws(building)} {_norm_ws(location)}".strip()
    if not text:
        return "未标注"
    if "停车" in text:
        return "停车楼"
    if "污水处理" in text or "市政" in text:
        return "市政"
    if "交通中心" in text or "GTC" in text.upper() or "航站楼" in text:
        return "GTC"
    m = re.search(r"(\d+)\s*#\s*楼", text)
    if m:
        return f"{m.group(1)}#楼"
    if "工作区" in text:
        return "工作区"
    # 纯编号式地点（如 J-1W-RD1-J12 / GE1F-KTJF-101）：按首字母段归组，
    # 明确标注是「编号区」而非真实楼栋，避免误导。
    m = re.match(r"^([A-Za-z]{1,2})\s*[-_]?[A-Za-z0-9]", text)
    if m:
        return f"编号区 {m.group(1).upper()}"
    return "未标注"


def _warranty_state(end_iso: Optional[str]) -> Optional[str]:
    """保修状态：expired（已过期）/ soon（90 天内到期）/ ok / None（无数据）。"""
    if not end_iso:
        return None
    try:
        d = datetime.strptime(end_iso[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    today = date.today()
    if d < today:
        return "expired"
    if (d - today).days <= WARRANTY_SOON_DAYS:
        return "soon"
    return "ok"


# ========================= 全量行装配（devices ∪ 台账 ∪ 固定资产） =========================

_ALL_SQL = """
WITH allc AS (
    SELECT device_code FROM devices
    UNION
    SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code <> ''
    UNION
    SELECT device_code FROM fixed_assets
)
SELECT a.device_code        AS device_code,
       d.id                 AS dev_id,
       d.name               AS device_name,
       d.subsystem_id       AS subsystem_id,
       d.building           AS building,
       d.floor              AS floor,
       d.location_desc      AS location_desc,
       d.is_active          AS is_active,
       d.transfer_no        AS d_transfer_no,
       d.asset_code         AS d_asset_code,
       d.bim_tag            AS d_bim_tag,
       f.asset_name         AS asset_name,
       f.brand_model        AS brand_model,
       f.location           AS fa_location,
       f.use_dept           AS use_dept,
       f.owner_unit         AS owner_unit,
       f.price_tax          AS price_tax,
       f.price_notax        AS price_notax,
       f.tax                AS tax,
       f.warranty_end       AS warranty_end,
       f.recv_date          AS recv_date,
       f.contract_no        AS contract_no,
       f.tag_no             AS tag_no,
       f.serial_no          AS serial_no,
       f.asset_code         AS fa_asset_code,
       f.bim_tag            AS fa_bim_tag,
       f.room_code          AS room_code,
       f.room_match_method  AS room_match_method
FROM allc a
LEFT JOIN devices d      ON d.device_code = a.device_code
LEFT JOIN fixed_assets f ON f.device_code = a.device_code
"""


def _enrich_from_ledger(db: Session, rows: List[Dict[str, Any]]) -> None:
    """台账反查：给「未登记设备」和「缺位置/名称」的设备补名称/位置/子系统，再统一算区域。

    只对真正缺信息的行批量查一次 records（线上约 1600 条）。不编造：查不到就保持原样。
    """
    need = [r["device_code"] for r in rows
            if r["device_code"] and (r["source"] == "ledger_only"
                                     or not r["location"] or not r["from_asset_name"])]
    profiles: Dict[str, Dict[str, Any]] = {}
    if need:
        try:
            profiles = _records_profiles(db, need)
        except Exception:
            profiles = {}

    for r in rows:
        p = profiles.get(r["device_code"]) or {}
        if p:
            if not r["from_asset_name"] and r["name"] == r["device_code"] and _norm_ws(p.get("name")):
                r["name"] = _norm_ws(p.get("name"))
            if not r["location"] and _norm_ws(p.get("location")):
                r["location"] = _norm_ws(p.get("location"))
            if not r["building"] and _norm_ws(p.get("building")):
                r["building"] = _norm_ws(p.get("building"))
            if not r["floor"] and _norm_ws(p.get("floor")):
                r["floor"] = _norm_ws(p.get("floor"))
            if not r["subsystem_name"] and p.get("subsystem_name"):
                r["subsystem_name"] = p["subsystem_name"]
            if p.get("tables"):
                r["record_tables"] = p["tables"]
        r["area"] = _ledger_area(r["location"], r["building"])


def _load_all(db: Session) -> List[Dict[str, Any]]:
    """全量总台账行（约 9000 行），进程内缓存 60s；后续筛选/分页都在内存做。"""
    now = time.time()
    if _ALL_CACHE["key"] == "all" and now - _ALL_CACHE["ts"] < _ALL_TTL:
        return _ALL_CACHE["rows"]

    sub_map = {s.id: s.name for s in db.query(Subsystem).all()}
    rows: List[Dict[str, Any]] = []
    for r in db.execute(sa_text(_ALL_SQL)).all():
        m = dict(r._mapping)
        code = m.get("device_code") or ""
        if not code:
            continue
        dev_id = m.get("dev_id")
        asset_name = _norm_ws(m.get("asset_name"))
        sid = m.get("subsystem_id")
        warranty = _iso_date(m.get("warranty_end"))
        rows.append({
            "device_code": code,
            "name": asset_name or _norm_ws(m.get("device_name")) or code,
            "device_name": _norm_ws(m.get("device_name")),
            "from_asset_name": bool(asset_name),
            "source": "devices" if dev_id else "ledger_only",
            "subsystem_id": sid,
            "subsystem_name": sub_map.get(sid, "") if sid else "",
            "location": _norm_ws(m.get("fa_location")) or _norm_ws(m.get("location_desc")),
            "building": _norm_ws(m.get("building")),
            "floor": _norm_ws(m.get("floor")),
            "area": "",  # 由 _enrich_from_ledger 统一计算
            "use_dept": _norm_ws(m.get("use_dept")),
            "owner_unit": _norm_ws(m.get("owner_unit")),
            "asset_name": asset_name,
            "asset_code": _norm_ws(m.get("fa_asset_code")) or _norm_ws(m.get("d_asset_code")),
            "brand_model": _norm_ws(m.get("brand_model")),
            "serial_no": _norm_ws(m.get("serial_no")),
            "transfer_no": _norm_ws(m.get("d_transfer_no")),
            "tag_no": _norm_ws(m.get("tag_no")),
            "contract_no": _norm_ws(m.get("contract_no")),
            "bim_tag": _norm_ws(m.get("fa_bim_tag")) or _norm_ws(m.get("d_bim_tag")),
            "room_code": _norm_ws(m.get("room_code")),
            "price_tax": _to_float(m.get("price_tax")),
            "price_notax": _to_float(m.get("price_notax")),
            "tax": _to_float(m.get("tax")),
            "recv_date": _iso_date(m.get("recv_date")),
            "warranty_end": warranty,
            "warranty_state": _warranty_state(warranty),
            # 台账-only 设备没有被软删除的概念，视为在用；devices 行按 is_active
            "is_active": True if m.get("is_active") is None else bool(m.get("is_active")),
            "has_asset": bool(asset_name),
            "record_count": 0,
            "record_tables": [],
            "relation_count": 0,
        })

    _enrich_from_ledger(db, rows)

    # 台账记录数 / 关联数：各一次分组查询，全量覆盖
    rec_n: Dict[str, int] = {}
    for r in db.execute(sa_text(
            "SELECT device_code AS code, COUNT(*) AS n FROM records"
            " WHERE device_code IS NOT NULL AND device_code <> ''"
            " GROUP BY device_code")).all():
        m = dict(r._mapping)
        rec_n[m["code"]] = int(m["n"] or 0)

    rel_n: Dict[str, int] = {}
    for r in db.execute(sa_text(
            "SELECT code, COUNT(*) AS n FROM ("
            "  SELECT from_code AS code FROM device_relations"
            "  UNION ALL SELECT to_code AS code FROM device_relations) GROUP BY code")).all():
        m = dict(r._mapping)
        rel_n[m["code"]] = int(m["n"] or 0)

    for r in rows:
        code = r["device_code"]
        r["record_count"] = rec_n.get(code, 0)
        r["relation_count"] = rel_n.get(code, 0)

    _ALL_CACHE.update({"key": "all", "ts": now, "rows": rows})
    return rows


# ========================= 筛选 / 排序 =========================

_QUERY_FIELDS = ("device_code", "name", "asset_name", "brand_model", "location",
                 "asset_code", "transfer_no", "tag_no", "use_dept", "serial_no",
                 "contract_no", "room_code")


def _apply_filters(rows: List[Dict[str, Any]], q: Optional[str] = None,
                   subsystem_id: Optional[int] = None, area: Optional[str] = None,
                   use_dept: Optional[str] = None, state: Optional[str] = None,
                   source: Optional[str] = None,
                   include_inactive: bool = False) -> List[Dict[str, Any]]:
    out = rows
    if not include_inactive:
        out = [r for r in out if r["is_active"]]
    if source in ("devices", "ledger_only"):
        out = [r for r in out if r["source"] == source]
    if subsystem_id:
        out = [r for r in out if r["subsystem_id"] == int(subsystem_id)]
    if area:
        out = [r for r in out if r["area"] == area]
    if use_dept:
        out = [r for r in out if r["use_dept"] == use_dept]
    if q:
        needle = q.strip().lower()
        if needle:
            out = [r for r in out
                   if any(needle in str(r.get(f) or "").lower() for f in _QUERY_FIELDS)]
    if state == "with_asset":
        out = [r for r in out if r["has_asset"]]
    elif state == "without_asset":
        out = [r for r in out if not r["has_asset"]]
    elif state == "ledger_only":
        out = [r for r in out if r["source"] == "ledger_only"]
    elif state == "has_records":
        out = [r for r in out if r["record_count"] > 0]
    elif state == "warranty_soon":
        out = [r for r in out if r["warranty_state"] == "soon"]
    elif state == "warranty_expired":
        out = [r for r in out if r["warranty_state"] == "expired"]
    elif state == "bim":
        out = [r for r in out if r["bim_tag"]]
    elif state == "no_location":
        out = [r for r in out if not r["location"]]
    return out


_SORT_KEYS = {
    "device_code": lambda r: r["device_code"],
    "name": lambda r: r["name"],
    "area": lambda r: r["area"],
    "use_dept": lambda r: r["use_dept"],
    "subsystem": lambda r: r.get("subsystem_name") or "",
    "record_count": lambda r: r["record_count"],
    "price_tax": lambda r: (r["price_tax"] is None, r["price_tax"] or 0.0),
    "warranty_end": lambda r: (r["warranty_end"] is None, r["warranty_end"] or ""),
}


def _sort_rows(rows: List[Dict[str, Any]], sort: str, order: str) -> List[Dict[str, Any]]:
    """排序。金额/日期列的空值恒排最后（升序降序都不把 null 顶到最前）。"""
    desc = (order or "asc").lower() == "desc"
    if sort in ("price_tax", "warranty_end"):
        have = [r for r in rows if r.get(sort) is not None]
        none = [r for r in rows if r.get(sort) is None]
        have.sort(key=lambda r: r[sort], reverse=desc)
        return have + none
    keyfn = _SORT_KEYS.get(sort or "device_code", _SORT_KEYS["device_code"])
    return sorted(rows, key=keyfn, reverse=desc)


# ========================= 接口 =========================

@router.get("/asset-ledger")
def list_asset_ledger(q: Optional[str] = None, subsystem_id: Optional[int] = None,
                      area: Optional[str] = None, use_dept: Optional[str] = None,
                      state: Optional[str] = None, source: Optional[str] = None,
                      include_inactive: bool = False,
                      sort: str = "device_code", order: str = "asc",
                      page: int = 1, page_size: int = 50,
                      db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """资产总台账分页列表（devices ∪ 台账 records ∪ 固定资产）。

    `state` 可取：with_asset / without_asset / ledger_only / has_records /
    warranty_soon / warranty_expired / bim / no_location。
    `source` 可取：devices（已登记）/ ledger_only（只在台账，未登记）。
    `sort` 可取：device_code / name / area / use_dept / subsystem / record_count /
    price_tax / warranty_end。
    """
    page = max(1, int(page))
    page_size = max(1, min(int(page_size), 500))

    all_rows = _load_all(db)
    rows = _apply_filters(all_rows, q=q, subsystem_id=subsystem_id, area=area,
                          use_dept=use_dept, state=state, source=source,
                          include_inactive=include_inactive)
    rows = _sort_rows(rows, sort, order)

    total = len(rows)
    start = (page - 1) * page_size

    # facets 基于「同关键词 + 同子系统、不施加区域/状态筛选」的集合，避免选项被自己筛没
    facet_rows = _apply_filters(all_rows, q=q, subsystem_id=subsystem_id,
                                include_inactive=include_inactive)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
        "items": rows[start:start + page_size],
        "facets": {
            "areas": sorted({r["area"] for r in facet_rows if r["area"]}),
            "use_depts": sorted({r["use_dept"] for r in facet_rows if r["use_dept"]}),
            "subsystems": sorted(
                [{"id": s.id, "name": s.name} for s in db.query(Subsystem).all()],
                key=lambda x: x["id"]),
        },
    }


@router.get("/asset-ledger/summary")
def asset_ledger_summary(q: Optional[str] = None, subsystem_id: Optional[int] = None,
                         area: Optional[str] = None, use_dept: Optional[str] = None,
                         db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """资产总台账汇总：规模 / 金额 / 区域 / 子系统 / 使用单位 / 保修预警。"""
    rows = _apply_filters(_load_all(db), q=q, subsystem_id=subsystem_id,
                          area=area, use_dept=use_dept)

    def _agg(keyfn):
        bucket: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            k = str(keyfn(r) or "未标注")
            b = bucket.setdefault(k, {"name": k, "count": 0, "amount": 0.0, "with_asset": 0})
            b["count"] += 1
            if r["price_tax"]:
                b["amount"] += r["price_tax"]
            if r["has_asset"]:
                b["with_asset"] += 1
        return sorted(bucket.values(), key=lambda x: -x["count"])

    amount = sum(r["price_tax"] or 0.0 for r in rows)
    with_price = [r["price_tax"] for r in rows if r["price_tax"] is not None]

    return {
        "total": len(rows),
        "registered": sum(1 for r in rows if r["source"] == "devices"),
        "ledger_only": sum(1 for r in rows if r["source"] == "ledger_only"),
        "with_asset": sum(1 for r in rows if r["has_asset"]),
        "without_asset": sum(1 for r in rows if not r["has_asset"]),
        "with_records": sum(1 for r in rows if r["record_count"] > 0),
        "with_bim": sum(1 for r in rows if r["bim_tag"]),
        "no_location": sum(1 for r in rows if not r["location"]),
        "amount_total": round(amount, 2),
        "amount_avg": round(amount / len(with_price), 2) if with_price else 0.0,
        "warranty_soon": sum(1 for r in rows if r["warranty_state"] == "soon"),
        "warranty_expired": sum(1 for r in rows if r["warranty_state"] == "expired"),
        "warranty_soon_days": WARRANTY_SOON_DAYS,
        "by_area": _agg(lambda r: r["area"]),
        "by_subsystem": _agg(lambda r: r.get("subsystem_name")),
        "by_use_dept": _agg(lambda r: r["use_dept"])[:12],
    }


@router.get("/asset-ledger/detail")
def asset_ledger_detail(code: str, db: Session = Depends(get_db),
                        _: User = Depends(_get_current_user)):
    """单设备全字段详情：设备 + 固定资产 + 设备档案 + 跨表台账记录 + 关联链路。

    未登记进 devices、只存在于台账 records 的现场设备同样支持（source='ledger_only'）。
    """
    code = (code or "").strip()
    if not code:
        return {"found": False, "code": code}

    dev = db.query(Device).filter(Device.device_code == code).first()
    fa = db.query(FixedAsset).filter(FixedAsset.device_code == code).first()
    da = db.query(DeviceArchive).filter(DeviceArchive.device_code == code).first()
    recs = db.query(Record).filter(Record.device_code == code).all()

    if not dev and not fa and not da and not recs:
        return {"found": False, "code": code}

    # 台账记录（含所在表名与子系统）
    tmap: Dict[int, DataTable] = {}
    if recs:
        tids = list({r.table_id for r in recs})
        for t in db.query(DataTable).filter(DataTable.id.in_(tids)).all():
            tmap[t.id] = t
    records_out = []
    for r in recs:
        t = tmap.get(r.table_id)
        records_out.append({
            "record_id": r.id,
            "table_id": r.table_id,
            "table_code": t.code if t else None,
            "table_name": t.name if t else None,
            "subsystem_name": _subsystem_name(db, t.subsystem_id) if t else None,
            "data": r.data or {},
        })

    profile = _records_profiles(db, [code], recs).get(code, {})

    # 关联链路（有向存储、无向查询）
    rels = db.query(DeviceRelation).filter(
        (DeviceRelation.from_code == code) | (DeviceRelation.to_code == code)
    ).all()
    # _relation_type_meta 按 code 索引；device_relations.relation_type 存的是 label
    meta_by_label = {}
    for _c, _m in _relation_type_meta(db).items():
        if _m.get("label"):
            meta_by_label[_m["label"]] = dict(_m, code=_c)
    relations_out = []
    for rel in rels:
        is_out = rel.from_code == code
        canon = _canonical_relation_label(rel.relation_type or "")
        meta = meta_by_label.get(canon) or {}
        relations_out.append({
            "relation_id": rel.id,
            "direction": "out" if is_out else "in",
            "from_code": rel.from_code,
            "to_code": rel.to_code,
            "other_code": rel.to_code if is_out else rel.from_code,
            "relation_type": canon,
            "relation_type_code": meta.get("code"),
            "kind": meta.get("kind"),
            "meta": rel.meta or {},
        })

    loc_for_area = ((fa.location if fa else "") or (dev.location_desc if dev else "")
                    or profile.get("location") or "")
    return {
        "found": True,
        "code": code,
        "source": "devices" if dev else ("fixed_asset" if fa else ("archive" if da else "ledger_only")),
        "device": {
            "id": dev.id,
            "device_code": dev.device_code,
            "name": dev.name,
            "subsystem_id": dev.subsystem_id,
            "subsystem_name": _subsystem_name(db, dev.subsystem_id),
            "building": _norm_ws(dev.building),
            "floor": _norm_ws(dev.floor),
            "location_desc": _norm_ws(dev.location_desc),
            "is_active": bool(dev.is_active),
            "transfer_no": _norm_ws(dev.transfer_no),
            "asset_code": _norm_ws(dev.asset_code),
            "bim_tag": _norm_ws(dev.bim_tag),
        } if dev else None,
        "fixed_asset": _fa_to_dict(fa) if fa else None,
        "archive": _da_to_dict(da) if da else None,
        "profile": profile,
        "area": _ledger_area(loc_for_area, dev.building if dev else ""),
        "records": records_out,
        "record_count": len(records_out),
        "relations": relations_out,
    }
