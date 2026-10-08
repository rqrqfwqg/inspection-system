"""字段候选值枚举（数据表管理「条件筛选」的值下拉数据源）

背景
----
筛选条的值框原先只能**手打**。用户要求「条件选项内的选项根据表格内的已有数据
筛选，相对灵活，像 EXCEL 一样」——即：值应当**从该列已有数据里挑**，
而不是凭记忆敲字符串（敲错一个字就命中 0 条，且完全看不出错在哪）。

本模块提供候选值的**唯一裁决点**：对某张表的某个字段做
`GROUP BY 值 → COUNT(*)`，按命中数降序返回，供前端下拉展示。

为什么不能用 `SELECT DISTINCT` 或直接在前端算
------------------------------------------------
1. 🔴 **必须带 COUNT**：EXCEL 式体验的核心是「我知道选这个值会命中几条」。
   没有条数的候选列表是盲选，用户仍要来回试。
2. 🔴 **必须服务端算**：最大表 4587 行 / distinct 875（实测），全量拉回前端
   既慢又占内存；而筛选本身也在服务端，候选与筛选口径必须同源，
   否则会出现「下拉里选得到、筛起来中不中」。
3. 🔴 **排序按 count DESC**：高频值在前，低频长尾在后 —— 与用户「先看常见值」
   的直觉一致，也让前 50 条的截断「截掉的都是罕见值」。

铁律
----
1. 🔴 **字段名先白名单校验**（与 `record_filters` 同一套：field_defs.key + `__device_code`），
   杜绝任意键注入与「枚举一个根本不存在的字段」。
2. 🔴 **按大小写折叠分组**（`GROUP BY lower(v)`）：`eq` 大小写不敏感，
   候选必须与之一致，否则「选 UPS(2) 却筛出 3 条」。
3. 🔴 **值一律排除空白**：`TRIM(v) = ''` 与 `v IS NULL` 的行不进候选 ——
   空值由 `is_empty` / `not_empty` 算子负责，混进下拉只会让用户
   「选了一个空字符串然后莫名其妙 0 条」。
4. 🔴 **`__device_code` 查独立列**，其余走 `json_extract(records.data, ...)`，
   与 `record_filters._json_val` **同一套取值口径**（键名走绑定参数，不拼 SQL）。
5. 🔴 **q 过滤在 Python 侧做，且用 `ascii_lower`**（SQLite `lower()` 只折叠 ASCII，
   与 SQL 侧 `func.lower()` 严格对称；用 `str.lower()` 会多折一层导致漏筛）。
6. **只读**：本模块不写库、不改任何缓存；仅产出候选列表。
   自身只读缓存（TTL 60s）纯粹为省重复的 GROUP BY 全表扫。
"""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import text as sa_text

from record_filters import DEVICE_CODE_FIELD, ascii_lower

# 候选返回条数上限（前端下拉一次渲染不了更多；剩余靠 q 搜索）
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
# q 搜索词长度上限（与筛选条件的值同口径 200）
MAX_Q_LEN = 100

# 自缓存 TTL：60s。候选值是「慢变数据」，不值得为它建索引；
# 写记录后最多 60s 候选列表才更新，对下拉式交互完全无感。
_CACHE_TTL = 60.0
# 缓存条目上限：防止「每张表每个字段都点一遍」把内存撑爆（LRU 粗实现：超限丢最旧）
_CACHE_MAX = 200


class FieldValueError(ValueError):
    """字段不合法（→ 400）。message 直接给前端展示，故须是人话。"""


_cache: Dict[Tuple[int, str], Tuple[float, List[Tuple[str, int]]]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: Tuple[int, str]) -> Optional[List[Tuple[str, int]]]:
    with _cache_lock:
        hit = _cache.get(key)
        if not hit:
            return None
        ts, values = hit
        if time.monotonic() - ts > _CACHE_TTL:
            _cache.pop(key, None)
            return None
        return values


def _cache_put(key: Tuple[int, str], values: List[Tuple[str, int]]) -> None:
    with _cache_lock:
        if len(_cache) >= _CACHE_MAX:
            # 超限：丢最早写入的一条（插入有序 → 下一个就是最旧的）
            oldest = next(iter(_cache))
            _cache.pop(oldest, None)
        _cache[key] = (time.monotonic(), values)


def reset_cache() -> None:
    """清空候选值缓存（写记录后调用，让新值立刻出现在下拉里）。"""
    with _cache_lock:
        _cache.clear()


def validate_field(field: Any, allowed_fields: Iterable[str]) -> str:
    """校验字段名在白名单内，返回规范化后的字段名。"""
    name = str(field or "").strip()
    if not name:
        raise FieldValueError("请指定要取值的字段")
    if len(name) > 80:
        raise FieldValueError("字段名过长")
    if name not in set(allowed_fields):
        raise FieldValueError(f"字段「{name}」不属于这张表")
    return name


def _distinct_sql(field: str) -> Tuple[Any, Dict[str, Any]]:
    """产出「该字段 distinct 值 + 命中条数」的 SQL 与绑定参数。

    🔴 键名走绑定参数（`:fk`），**绝不拼进 SQL 文本**（与 record_filters 同口径）。
    关联键走独立列，其余走 `json_extract(records.data, '$.' || :fk)`。

    🔴🔴 **`GROUP BY lower(v)` 而不是 `GROUP BY v`** —— 必须按**大小写折叠后**分组。
    原因：`record_filters` 的 `eq`/`ne`/`contains` 全部走 `func.lower()`，
    即**大小写不敏感**。若按原值分组，库里 `UPS`(2 条) 与 `ups`(1 条) 会列成两项，
    而 `eq("UPS")` 实际命中 **3** 条 —— 用户选「UPS(2)」却筛出 3 条，
    数字对不上，正是「EXCEL 式体验」最不能忍的一种错。
    按 `lower()` 分组后只剩一项 `UPS(3)`，与实筛结果严格一致。
    （SQLite `lower()` 只折叠 ASCII，与 Python 侧 `ascii_lower()` 逐字符等价。）

    显示值取 `MIN(v)`（原样，不是折叠后的）：同一类里 ASCII 大写排在前，
    通常也就是数据里写法最常见的那种，且**确定性**（不会随扫描顺序漂移）。
    """
    if field == DEVICE_CODE_FIELD:
        val = "COALESCE(CAST(records.device_code AS TEXT), '')"
    else:
        val = "COALESCE(CAST(json_extract(records.data, '$.' || :fk) AS TEXT), '')"
    sql = (
        f"WITH t AS (SELECT {val} AS v FROM records WHERE records.table_id = :tid) "
        "SELECT MIN(v) AS v, COUNT(*) AS c FROM t "
        "WHERE TRIM(v) <> '' "
        "GROUP BY lower(v) "
        "ORDER BY c DESC, v ASC"
    )
    binds: Dict[str, Any] = {"tid": None}
    if field != DEVICE_CODE_FIELD:
        binds["fk"] = field
    return sa_text(sql), binds


def _load_distinct(db, tid: int, field: str) -> List[Tuple[str, int]]:
    """执行 GROUP BY 全量枚举（结果进自缓存）。

    实测（服务器 app.db）：最大表 4587 行 / distinct 607 → **约 12ms**，
    且 `LIMIT` 对 GROUP BY 无优化作用（875 与 50 都是 12ms），
    故这里**一次性取全量 distinct**再由 Python 过滤 q —— 一次查询服务所有搜索词。
    """
    key = (tid, field)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    sql, binds = _distinct_sql(field)
    binds["tid"] = tid
    stmt = sql.bindparams(**binds)
    rows = db.execute(stmt).fetchall()
    values = [(str(r[0]), int(r[1])) for r in rows]
    _cache_put(key, values)
    return values


def list_field_values(
    db,
    tid: int,
    field: str,
    allowed_fields: Iterable[str],
    q: Optional[str] = None,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    """取某表某字段的候选值列表（已按命中数降序 + q 过滤 + 条数截断）。

    返回
    ----
    {
      "field": "box_code",
      "values": [{"value": "A-FM", "count": 122}, ...],
      "total": 607,          # 该字段 distinct 非空值总数（截断前）
      "returned": 50,        # 本次实际返回条数
      "matched": 12,         # q 过滤后命中条数（未截断）
      "truncated": true,     # matched > returned → 还有更多，靠 q 继续缩小
    }
    """
    name = validate_field(field, allowed_fields)

    try:
        lim = DEFAULT_LIMIT if limit is None else max(1, min(int(limit), MAX_LIMIT))
    except (TypeError, ValueError):
        raise FieldValueError(f"limit 取值不合法：{limit}") from None

    kw = ascii_lower((q or "").strip()[:MAX_Q_LEN])
    all_values = _load_distinct(db, tid, name)

    if kw:
        # 🔴 ASCII 折叠（与 SQL func.lower() 对称）；命中「包含」语义，与 contains 算子一致
        matched = [(v, c) for v, c in all_values if kw in ascii_lower(v)]
    else:
        matched = all_values

    page = matched[:lim]
    return {
        "field": name,
        "values": [{"value": v, "count": c} for v, c in page],
        "total": len(all_values),
        "returned": len(page),
        "matched": len(matched),
        "truncated": len(matched) > len(page),
    }
