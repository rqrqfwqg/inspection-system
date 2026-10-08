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
    {"field": "floor", "op": "eq", "values": ["负二楼", "负一楼"]}   ← 多值（组内 OR）

  - `field` 特殊值 `"__device_code"` → 筛 `records.device_code`（关联键，独立列）；
    其余为 `records.data` JSON 内的键。
  - `op` ∈ `eq` / `ne` / `contains` / `not_contains` / `starts_with` / `ends_with`
      / `is_empty` / `not_empty`
  - `value` 对 `is_empty` / `not_empty` 忽略。
  - 🔴 `values`（多值）与 `value`（单值）**同时给时以 `values` 为准**（value 被忽略）。
    两者都不给 / 全空白 → 该条视为未填，直接丢弃。

`logic` ∈ `and` / `or`（顶层组合方式，缺省 `and`）。**组内多值恒为 OR 语义**，
故 `values` 的作用范围是「一条条件内部」，与 `logic` 的「条件之间」正交。

多值的组内语义（🔴 否定算子必须与直觉一致，这里是最容易做错的地方）
--------------------------------------------------------------------
| 算子                | 组内编译               | 例子 values=["A","B"] 的含义        |
|---------------------|------------------------|-------------------------------------|
| eq / contains       | `p(A) OR p(B)`         | 等于 A 或 B                          |
| starts_with         | 同上                   | 开头是 A 或 B                        |
| ends_with           | 同上                   | 结尾是 A 或 B                        |
| **ne / not_contains** | `p(A) **AND** p(B)`   | 既不等于 A 也不等于 B                |
| is_empty / not_empty | 忽略 values           | 与单值完全相同                        |

🔴 **否定算子必须编译成 AND（= NOT(OR(...))），不能是 OR**：
   若按 OR 编译，`ne` 多选 [A,B] 会变成 `col!=A OR col!=B` —— 除「同时等于 A 和 B」
   这种不可能情形外**几乎全表命中**，用户以为筛掉了两类、实际等于没筛。
   这是典型的「筛选静默失效」，比报错更危险。同理 `not_contains`。

铁律
----
1. 🔴 **绝不拼接 SQL**：字段名与值一律走绑定参数 / `json_extract` 绑定键，
   值里的 `%` `_` 与反斜杠必须转义（LIKE 通配符，§13 事故③ 曾因 `q=%` 命中全表）。
2. 🔴 **字段名先白名单校验**：只允许出现在该表 `field_defs` 里的 key，
   杜绝任意键注入与「筛一个根本不存在的字段」。
3. 🔴 **未知 op / 未知 logic 一律 400**，绝不静默忽略条件（静默忽略会让用户
   以为筛选已生效，实际没生效 —— 排查时最容易被骗的地方）。
4. 🔴 **条件数与长度上限**：最多 20 条条件（防拼超长 URL 与全表 json_extract 风暴），
   单值截断到 200 字符（对齐 `q` 的 100 字符口径放宽一倍），
   单条条件的 `values` 最多 50 个（与候选端点 limit 上限同量级）。
5. 🔴 **单值条件逐字节等价改造前**：`values` 长度为 1 时**不额外套 `or_()`**，
   生成的 SQL 形状与只有 `value` 的老条件完全一致（这是回滚安全的前提）。
6. **只读**：本模块不写库、不改缓存，仅产出 `WHERE` 片段。

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
MAX_VALUES_PER_COND = 50

# 🔴 否定算子：多值时组内必须编译成 AND（= NOT(OR(...))），不能是 OR。
#    理由见模块 docstring「多值的组内语义」：按 OR 编译会让 ne 多选几乎全表命中，
#    属于「筛选静默失效」——用户以为筛掉了两类，实际等于没筛。
NEGATIVE_OPS = frozenset({"ne", "not_contains"})

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
    return "%" + _escape_like(ascii_lower(value)) + "%"


def ascii_lower(s: str) -> str:
    """🔴 **只折叠 ASCII 大写**的字符串小写化（与 SQLite `lower()` 逐字符等价）。

    为什么不能用 `str.lower()`：SQLite 内建 `lower()` **只处理 ASCII**，
    实测（服务器 app.db 同版本 sqlite）`lower('Ä')='Ä'`、`lower('ä')='ä'`、
    `lower('2#楼')='2#楼'` —— 非 ASCII 一律原样返回。
    本模块所有大小写不敏感匹配（`eq`/`ne`/`contains`…）都走 `func.lower()`，
    故候选值枚举侧（`record_field_values`）也**必须**用同样的 ASCII 折叠，
    否则会出现「下拉里选得到、筛起来中不中」——
    例如库里同时有 `UPS` 与 `ÄPF`：Python `str.lower()` 会把两者折叠成一类，
    而 SQL 不会，候选列表就会多出一条永远筛不中的项。
    """
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


def _clean_value(raw: Any) -> str:
    """把任意原始值规整成条件值：None → ""，其余 str().strip()，超长截断。"""
    text = "" if raw is None else str(raw).strip()
    if len(text) > MAX_VALUE_LEN:
        text = text[:MAX_VALUE_LEN]
    return text


def _norm_values(raw: Any, idx: int) -> List[str]:
    """解析条件里的 `values`（多值），返回**去重后**的干净值列表。

    语义要点：
      - 元素**逐个规整**（None → ""、strip、超长截断），与单值 `value` 同一口径；
      - 🔴 去重按 **ASCII 折叠**（`ascii_lower`）而不是原值：匹配本身大小写不敏感，
        所以 `["UPS", "ups"]` 实质是同一个条件，留着只会让 SQL 多一个 OR 分支，
        且前端「已选 2 个」会显示成 2 个其实等价的值 → 误导。
      - 顺序保留（用户的选择顺序），空串直接剔除（等价于没填）。
      - 超过上限一律 400（不静默截断 —— 静默截断会让用户以为全选上了）。
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        # 容错：单个值误传成字符串时按单元素处理，而不是整条条件失效
        items: List[Any] = [raw]
    elif isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        raise FilterError(f"第 {idx} 条条件的 values 必须是字符串数组")

    if len(items) > MAX_VALUES_PER_COND:
        raise FilterError(
            f"第 {idx} 条条件选了 {len(items)} 个值，超过单条上限 {MAX_VALUES_PER_COND} 个"
        )

    out: List[str] = []
    seen = set()
    for it in items:
        val = _clean_value(it)
        if not val:
            continue
        key = ascii_lower(val)
        if key in seen:
            continue
        seen.add(key)
        out.append(val)
    return out


def parse_filters(
    raw: Optional[str],
    allowed_fields: Iterable[str],
) -> Tuple[List[Dict[str, Any]], str]:
    """解析 `filters` 查询串 → `(条件列表, logic)`。

    参数
    ----
    raw:            URL 上的 `filters` 原始串（JSON 数组字符串）。空/None → 空列表。
    allowed_fields: 该表**允许筛选的字段 key 集合**（来自 field_defs；
                     `DEVICE_CODE_FIELD` 由调用方保证已在其中）。

    返回
    ----
    (conditions, logic)。conditions 元素形如
    `{"field": str, "op": str, "values": [str, ...]}`，
    已剔除未填完整的条件（需值算子且值列表为空）。

    🔴 单值条件也归一化成 `values` 长度为 1 的列表 —— 调用方只需一套逻辑，
       且 `build_filter_clause` 对长度 1 **不套 or_()**，SQL 与改造前逐字节一致。
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
    out: List[Dict[str, Any]] = []
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

        # 🔴 `values` 与 `value` 同时给时以 `values` 为准（多选 superset 单选，
        #    前端切到多选后残留的 value 不该把多选覆盖回一个）。
        if "values" in raw_item and raw_item.get("values") is not None:
            values = _norm_values(raw_item.get("values"), idx)
        else:
            one = _clean_value(raw_item.get("value"))
            values = [one] if one else []

        # 空值算子不需要值；有值算子空值列表直接丢弃该条（等价于没这条条件）
        if op not in OP_VALUELESS and not values:
            continue
        out.append({"field": field, "op": op, "values": [] if op in OP_VALUELESS else values})

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


def build_search_clause(keyword: str):
    """构造行级搜索 `q` 的谓词（`None` = 不搜索）。

    🔴 **必须是 `list_records` 与命中归因端点的唯一真源**：
       两者若各写一份 q 逻辑，归因数字就会与实际筛选结果对不上
       （用户看到「这条能命中 8 条」却筛出 0 条）—— 比不给归因更伤排查。
       所以语义只在这里定义一次，两处都调用它。

    语义（与改造前逐字节一致，勿擅自调整）：
      - device_code 命中（大小写不敏感子串）**或** records.data 的【值】命中（**非键**）；
      - 空/纯空白 keyword 视为不过滤；
      - 超长截断到 100 字符，**不报错**（§13 铁律：不得宣传一个不强制执行的限制）。
    """
    kw = (keyword or "").strip()[:100]
    if not kw:
        return None
    # LIKE 通配符必须转义（§13 事故③：q=% 曾命中全表）；值走绑定参数，绝不拼接 SQL。
    pat = "%" + kw.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    json_val_hit = sa_text(
        "EXISTS (SELECT 1 FROM json_each(records.data) "
        "WHERE LOWER(CAST(json_each.value AS TEXT)) LIKE :kw ESCAPE '\\')"
    ).bindparams(kw=pat)
    return or_(
        func.lower(func.coalesce(DEVICE_CODE_COL_SQL, "")).like(pat, escape="\\"),
        json_val_hit,
    )


# device_code 列的裸 SQL 表达式（q 搜索与多值筛选共用同一口径：NULL 视作空串）
DEVICE_CODE_COL_SQL = "records.device_code"


def build_filter_clause(
    conditions: List[Dict[str, Any]],
    logic: str,
):
    """把条件编译成一个 SQL 布尔表达式（AND / OR 组合）。

    返回 `None` 表示**无条件**（调用方直接跳过加 WHERE，省一次 json_extract）。
    🔴 所有字面量都走 `:pv_*` 绑定参数，字段名走 `:fk_*` 绑定参数，
       **没有任何一个用户值被拼进 SQL 文本**。

    组内多值语义见模块 docstring。两条关键实现约束：
      - 🔴 `values` 长度为 1 时**不套 `or_()`**（直接返回该谓词本身）——
        这样「改造前的单值条件」与「多值 UI 只选了一个」生成的 SQL **逐字节相同**，
        是回滚/对比安全的前提。
      - 🔴 绑定参数名按 **条件序号 + 值序号** 唯一化（`pv_{i}_{j}`）：多值展开后
        同一条件会有多个字面量，若都叫 `pv_{i}` 会互相覆盖（后者赢）→ 静默筛错。
    """
    if not conditions:
        return None

    fragments = []
    binds: Dict[str, str] = {}
    for i, cond in enumerate(conditions):
        field, op = cond["field"], cond["op"]
        fk = f"fk_{i}"
        binds[fk] = field

        # 🔴 兼容老结构 `{"field","op","value"}`：**本函数是导出的裁决点**，
        #    单元测试与未来调用方可能不经 parse_filters 直接喂单值条件。
        #    缺 values 时回落读 value（而不是静默变成「无条件」）—— 后者会让
        #    调用方以为筛了、实际返回全表，是最难查的一类静默失效。
        if "values" in cond:
            values = [_clean_value(v) for v in (cond.get("values") or [])]
        else:
            legacy = _clean_value(cond.get("value"))
            values = [legacy] if legacy else []

        col = _DEV_CODE_COL if field == DEVICE_CODE_FIELD else _json_val(fk)

        # 空值算子：一个条件一个片段，不需要 :pv
        if op in OP_VALUELESS:
            frag, used = _pred(col, op, "", f"pv_{i}_0")
            if used is not None:
                binds[f"pv_{i}_0"] = used
            fragments.append(frag)
            continue

        if not values:
            # parse_filters 已剔除未填条件；这里兜底（调用方手工构造 conditions 时）不生成谓词
            continue

        per_value = []
        for j, val in enumerate(values):
            pv = f"pv_{i}_{j}"
            pfrag, used = _pred(col, op, val, pv)
            if used is not None:
                binds[pv] = used
            per_value.append(pfrag)

        if len(per_value) == 1:
            # 🔴 单值不套 or_()：保持与改造前逐字节一致
            fragments.append(per_value[0])
        elif op in NEGATIVE_OPS:
            # 否定算子组内 AND（= NOT(OR(...))），否则几乎全表命中
            fragments.append(and_(*per_value))
        else:
            fragments.append(or_(*per_value))

    if not fragments:
        return None

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
    # 🔴 值侧也必须 ASCII 折叠（ascii_lower），与 SQL 侧 func.lower() 严格对称：
    #    若这里用 Python 的 str.lower()，输入「Ä」会被折成「ä」，而库里的「Ä」
    #    经 SQL lower() 仍是「Ä」→ 双向都匹配不上，且**不报错**（静默漏筛）。
    lit = ascii_lower(value)

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