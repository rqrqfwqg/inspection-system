"""数据表记录的结构化条件筛选（数据表管理「条件筛选」功能内核）

背景
----
`GET /assets/tables/{tid}/records` 原先只有一个 `q`（全字段 OR 子串模糊），
无法回答「只看 2#楼 且 设备类型=空调器 且 厂址为空」这类**多字段组合**问题。
本模块提供结构化筛选的**唯一裁决点**：把一份 JSON 条件列表编译成 SQL 谓词。

契约（前端须按此拼装，缺一即不生效）
------------------------------------
`filters` 为 **JSON 数组字符串**，每个元素：
    {"field": "floor", "op": "contains", "value": "2#楼"}

  - `field` 特殊值 `"__device_code"` → 筛 `records.device_code`（关联键，独立列）；
    其余为 `records.data` JSON 内的键。
  - `op` ∈ `eq` / `ne` / `contains` / `not_contains` / `starts_with` / `ends_with`
      / `is_empty` / `not_empty`
  - `value` 对 `is_empty` / `not_empty` 忽略。

`logic` ∈ `and` / `or`（顶层组合方式，缺省 `and`）。

铁律
----
1. 🔴 **绝不拼接 SQL**：字段名与值一律走绑定参数 / `json_extract` 绑定键，
   值里的 `%` `_` `\` 必须转义（LIKE 通配符，§13 事故③ 曾因 `q=%` 命中全表）。
2. 🔴 **字段名先白名单校验**：只允许出现在该表 `field_defs` 里的 key，
   杜绝任意键注入与「筛一个根本不存在的字段」。
3. 🔴 **未知 op / 未知 logic 一律 400**，绝不静默忽略条件（静默忽略会让用户
   以为筛选已生效，实际没生效 —— 排查时最容易被骗的地方）。
4. 🔴 **条件数与长度上限**：最多 20 条条件（防拼超长 URL 与全表 json_extract 风暴），
   单值截断到 200 字符（对齐 `q` 的 100 字符口径放宽一倍）。
5. **只读**：本模块不写库、不改缓存，仅产出 `WHERE` 片段。

值形态真相（决定为什么不能做 SQL 数值比较）
------------------------------------------
`records.data` 的**所有值一律存为字符串**（含坐标等纯数字字段，如 x="3329137.2"），
故「等于」一律按**字符串全等**比对，不做类型推断 —— 否则 `x=3329137` 会漏命中
（数据库侧与 Python 侧对小数/整数的字符串化规则不一致，会造成「明明有却筛不到」）。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import and_, or_, func
from sqlalchemy import text as sa_text

# 特殊字段名：关联键（records.device_code 独立列，不在 data JSON 内）
DEVICE_CODE_FIELD = "__device_code"

# 合法算子 → 中文标签（前端下拉文案以此为准，避免两处各写一套）
OPS: Dict[str, str] = {
    "contains": "包含",
    "not_contains": "不包含",
    "eq": "等于",
    "ne": "不等于",
    "starts_with": "开头是",
    "ends_with": "结尾是",
    "is_empty": "为空",
    "not_empty": "不为空",
}
OP_VALUELESS = {"is_empty", "not_empty"}
ALLOWED_OPS = frozenset(OPS)
ALLOWED_LOGIC = frozenset({"and", "or"})

MAX_CONDITIONS = 20
MAX_VALUE_LEN = 200
MAX_FIELD_LEN = 80

_JSON_KEY_RE = re.compile(r"^[A-Za-z_一-鿿][A-Za-z0-9_\-一-鿿]*$")


class FilterError(ValueError):
    """条件不合法（→ 400）。message 直接给前端展示，故须是人话。"""


def _escape_like(raw: str) -> str:
    """转义 LIKE 通配符，使 `%` / `_` / `\\` 只当普通字符比。

    🔴 与 `list_records` 里 `q` 的转义口径保持一致（顺序也一致）：
    先 `\\` 再 `%` 再 `_`，否则反斜杠会被后续替换二次转义。
    """
    return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _like_pattern(value: str) -> str:
    return "%" + _escape_like(value.lower()) + "%"


def parse_filters(
    raw: Optional[str],
    allowed_fields: Iterable[str],
) -> Tuple[List[Dict[str, str]], str]:
    """解析 `filters` 查询串 → `(条件列表, logic)`。

    参数
    ----
    raw:            URL 上的 `filters` 原始串（JSON 数组字符串）。空/None → 空列表。
    allowed_fields: 该表**允许筛选的字段 key 集合**（来自 field_defs；
                     `DEVICE_CODE_FIELD` 由调用方保证已在其中）。

    返回
    ----
    (conditions, logic)，conditions 已剔除空值条件（value 为空且算子需要值）。
    """
    text = (raw or "").strip()
    if not text:
        return [], "and"

    if len(text) > 4000:
        raise FilterError(f"筛选条件过长（{len(text)} 字符，上限 4000），请减少条件数")
    try:
        items = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FilterError(f"筛选条件不是合法 JSON：{exc.msg}") from exc
    if not isinstance(items, list):
        raise FilterError("筛选条件必须是 JSON 数组")

    allowed = set(allowed_fields)
    out: List[Dict[str, str]] = []
    for idx, raw_item in enumerate(items, start=1):
        if not isinstance(raw_item, dict):
            raise FilterError(f"第 {idx} 条条件不是对象")
        field = str(raw_item.get("field") or "").strip()
        op = str(raw_item.get("op") or "").strip()
        if not field:
            raise FilterError(f"第 {idx} 条条件缺少字段")
        if len(field) > MAX_FIELD_LEN:
            raise FilterError(f"第 {idx} 条条件的字段名过长")
        if op not in ALLOWED_OPS:
            raise FilterError(
                f"第 {idx} 条条件的匹配方式「{op}」不支持，可选：{'、'.join(OPS.values())}"
            )
        # 🔴 白名单校验：不认识就不筛，绝不放行（防止注入 + 防止「筛了个不存在的字段还以为生效了」）
        if field not in allowed:
            raise FilterError(f"第 {idx} 条条件的字段「{field}」不属于这张表")

        value = raw_item.get("value")
        value = "" if value is None else str(value).strip()
        if len(value) > MAX_VALUE_LEN:
            value = value[:MAX_VALUE_LEN]

        # 空值算子不需要 value；有值算子空 value 直接丢弃该条（等价于没这条条件）
        if op not in OP_VALUELESS and value == "":
            continue
        out.append({"field": field, "op": op, "value": value})

        if len(out) > MAX_CONDITIONS:
            raise FilterError(f"条件数超过上限 {MAX_CONDITIONS} 条，请先清空部分条件")

    return out, "and"   # logic 由 parse_logic 单独解析（独立参数，避免塞进数组里丢失）


def parse_logic(raw: Optional[str]) -> str:
    """解析顶层组合方式；空 → `and`；非法 → 400。"""
    value = (raw or "").strip().lower()
    if not value:
        return "and"
    if value not in ALLOWED_LOGIC:
        raise FilterError(f"组合方式「{raw}」不支持，可选：and / or")
    return value


def _json_val_expr(field: str, alias: str = "records") -> str:
    """构造「取该 JSON 键的文本值」SQL 片段。

    用 `json_extract(..., '$."key"')`：key 走绑定参数（`:k`），不拼进 SQL 字符串。
    取不到时 `json_extract` 返回 NULL，`COALESCE(...,'')` 之后按空串处理，
    于是「该行根本没有这个键」与「键存在但值为空」在筛选上等价 —— 与用户直觉一致。
    """
    return f"COALESCE(CAST(json_extract({alias}.data, '$.' || :fk_{field}) AS TEXT), '')"


def build_filter_clause(
    conditions: List[Dict[str, str]],
    logic: str,
):
    """把条件编译成一个 SQL 布尔表达式（AND / OR 组合）。

    返回 `None` 表示**无条件**（调用方直接跳过加 WHERE，省一次 json_extract）。
    🔴 所有字面量都走 `:pv_i` 绑定参数，字段名走 `:fk_i` 绑定参数，
       **没有任何一个用户值被拼进 SQL 文本**。
    """
    if not conditions:
        return None

    fragments = []
    binds: Dict[str, str] = {}
    for i, cond in enumerate(conditions):
        field, op, value = cond["field"], cond["op"], cond.get("value", "")
        fk, pv = f"fk_{i}", f"pv_{i}"
        binds[fk] = field

        if field == DEVICE_CODE_FIELD:
            # 关联键：独立列（COALESCE 把 NULL 视作空串，与「没有这个键」同义）
            frag, used = _pred(_DEV_CODE_COL, op, value, pv)
        else:
            # JSON 字段：值列用 :fk_i 取键，取不到 → '' （缺键与空值等价）
            frag, used = _pred(_json_val(fk), op, value, pv)
        binds[pv] = used
        fragments.append(frag)

    combined = and_(*fragments) if logic == "and" else or_(*fragments)
    # 🔴 绑定参数必须挂在**最终表达式**上：SQLAlchemy 只认链尾节点的 bindparams
    for name, val in binds.items():
        combined = combined.params(**{name: val})
    return combined


# 关联键列表达式（无绑定键，可直接复用）
_DEV_CODE_COL = sa_text("COALESCE(records.device_code, '')")


def _json_val(fk: str):
    """`json_extract` 取 JSON 键的文本值；:fk 是**绑定参数**（键名不拼进 SQL）。"""
    return sa_text(
        f"COALESCE(CAST(json_extract(records.data, '$.' || :{fk}) AS TEXT), '')"
    )


def _pred(col, op: str, value: str, pv: str):
    """产出「列 vs 字符串」谓词，返回 `(表达式, 该表达式用到的 :pv 绑定值)`。

    🔴 `col` 是 `TextClause`（带 json_extract / LOWER），**它没有 .like() 方法**
       —— 必须走 SQL 表达式函数 `func.lower(...) LIKE :pv`，否则 AttributeError。
    空值算子不用 :pv（返回 `None`，调用方不应再绑它）。
    """
    # 空/非空：TRIM 判空白，与用户「填了但只打空格」的直觉一致
    if op == "is_empty":
        return sa_text(f"({col} = '' OR TRIM({col}) = '')"), None
    if op == "not_empty":
        return sa_text(f"({col} != '' AND TRIM({col}) != '')"), None

    low = func.lower(col)
    lit = value.lower()

    if op == "eq":
        return low == sa_text(f":{pv}"), lit
    if op == "ne":
        return low != sa_text(f":{pv}"), lit

    # LIKE 类：pattern 一律走绑定参数，转义已在 _escape_like 完成
    if op == "contains":
        return low.like(sa_text(f":{pv}"), escape="\\"), _like_pattern(value)
    if op == "not_contains":
        return low.not_like(sa_text(f":{pv}"), escape="\\"), _like_pattern(value)
    if op == "starts_with":
        pat = _escape_like(lit) + "%"
        return low.like(sa_text(f":{pv}"), escape="\\"), pat
    if op == "ends_with":
        pat = "%" + _escape_like(lit)
        return low.like(sa_text(f":{pv}"), escape="\\"), pat

    raise FilterError(f"不支持的匹配方式：{op}")


def describe_ops() -> Dict[str, str]:
    """给前端下拉用的算子字典（避免前后端各写一套文案）。"""
    return dict(OPS)