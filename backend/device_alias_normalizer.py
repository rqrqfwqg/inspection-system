"""设备编号别名归一内核（device alias normalization）

背景
----
`device_aliases` 是既有的编号桥接表（2327 行：fixed_asset 1698 + fixed_bim 629），
把移交编号 / 资产代码 / BIM 标签等**非台账编号**映射到规范 `device_code`。
设备台账「重复设备手动合并」会复用这张表写入 `source='merge'`：
被合并掉的旧编号 B 落成 `alias_code → A`，于是**现场用旧编号扫二维码仍能查到主设备 A**。

由此产生一个必须收口的问题
------------------------
写接口在拿不到显式 `device_code` 时，会**从关联键字段（`is_relation_key=1`）的值反推**
（见 `asset_routes.py` 的 `create_record` / `bulk_create_records` / 跨表转移）。
如果合并只改了 `records.device_code` 这一列、没同步改 `records.data` 里的关联键值，
那么下一次导入/编辑同一条记录时，**B 会被重新写回 `records.device_code`**：
B 复活 → 台账总数反弹 → 合并白做。

对策（本模块提供）
-----------------
1. **写侧归一**：任何准备落库的 `device_code` 先过 `resolve_device_code()`，
   命中别名则换成规范编号。这是**兜底防线**——即使 JSON 里还留着旧编号，
   写路径也会自动归一，不会让旧编号复活。
2. **读侧归一**：按编号直查设备的既有端点统一走 `resolve_device_code()`，
   旧编号可解析到主设备（用户已拍板：本期一并归一，不留404）。
3. **合并侧重算**：合并事务用 `rewrite_relation_key_value()` 同步重算 JSON 里的关联键值，
   让数据本身自洽（不只是兜底）。

不变式（务必保持）
----------------
- 归一**只认 `device_aliases` 表**，不做任何"猜"（不按名称、不按型号、不按位置）。
- 归一**必须抗链**：`a→b→c` 也要收敛到最终规范编号，并设深度上限防环。
- 归一**幂等**：对已是规范编号的输入无副作用。
- 归一**绝不删除数据**：命中别名只是换一个编号写下去。
"""

import time
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import DeviceAlias

# 链式别名深度上限。实测线上 CHAINED=0（无链），设 8 纯属防御性兜底；
# 超过上限视为数据异常，按原样返回并由调用方决定是否告警，绝不无限循环。
_MAX_ALIAS_DEPTH = 8


def _flatten_alias_map(raw: Dict[str, str]) -> Tuple[Dict[str, str], Dict[str, List[str]]]:
    """把**可能含链**的 `{alias: canonical}` 直接映射平成 `{alias: 最终规范编号}`。

    用**迭代式**沿链走（而非递归），避免成环导致栈溢出。
    遇环或超深（> `_MAX_ALIAS_DEPTH`）视为数据异常，**放弃解析**：
    该别名不进索引 → 归一时原样返回（保守：宁可不改，也不误指向一台无关设备）。

    返回 `(resolved, chains)`；`chains` 记录走了一格以上的原始路径，供人工排查。
    """
    resolved: Dict[str, str] = {}
    chains: Dict[str, List[str]] = {}
    for start in raw:
        path: List[str] = []
        seen: Set[str] = set()
        node = start
        final = start
        ok = True
        while True:
            if node in seen:
                ok = False  # 成环，放弃
                break
            seen.add(node)
            path.append(node)
            nxt = raw.get(node)
            if nxt is None:
                final = node  # 走到头，当前节点就是规范编号
                break
            if len(path) > _MAX_ALIAS_DEPTH:
                ok = False  # 超深，放弃
                break
            node = nxt
        if not ok:
            continue
        # 只把**中间节点**写进索引，终点（最终规范编号）不能写：
        # 否则 `a→b` 这种单跳映射会把规范编号 b 也标成"别名"，
        # 导致 is_alias(b)=True、resolve(b) 误报重定向——
        # 而合并流程正是靠 is_alias 判断"该编号是否已被合并过"，必须准确。
        for p in path[:-1]:
            resolved[p] = final
        # 仅当走了**两格以上**（len(path)>=3，即 a→b→c 且 c 才是终点）才算链式；
        # 单跳 a→b 是正常的直接映射，不算链（否则线上 2327 条会被全量误报为链）。
        if len(path) >= 3:
            chains[start] = list(path)
    # 终点若是另一条别名的 key（即仍需继续解析），已在各自 start 分支写入；
    # 孤立终点（不在 raw 里作为 key 出现）不在索引中，天然是规范编号。
    return resolved, chains


class AliasNormalizer:
    """别名归一器。

    一次构造、多次复用：把整张 `device_aliases` 表读进内存建索引，
    之后每条记录写入都是 O(1) 字典查询，不再打 DB。

    索引形态：`{alias_code: canonical_code}`，值为**直接指向最终规范编号**
    （构造时已把链式解析平掉），因此查询时不需要循环。
    """

    def __init__(self, alias_map: Dict[str, str], chains: Optional[Dict[str, List[str]]] = None):
        """`alias_map` 可以是**原始直接映射**（含链），本类会自行把链式解析平掉。

        早期版本把解析逻辑只放在 `load()` 里，导致直接 `AliasNormalizer({...})`
        构造时链式节点原样返回（`c→b→a` 只走到 b）——那是真 bug。
        现在两条路径共用 `_flatten_alias_map`，行为一致。
        """
        resolved, detected = _flatten_alias_map(alias_map or {})
        self._map: Dict[str, str] = resolved
        # 记录哪些别名是从链式路径解析出来的（便于排查），值是原始路径
        self._chains: Dict[str, List[str]] = dict(detected)
        if chains:
            self._chains.update(chains)
        # 命中过链的别名集合 → 数据质量问题，合并时应提示人工复查
        self.chained_aliases: Set[str] = set(self._chains.keys())

    # ---------- 构造 ----------

    @classmethod
    def load(cls, db: Session) -> "AliasNormalizer":
        """从库里加载全量别名（链式解析在 `__init__` 内统一完成）。"""
        raw: Dict[str, str] = {}
        for alias_code, canonical_code in db.query(
            DeviceAlias.alias_code, DeviceAlias.canonical_code
        ).all():
            a = (alias_code or "").strip()
            c = (canonical_code or "").strip()
            if a and c and a != c:
                raw[a] = c
        return cls(raw)

    # ---------- 查询 ----------

    def canonical(self, code: Any) -> str:
        """归一单个编号。已是规范编号或未命中别名时原样返回（去空白）。"""
        c = str(code or "").strip()
        if not c:
            return ""
        return self._map.get(c, c)

    def is_alias(self, code: Any) -> bool:
        c = str(code or "").strip()
        return bool(c) and c in self._map

    def resolve(self, code: Any) -> Tuple[str, bool]:
        """返回 `(归一后编号, 是否发生了重定向)`。"""
        c = str(code or "").strip()
        if not c:
            return "", False
        target = self._map.get(c)
        if target is None:
            return c, False
        return target, True

    def redirect_map(self, codes: Iterable[Any]) -> Dict[str, str]:
        """批量取出 `{原编号: 归一编号}`，只含真正发生重定向的条目。"""
        out: Dict[str, str] = {}
        for c in codes or []:
            s = str(c or "").strip()
            if not s:
                continue
            t = self._map.get(s)
            if t is not None and t != s:
                out[s] = t
        return out

    def stats(self) -> Dict[str, Any]:
        return {
            "alias_total": len(self._map),
            "chained_total": len(self.chained_aliases),
            "chained_sample": sorted(self.chained_aliases)[:10],
        }


# ---------- 模块级单例（写路径热路径，避免每请求重查） ----------

_normalizer: Optional[AliasNormalizer] = None
_fingerprint: List[Any] = [(-2, -2)]  # [(行数, max(id))]，哨兵值强制首次重建
_checked_at: List[float] = [0.0]        # 上次指纹检查的单调钟时刻

# 指纹检查的最小间隔（秒）。跨进程可见性的最坏延迟 = TTL；
# 取5s 是权衡：合并事务本身会显式 refresh=True 立即生效，
# TTL 只是兜底「别的进程写了别名」的罕见场景，不需要强一致。
_FINGERPRINT_TTL_SEC = 5.0


def _alias_fingerprint(db: Session) -> Tuple[int, int]:
    """别名表指纹：`(行数, max(id))`。

    用于**跨进程自动失效**。合并事务写入 `source='merge'` 别名后，
    只有当前进程被显式 refresh 了；其他 worker 进程仍持有旧索引，
    旧编号在那些进程里不会被归一 → 台账总数反弹。
    用 (行数, max(id)) 做指纹：任何新增/删除/重建都会改变它，
    下次调用时自动检测并重建，无需跨进程通信。
    """
    try:
        row = db.query(
            func.count(DeviceAlias.id), func.max(DeviceAlias.id)
        ).one()
        return (int(row[0] or 0), int(row[1] or 0))
    except Exception:
        return (-1, -1)  # 查询失败：不缓存，避免用陈旧索引


def get_normalizer(db: Session, refresh: bool = False) -> AliasNormalizer:
    """取全局归一器。

    失效策略（两级）：
    - `refresh=True`：合并事务写完别名后显式重建（立即生效）；
    - 自动：比对 `(行数, max(id))` 指纹，别的进程写了别名也能感知
      （最多一次额外 COUNT，SQLite 上是微秒级）。
    """
    global _normalizer
    if _normalizer is None or refresh:
        _normalizer = AliasNormalizer.load(db)
        _fingerprint[0] = _alias_fingerprint(db)
        return _normalizer
    # 指纹检查按 TTL 节流：每次都 COUNT(*) 在批量导入场景（一次请求写 5000 行）
    # 会把开销放大到秒级。TTL 内直接复用缓存，超时才做一次指纹比对。
    now = time.monotonic()
    if (now - _checked_at[0]) >= _FINGERPRINT_TTL_SEC:
        if _fingerprint[0] != _alias_fingerprint(db):
            _normalizer = AliasNormalizer.load(db)
            _fingerprint[0] = _alias_fingerprint(db)
        _checked_at[0] = now
    return _normalizer


def reset_normalizer() -> None:
    """清空缓存（测试用）。"""
    global _normalizer
    _normalizer = None
    _fingerprint[0] = (-2, -2)  # 哨兵值，强制下次重建


def resolve_device_code(db: Session, code: Any, refresh: bool = False) -> str:
    """**写/读路径统一入口**：把任意编号归一到规范 `device_code`。"""
    return get_normalizer(db, refresh=refresh).canonical(code)


# ---------- 合并侧：JSON 关联键值重算 ----------

def rewrite_relation_key_value(
    data: Optional[Dict[str, Any]],
    key: Optional[str],
    old_code: str,
    new_code: str,
) -> Tuple[Dict[str, Any], bool]:
    """把 `records.data` 里关联键字段的值由 `old_code` 改写为 `new_code`。

    为什么必须改（而不是只改 `records.device_code` 列）：
    写接口在拿不到显式 `device_code` 时会从关联键字段的值反推
    （`asset_routes.py:create_record` / `bulk_create_records` / 跨表转移）。
    只改列不改 JSON，下次同一条记录被编辑或重导入时，旧编号会被写回，
    旧设备"复活"、台账总数反弹，合并白做。

    仅在**值恰好等于 old_code** 时改写：
    - 不做模糊匹配，不碰别的字段值（搜索键 `is_search_key` 保持原样，
      让旧编号仍能在资料表里被检索到——这是刻意保留的可用性）。
    - 空值 / None / 类型不符一律不动。
    - 返回 `(新 data, 是否发生改写)`；不改写时返回**同一对象**，避免无谓的脏写。
    """
    if not isinstance(data, dict) or not key or not old_code or not new_code:
        return (data or {}), False
    if old_code == new_code:
        return data, False
    cur = data.get(key)
    # 只认"字符串且完全相等"；数值型/None 一律不动（避免误伤真值字段）
    if not isinstance(cur, str) or cur.strip() != old_code:
        return data, False
    new_data = dict(data)
    new_data[key] = new_code
    return new_data, True


def plan_relation_key_rewrite(
    records: Iterable[Tuple[int, Optional[Dict[str, Any]], Optional[str]]],
    key: Optional[str],
    old_code: str,
    new_code: str,
) -> Dict[str, Any]:
    """预演：给定 `(id, data, table_id)` 列表，算出会改写哪些行。

    合并的 dry_run 与正式执行**必须走同一个函数**，否则预演数字和实际不符。
    """
    hit: List[int] = []
    for rid, data, _tid in records:
        _, changed = rewrite_relation_key_value(data, key, old_code, new_code)
        if changed:
            hit.append(rid)
    return {"relation_key": key, "old_code": old_code, "new_code": new_code, "record_ids": hit, "count": len(hit)}