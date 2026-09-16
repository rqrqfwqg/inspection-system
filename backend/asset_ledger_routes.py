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

本模块把「devices ∪ 台账 records ∪ 固定资产」求全集合，合成一张可检索、可筛选、可预警的
总台账，四条只读接口：
  GET /assets/asset-ledger          分页列表（关键字/子系统/区域/使用单位/状态/排序）
  GET /assets/asset-ledger/summary  汇总（规模、金额、区域、子系统、使用单位、保修预警）
  GET /assets/asset-ledger/detail   单设备全字段详情（固定资产 + 档案 + 台账记录 + 关联）
  GET /assets/asset-ledger/resolve  手动输入机身编码 → 反查台账 → 匹配设备（权威匹配内核）

口径说明（重要）
----------------
- 行来源用 `source` 标识：`devices`（已登记）/ `ledger_only`（只在台账，未登记）。
  两条都展示，绝不隐藏——这正是原页面漏数据的地方。
- 区域（area）由「固定资产所在地点 / 设备位置 / 台账反查位置」文本推导，只做确定性命中；
  纯编号式地点按前缀归为「编号区 X」，推不出来就写「未标注」，不猜楼栋。
- 金额一律取含税价 price_tax，单位元。
- 软删除设备（is_active=false）默认不出现，与既有 /devices 行为一致。
- 全量行在进程内缓存 60s（约 9000 行），筛选/分页/排序在内存里做，保证口径一致且翻页秒回。
- 机身编码匹配索引挂 `_load_all` 的**同一 60s 生命周期**上一次性构建，绝不每请求全表扫。
  🔒 `serial_no` = **序列号**，不是机身编号，两者索引互不相通（详见 asset_code_match.py）。
"""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text
from typing import Optional, List, Dict, Any
import re
import time
from datetime import datetime, date

from database import (
    get_db, User, Device, Subsystem, DataTable, Record, DeviceRelation,
    FixedAsset, DeviceArchive, DeviceSerialObservation, DeviceGeoObservation,
)
from dependencies import get_current_user as _get_current_user
from asset_routes import (
    _fa_to_dict, _da_to_dict, _records_profiles, _relation_type_meta,
    _subsystem_name, _canonical_relation_label,
)
# 机身编码匹配内核（后端唯一权威实现，见 asset_code_match.py）
from asset_code_match import (build_match_index, resolve_code,
                              normalize_code, extract_serial_from_brand)
from asset_schemas import (
    ObservationCreate, ObservationCreateResponse,
    ObservationResponse, ObservationDeleteResponse, ObservationConflict,
    GeoObservationCreate, GeoObservationCreateResponse, GeoObservationResponse,
)

router = APIRouter(prefix="/assets", tags=["asset-ledger"])

# 保修即将到期阈值（天）
WARRANTY_SOON_DAYS = 90
# 全量行缓存 TTL（秒）
_ALL_TTL = 60
_ALL_CACHE: Dict[str, Any] = {"key": None, "ts": 0.0, "rows": []}
# 机身编码匹配索引缓存：与 _ALL_CACHE 同生命周期（同一 60s TTL 内复用，绝不每请求全表扫）
_MATCH_INDEX: Dict[str, Any] = {"key": None, "ts": 0.0, "idx": None}


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

# 图纸提取类子系统：其 records 保留 device_code（供 /search、/detail 按回路编号、
# 配电箱编码直接关联检索），但**不并入资产总台账**，否则图纸设备会污染台账口径
# （实测 elec_dwg 子系统 7937 条会让 total 从 8977 涨到 1.6 万）。
_LEDGER_EXCLUDED_SUBSYSTEMS = ("elec_dwg", "room")
# room（房间）：房间是「场地」而非「资产」，其 device_code 实为房间编号，在 devices /
# fixed_assets 中 0 命中 → 只涨 total 计数、**不贡献任何金额**。2026-09-16 起剔除
# （total 8980 → 8455），避免「每在机房信息汇总加一间房 total +1」污染资产口径。
_EXCLUDED_SUBSYS_IN = ",".join("'%s'" % c for c in _LEDGER_EXCLUDED_SUBSYSTEMS)

_ALL_SQL = """
WITH allc AS (
    SELECT device_code FROM devices
    UNION
    SELECT device_code FROM records
     WHERE device_code IS NOT NULL AND device_code <> ''
       AND NOT EXISTS (
           SELECT 1 FROM data_tables t
             JOIN subsystems s ON s.id = t.subsystem_id
            WHERE t.id = records.table_id
              AND s.code IN (/*EXCL*/))
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
""".replace("/*EXCL*/", _EXCLUDED_SUBSYS_IN)


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
    """全量总台账行（约 9000 行），进程内缓存 60s；后续筛选/分页都在内存做。

    重建行时同步重建机身编码匹配索引（同一 60s 生命周期）；**不修改 rows 结构**，
    故列表接口 `GET /asset-ledger` 的输出与引入匹配索引前逐字节一致。
    """
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
    # §2.2：复用同一批行、同一生命周期建匹配索引（不修改 rows，列表接口输出不变）
    _MATCH_INDEX.update({"key": "all", "ts": now, "idx": build_match_index(db, rows)})
    return rows


def _get_match_index(db: Session) -> Dict[str, Any]:
    """机身编码匹配索引（与 `_load_all` 同 60s 生命周期，绝不每请求全表扫）。"""
    now = time.time()
    if (_MATCH_INDEX["key"] == "all" and _MATCH_INDEX["idx"] is not None
            and now - _MATCH_INDEX["ts"] < _ALL_TTL):
        return _MATCH_INDEX["idx"]
    _load_all(db)  # 重建 rows 时同步重建索引
    return _MATCH_INDEX["idx"]


def _invalidate_caches() -> None:
    """补录写入后**立即**让行缓存与匹配索引失效（不等 60s TTL 自然过期）。

    🔴 这是 §4.3「补录后 /resolve 可精确命中」验收的关键：若失效缺失，补录后
    最长 60 秒 `/resolve` 仍命中不到新观测，等于补录当场失效。
    """
    _ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
    _MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})


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


@router.get("/asset-ledger/resolve")
def resolve_asset_code(q: str = "", limit: int = 8, db: Session = Depends(get_db),
                       _: User = Depends(_get_current_user)):
    """手动输入机身编码 / 设备编号 → 反查台账 → 匹配设备（只读 · 权威匹配内核）。

    返回 §3.2 结构：
      {query, normalized{raw,upper,loose}, kind, exact, count, candidates[], hint?}

    要点
    ----
    - `kind` ∈ device_code / alias / serial（机身编号）/ serial_no（序列号）/ fuzzy / none /
      ambiguous（R2：该值被 ≥2 台设备共用，此时 exact=False 且带 shared_count）。
    - R1：未登记（ledger_only）行的精确命中出口封顶 88（source_demoted=True），
      不得压过已登记设备的机身编号命中（92）；已登记设备的 100 分不受影响。
    - `match_type` ∈ device_code_exact(100) / alias_exact(98) / observation_exact(96) /
      brand_extract_exact(92) / serial_no_exact(70) / brand_substring(60) / field_substring(40)。
    - 🔒 `serial_no_exact`（70）是**序列号**，不是机身编号；前端必须按「序列号」标签展示。
    - `candidates` 已按 §2.3 排序，前端只展示、不再重排；`limit` 默认 8、上限 20。
    - 无命中时给 `hint.can_observe=true`，指引「补录为机身编号」（补录接口属批次③）。
    - 索引复用 `_load_all` 的 60s 缓存，绝不每请求全表扫。
    """
    index = _get_match_index(db)
    return resolve_code(index, q, limit)

# ========================= 机身编号现场补录（批次③ T02 · §4.4）=========================
#
# 落点纪律：**只写 L2 现场观测层** `device_serial_observations`，**绝不写**甲方 `fixed_assets`。
# 写入带 operator / client / observed_at 审计；`DELETE` 为软删（status='rejected'）可回滚。
# 🔴 每次写入（POST 新建 / DELETE）后**立即失效** `_ALL_CACHE` 与 `_MATCH_INDEX`，
#    否则补录后 `/resolve` 最长 60s 仍命中不到（违反 §4.3「补录后即可精确命中」验收）。


def _parse_dt(v: Any) -> Optional[datetime]:
    """端上报的 observed_at（ISO 字符串 / datetime）→ datetime；不可解析则 None。"""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _observation_other_device(idx: Dict[str, Any], device_code: str,
                              serial_norm: str) -> bool:
    """该 `serial_norm` 是否已属**其他设备**（其他 active 观测 **或** 其他设备抽取）。

    直接读已建好的 `brand_serial` 空间（O(1)）：2 元组 = 某行 `brand_model` 抽取；
    3 元组且 tag='observation' = 某条 active 现场观测。
    """
    for entry in idx["brand_serial"].get(serial_norm, []):
        if isinstance(entry, tuple) and len(entry) == 3 and entry[2] == "observation":
            dev = entry[0]
        else:
            row = entry[0] if isinstance(entry, tuple) else {}
            dev = (row or {}).get("device_code") if isinstance(row, dict) else ""
        if dev and dev != device_code:
            return True
    return False


@router.post("/asset-ledger/observations", response_model=ObservationCreateResponse)
def create_observation(
    payload: ObservationCreate,
    x_client_type: Optional[str] = Header(None),
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """现场补录机身编号（§4.4）——只写观测层；幂等 / 冲突并存 / 审计 / 可逆。

    - `serial_norm = normalize_code(serial_raw)['loose']`；为空 → **400**。
    - `device_code` 必须存在于台账（`_load_all` 行集合）→ 否则 **404**。
    - 同 `(device_code, serial_norm)` 已有 active 行 → **200 already=true**，不新建。
    - 冲突比对对象 = 本设备 `brand_model` 的**抽取结果**（**非 `serial_no`**）：
      抽不出 → 接受(none)；相同 → none；不同 → conflicts_ledger（并存，台账不改）。
    - 该编号已属**其他设备** → conflicts_other_device（隔离，不进匹配索引）。
    - 写入后**立即失效**匹配索引缓存 → 下次 /resolve 即可 `observation_exact`(96) 命中。
    """
    device_code = (payload.device_code or "").strip()
    serial_raw = (payload.serial_raw or "").strip()
    if not device_code:
        raise HTTPException(status_code=400, detail="device_code 不能为空")
    serial_norm = normalize_code(serial_raw)["loose"]
    if not serial_norm:
        raise HTTPException(
            status_code=400,
            detail="机身编号为空或无法归一（去掉分隔符/空白后无有效字符），请输入有效编号")

    rows = _load_all(db)
    row = next((r for r in rows if r["device_code"] == device_code), None)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"设备 {device_code} 不存在于台账，无法补录（请先选定所属设备）")

    # 幂等：命中既有 active 行（唯一索引 ux_dso_device_serial 的应用层前置）
    existing = (db.query(DeviceSerialObservation)
                .filter(DeviceSerialObservation.device_code == device_code,
                        DeviceSerialObservation.serial_norm == serial_norm,
                        DeviceSerialObservation.status == "active")
                .first())
    if existing is not None:
        return ObservationCreateResponse(
            success=True, already=True, id=existing.id,
            serial_norm=serial_norm,
            conflict_state=existing.conflict_state or "none")

    client = (x_client_type or "").strip() or "miniprogram"
    # 冲突比对对象 = 台账 brand_model 的**抽取结果**（v2），**不是** serial_no
    ledger_extract = extract_serial_from_brand(row.get("brand_model"))

    conflict_state = "none"
    conflict = None
    status = "active"
    if _observation_other_device(_get_match_index(db), device_code, serial_norm):
        # 防误绑扩散：该编号已属其他设备 → 隔离（status 非 active；内核只并 active）
        status = "quarantined"
        conflict_state = "conflicts_other_device"
        conflict = ObservationConflict(
            type="conflicts_other_device",
            ledger_brand_serial=ledger_extract,
            message=("该机身编号已为其他设备所用（现场观测或台账抽取），"
                     "本次观测已并存并隔离、不参与匹配索引，待人工复核"))
    else:
        ledger_loose = normalize_code(ledger_extract)["loose"]
        if ledger_loose and ledger_loose != serial_norm:
            # 与台账并存（绝不覆盖台账任何字段）
            conflict_state = "conflicts_ledger"
            conflict = ObservationConflict(
                type="conflicts_ledger",
                ledger_brand_serial=ledger_extract,
                message=("台账 brand_model 中的机身编号与现场观测不一致，"
                         "已并存待复核，台账未被修改"))

    obs = DeviceSerialObservation(
        device_code=device_code,
        serial_raw=serial_raw,
        serial_norm=serial_norm,
        room_code=(payload.room_code or "").strip() or None,
        operator=(payload.operator or "").strip(),
        source=(payload.source or "miniprogram").strip() or "miniprogram",
        client=client,
        observed_at=_parse_dt(payload.observed_at),
        status=status,
        conflict_state=conflict_state,
        ledger_brand_serial=ledger_extract,
        evidence_photo_id=payload.evidence_photo_id,
        note=(payload.note or "").strip(),
    )
    db.add(obs)
    db.commit()
    db.refresh(obs)

    _invalidate_caches()   # 🔴 补录后立即失效 → /resolve 马上可命中

    return ObservationCreateResponse(
        success=True, already=False, id=obs.id, serial_norm=serial_norm,
        conflict_state=conflict_state, conflict=conflict)


@router.get("/asset-ledger/observations", response_model=List[ObservationResponse])
def list_observations(device_code: Optional[str] = None, status: Optional[str] = None,
                      db: Session = Depends(get_db),
                      _: User = Depends(_get_current_user)):
    """列出补录观测：默认只看 `active`；`?status=` 可查全量（含 rejected / quarantined）。"""
    q = db.query(DeviceSerialObservation)
    if device_code:
        q = q.filter(DeviceSerialObservation.device_code == device_code)
    if status:
        q = q.filter(DeviceSerialObservation.status == status)
    else:
        q = q.filter(DeviceSerialObservation.status == "active")
    rows = q.order_by(DeviceSerialObservation.created_at.desc(),
                      DeviceSerialObservation.id.desc()).all()
    return [ObservationResponse.model_validate(r) for r in rows]


@router.delete("/asset-ledger/observations/{oid}", response_model=ObservationDeleteResponse)
def delete_observation(oid: int, db: Session = Depends(get_db),
                       _: User = Depends(_get_current_user)):
    """软删观测（置 status='rejected'）→ 立即从匹配索引移除（可逆，不物理删除）。"""
    obs = (db.query(DeviceSerialObservation)
           .filter(DeviceSerialObservation.id == oid).first())
    if obs is None:
        raise HTTPException(status_code=404, detail=f"观测记录 {oid} 不存在")
    obs.status = "rejected"
    db.commit()
    _invalidate_caches()   # 🔴 立即失效 → 该编号马上不再命中
    return ObservationDeleteResponse(success=True, id=obs.id, status="rejected")


# ==================== 设备现场定位观测（批次⑤ · 扫码即记坐标） ====================
#
# 纪律（与机身编号补录一致）：
#   - **只写 `device_geo_observations`**，绝不改 `devices` / `fixed_assets` 的位置字段；
#   - **每次扫码一条**，不做幂等合并（同设备多次扫码 = 多条，用于判断是否被移动过）；
#   - 定位失败时**前端不上报**，绝不塞 (0,0) 假坐标污染数据；
#   - device_code 必须存在于台账（同补录口径），否则 404，防止把坐标挂到不存在的设备上。

_GEO_LAT_RANGE = (-90.0, 90.0)
_GEO_LNG_RANGE = (-180.0, 180.0)


@router.post("/asset-ledger/geo-observations",
             response_model=GeoObservationCreateResponse)
def create_geo_observation(
    payload: GeoObservationCreate,
    x_client_type: Optional[str] = Header(None),
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """扫码时上报一条设备现场定位（每次一条 · 只增不改台账）。

    - `device_code` 必须存在于台账 → 否则 **404**；
    - 经纬度缺失 / 非数值 / 超范围 / 为 (0,0) → **400**（(0,0) 多为定位失败的兜底值）；
    - **不做幂等**：不返回 already，重复扫码就是多条历史（这是刻意设计）。
    """
    device_code = (payload.device_code or "").strip()
    if not device_code:
        raise HTTPException(status_code=400, detail="device_code 不能为空")

    lat_raw, lng_raw = payload.latitude, payload.longitude
    if lat_raw is None or lng_raw is None:
        raise HTTPException(status_code=400, detail="latitude / longitude 不能为空")
    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="latitude / longitude 必须是数值")
    if not (_GEO_LAT_RANGE[0] <= lat <= _GEO_LAT_RANGE[1]):
        raise HTTPException(status_code=400,
                            detail=f"latitude 超出合法范围（{_GEO_LAT_RANGE[0]}~{_GEO_LAT_RANGE[1]}）")
    if not (_GEO_LNG_RANGE[0] <= lng <= _GEO_LNG_RANGE[1]):
        raise HTTPException(status_code=400,
                            detail=f"longitude 超出合法范围（{_GEO_LNG_RANGE[0]}~{_GEO_LNG_RANGE[1]}）")
    if lat == 0.0 and lng == 0.0:
        raise HTTPException(status_code=400,
                            detail="坐标 (0,0) 视为无效定位（多为定位失败兜底值），请勿上报")

    rows = _load_all(db)
    if not any(r["device_code"] == device_code for r in rows):
        raise HTTPException(status_code=404,
                            detail=f"设备 {device_code} 不存在于台账，无法记录定位")

    acc = payload.accuracy
    try:
        acc = float(acc) if acc is not None and acc != "" else None
    except (TypeError, ValueError):
        acc = None
    alt = payload.altitude
    try:
        alt = float(alt) if alt is not None and alt != "" else None
    except (TypeError, ValueError):
        alt = None

    row = DeviceGeoObservation(
        device_code=device_code,
        latitude=lat,
        longitude=lng,
        accuracy=acc,
        altitude=alt,
        coord_type=(payload.coord_type or "gcj02").strip() or "gcj02",
        room_code=(payload.room_code or "").strip() or None,
        scan_source=(payload.scan_source or "camera").strip() or "camera",
        operator=(payload.operator or "").strip(),
        source=(payload.source or "miniprogram").strip() or "miniprogram",
        client=(x_client_type or "").strip() or "miniprogram",
        observed_at=_parse_dt(payload.observed_at),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return GeoObservationCreateResponse(
        success=True, id=row.id, device_code=device_code, created=True)


@router.get("/asset-ledger/geo-observations",
            response_model=List[GeoObservationResponse])
def list_geo_observations(device_code: Optional[str] = None, limit: int = 20,
                          db: Session = Depends(get_db),
                          _: User = Depends(_get_current_user)):
    """列出设备定位观测（**最新在前**）；`?device_code=` 指定设备，缺省返回最近 limit 条。"""
    try:
        n = int(limit or 20)
    except (TypeError, ValueError):
        n = 20
    n = max(1, min(n, 200))
    q = db.query(DeviceGeoObservation)
    if device_code:
        q = q.filter(DeviceGeoObservation.device_code == device_code.strip())
    rows = (q.order_by(DeviceGeoObservation.created_at.desc(),
                       DeviceGeoObservation.id.desc())
            .limit(n).all())
    return [GeoObservationResponse.model_validate(r) for r in rows]
