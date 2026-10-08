"""筛选条件的**命中归因**（每条条件单独能命中多少行）

背景
----
筛选出 0 条时，用户面对的是一排条件条 —— **看不出是哪一条把结果杀成 0 的**。
`filter_logic=and` 时，任意一条不匹配就全表归零；`or` 时又是另一种归零原因。
本模块给出**每条条件的独立命中数**（把其它条件全部放开，只留这一条），
前端把它显示在条件行尾，用户一眼就能看出「是这条太严」还是「组合起来没交集」。

口径（🔴 必须与 `list_records` 完全一致，否则归因数字会骗人）
--------------------------------------------------------
1. **同源**：白名单、`parse_filters`、`build_filter_clause`、q 搜索、字段取值表达式
   全部复用同一套实现 —— 归因数字若与实际筛选走两套逻辑，
   就会出现「说命中 5 条、筛出来 0 条」，比不给归因更糟。
2. **独立命中**：`stats[i]` = 只有第 i 条条件生效时的命中行数（`q` 仍然生效，
   因为 q 是搜索框的独立语义，不属于「这些条件」）。
3. **总量**：`total` = 不带任何条件、只带 q 的命中行数 —— 即归因的分母。
4. 只读，不写库。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session


def _count_with(db: Session, tid: int, clause, device_code: Optional[str]) -> int:
    """在「该表 + device_code + 条件」下数行。

    用 `select(func.count())` 走 SQL 层 COUNT，不把行拉进 Python 内存 ——
    最大表 4587 行还行，但台账域的表可以很大，拉行的做法不可持续。
    """
    from database import Record

    qq = db.query(func.count(Record.id)).filter(Record.table_id == tid)
    if device_code:
        qq = qq.filter(Record.device_code == device_code)
    if clause is not None:
        qq = qq.filter(clause)
    return int(qq.scalar() or 0)


def compute_filter_stats(
    db: Session,
    tid: int,
    conditions: List[Dict[str, Any]],
    logic: str = "and",
    device_code: Optional[str] = None,
    q_clause=None,
) -> Dict[str, Any]:
    """产出每条条件的独立命中数。

    参数
    ----
    conditions: `parse_filters` 的产物（已剔除未填条件）。
    logic:      条件之间的组合方式（`parse_logic` 的产物），决定 `combined`。
    device_code: 可选，限定关联键（与 `list_records` 同参数）。
    q_clause:    行级搜索谓词（由调用方用 `record_filters.build_search_clause` 构造，
                与 `list_records` **同一个函数**，杜绝两套语义）。

    返回
    ----
    `{"total": int, "combined": int, "counts": [int, ...]}`，其中
      - `total`    不带条件、只带 q 的行数；
      - `combined` 全部条件按 logic 组合后的行数（== 前端实际会看到的条数）；
      - `counts`   与 `conditions` **等长同序**，第 i 项是第 i 条条件的独立命中数。

    🔴 `counts` 与 `conditions` 等长同序（而不是只返回命中数的那几条）——
       前端按下标直接取，不要自己在前端做「过滤掉 0」的对齐（那极易错位）。
    """
    from record_filters import build_filter_clause

    total = _count_with(db, tid, q_clause, device_code)
    # 每条条件单独生效（其余放开）——这才是「是哪条太严」的答案
    counts: List[int] = [
        _count_with(db, tid, _and2(q_clause, build_filter_clause([c], "and")), device_code)
        for c in conditions
    ]
    combined = _count_with(
        db, tid, _and2(q_clause, build_filter_clause(conditions, logic)), device_code
    )
    return {"total": total, "combined": combined, "counts": counts}


def _and2(q_clause, filter_clause):
    """把 q 谓词与筛选谓词 AND 起来；任一为 None 直接返回另一个（不套空表达式）。"""
    from sqlalchemy import and_

    parts = [c for c in (q_clause, filter_clause) if c is not None]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return and_(*parts)