"""新建设备「AI 补全」建议：编号按拼音首字母规则生成，大模型只做四件"理解"类判断。

红线（与需求逐条对应）
----------------------
1. **设备编号字符串绝不由大模型生成** —— 一律由本文件的规则产出：
   `<地名缩写>-<设备名缩写>-<两位尾数>`，缩写 = 拼音首字母（ASCII 字母数字原样保留）。
2. 大模型只做四件事：识别设备类型 / 推断所属系统 / 按位置描述挑机房 / 规范化位置描述。
3. 模型输出**全部白名单校验**（子系统必须真实存在、机房必须在候选集内、楼栋楼层必须
   在库中已有取值集合内）；校验不过 → 丢弃该字段并放进 missing，
   ⛔ 绝不把模型原话直接塞进字段。
4. 推断不出 → missing + 一句人话原因，**绝不填默认值**（不默认「其他系统」、不默认 GTC）。
5. 模型超时/报错 → 降级纯规则（关键词表识别类型与系统），仍返回 200，不让用户卡住。
6. 日志（backend/logs/ai_suggest.log）**不写密钥、不写模型原文**。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from agent_llm import LLMConfig, LLMError, OpenAICompatProvider
from database import Room, Subsystem


class SuggestRateLimited(Exception):
    """同一用户 1 分钟内调用超过上限（映射为 HTTP 429）。"""


class SuggestBadInput(Exception):
    """入参不足（映射为 HTTP 400）。"""


# ===== 可调参数（全部走环境变量，改完重启即生效，不必改代码）=====
LLM_TIMEOUT_S = float(os.environ.get("ASSET_AI_TIMEOUT_S", "9") or 9)   # 8-10s
RATE_LIMIT_PER_MIN = int(os.environ.get("ASSET_AI_RATE_PER_MIN", "6") or 6)
_MAX_SEG = 6            # 每段缩写长度上限
_MAX_TAIL_TRIES = 20    # 尾数重试上限
# 建议号「占位」有效期：本接口只给建议、不落库，若不做短期占位，
# 同一位置连点两次会拿到同一个 01（用户容易以为系统没生效）。
# 故生成后占位 TTL 秒，占位期内后续请求继续 +1；过期自动释放，不需要人工清理。
_RESERVE_TTL = float(os.environ.get("ASSET_AI_CODE_RESERVE_TTL", "300") or 300)

LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
LOG_PATH = os.path.join(LOG_DIR, "ai_suggest.log")

_ALNUM_RE = re.compile(r"[A-Za-z0-9]")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")

try:  # 纯 Python，无编译依赖；装不上则缩写对中文失效 → 该段回落 DEV（见 _abbr）
    from pypinyin import Style, lazy_pinyin
    _HAS_PINYIN = True
except Exception:  # noqa: BLE001
    _HAS_PINYIN = False


# ========================= 拼音缩写（纯程序，绝不用模型） =========================

def _abbr(text: str, limit: int = _MAX_SEG) -> str:
    """中文名 → 拼音首字母缩写（全大写拉丁字母）。

    - 阿拉伯数字与英文字母原样保留（GTC / 1 …）；
    - 空格、#、-、（）、() 、、 等符号一律丢弃；
    - 超长截断到 limit（默认 6）；全符号 → 返回空串（由调用方回落 DEV）。
    """
    s = (text or "").strip()
    if not s:
        return ""
    if _HAS_PINYIN and _CJK_RE.search(s):
        try:
            s = "".join(lazy_pinyin(s, style=Style.FIRST_LETTER, errors=lambda x: list(x)))
        except Exception:  # noqa: BLE001 拼音库异常不该拖垮建档
            pass
    out = [ch.upper() for ch in s if _ALNUM_RE.match(ch)]
    return "".join(out)[:limit]


def _strip_buildings(text: str, buildings: List[str]) -> str:
    """剥掉文本里的楼栋名（GTC / 东停车楼 …），避免缩写里塞进楼栋占满 6 位。

    按长度倒序处理：「东停车楼」必须在「停车楼」之前剥，否则会残留「东」。
    """
    s = (text or "").strip()
    if not s:
        return ""
    for b in sorted([b for b in buildings if b], key=len, reverse=True):
        if b.upper() in s.upper():
            # 大小写不敏感地逐处删除（楼栋名通常只出现一次，循环删干净为止）
            idx = s.upper().find(b.upper())
            while idx >= 0:
                s = s[:idx] + s[idx + len(b):]
                idx = s.upper().find(b.upper())
    return s.strip(" -—·、,，/\\()（）")


def _detect_token(text: str, tokens: List[str]) -> str:
    """在 text 里找出命中的 token（按长度倒序，避免「负一楼」被「一楼」抢先）。"""
    s = (text or "").upper()
    if not s:
        return ""
    for t in sorted([t for t in tokens if t], key=len, reverse=True):
        if t.upper() in s:
            return t
    return ""


# ========================= 参考数据（60s 缓存） =========================

_rooms_cache: Dict[str, Any] = {"ts": 0.0, "rows": []}
_ROOMS_TTL = 60.0


def _load_rooms(db: Session) -> List[Room]:
    now = time.monotonic()
    if _rooms_cache["rows"] and now - _rooms_cache["ts"] < _ROOMS_TTL:
        return _rooms_cache["rows"]
    rows = db.query(Room).filter(Room.is_active == True).all()  # noqa: E712
    _rooms_cache["rows"] = rows
    _rooms_cache["ts"] = now
    return rows


def _load_subsystems(db: Session) -> List[Subsystem]:
    return db.query(Subsystem).filter(Subsystem.is_active == True).all()  # noqa: E712


def reset_rooms_cache() -> None:
    """房间缓存失效（新增/改名机房后调用；接口内只在 cache miss 时重查，故非必需）。"""
    _rooms_cache["rows"] = []
    _rooms_cache["ts"] = 0.0


# ========================= 编号尾数唯一性 =========================

def _used_codes(db: Session, prefix: str) -> set:
    """该前缀下**已被占用**的编号集合（三处都查，与临时编号同一红线）。

    只看 devices 会漏掉别名表/档案表里已存在的同号 → 建号后保存被唯一索引挡下。
    """
    rows = db.execute(sa_text(
        "SELECT device_code AS c FROM devices WHERE device_code LIKE :p "
        "UNION SELECT alias_code AS c FROM device_aliases WHERE alias_code LIKE :p "
        "UNION SELECT device_code AS c FROM device_archives WHERE device_code LIKE :p"
    ), {"p": prefix + "%"}).fetchall()
    return {(r[0] or "").upper() for r in rows if r[0]}


# 建议号占位表：编号 → 过期时刻（time.monotonic）。仅瞬时占位，不落库。
_reserve: Dict[str, float] = {}
_reserve_lock = threading.Lock()


def _prune_reserve(now: float) -> None:
    for k in [k for k, exp in _reserve.items() if exp <= now]:
        _reserve.pop(k, None)


def _next_device_code(db: Session, prefix: str) -> Tuple[Optional[str], int]:
    """取该前缀下第一个未被占用的尾数：从 01 起，超 99 自然变三位。

    判据：`devices` 表该前缀下的最大尾数 +1 起（与需求一致），
    再叠加 ① 表内实际占用 ② 「建议号占位」（防连点重复）逐个试，最多 20 次。
    返回 (编号, 该前缀当前最大尾数)；试满仍冲突 → (None, max)，
    **绝不返回可能重复的号**。
    """
    used = _used_codes(db, prefix)
    db_used = set(used)
    max_used = 0
    for c in db_used:
        tail = c[len(prefix):] if c.startswith(prefix.upper()) else ""
        if tail.isdigit():
            max_used = max(max_used, int(tail))

    now = time.monotonic()
    with _reserve_lock:
        _prune_reserve(now)
        for r in _reserve:
            if r.upper().startswith(prefix.upper()):
                used.add(r.upper())

    seq = max_used + 1
    for _ in range(_MAX_TAIL_TRIES):
        cand = f"{prefix}{seq:02d}"
        if cand.upper() not in used:
            with _reserve_lock:
                _reserve[cand] = time.monotonic() + _RESERVE_TTL
            return cand, max_used
        seq += 1
    return None, max_used


# ========================= 降级：关键词规则 =========================

# 顺序即优先级：「消防配电箱」先命中消防，「照明配电箱」先命中照明
_SUB_KEYWORD_RULES: List[Tuple[Tuple[str, ...], int]] = [
    (("消防", "喷淋", "烟感", "温感", "火灾", "防火", "应急灯"), 2),
    (("照明", "灯具", "灯带", "筒灯", "射灯", "灯泡", "灯", "插座"), 5),
    (("摄像", "监控", "门禁", "广播", "网络", "弱电", "交换机", "路由器", "对讲", "信息点"), 3),
    (("水泵", "给水", "排水", "污水", "水箱", "集水", "阀门", "水表"), 6),
    (("空调", "风机", "新风", "冷却塔", "冷", "暖", "排风", "送风", "ahu"), 7),
    (("配电", "变压器", "发电", "开关柜", "母排", "母线", "电力", "电表", "电箱", "电柜"), 1),
]

# 类型词（长词优先匹配，避免「风机盘管」被识别成「风机」）
_TYPE_KEYWORDS: List[str] = [
    "风机盘管", "新风机组", "空调机组", "配电箱", "配电柜", "配电盘", "开关柜",
    "控制柜", "控制箱", "变压器", "发电机", "冷却塔", "摄像机", "摄像头",
    "排风机", "送风机", "水泵", "阀门", "水表", "电表", "门禁", "广播",
    "烟感", "温感", "灯具", "灯带", "筒灯", "射灯", "灯泡", "插座", "开关",
    "风机", "空调", "桥架", "母线",
]


def _keyword_type(name: str) -> str:
    low = (name or "").lower()
    for kw in _TYPE_KEYWORDS:
        if kw.lower() in low:
            return kw
    return ""


def _keyword_subsystem(name: str) -> Optional[int]:
    low = (name or "").lower()
    for kws, sid in _SUB_KEYWORD_RULES:
        for kw in kws:
            if kw.lower() in low:
                return sid
    return None


# ========================= 机房候选（喂给模型的窄名单） =========================

def _room_candidates(rooms: List[Room], text: str, bld: str, flr: str, limit: int = 40) -> List[Room]:
    """按文本命中度筛出候选机房（模型只能在**这个名单内**挑，避免它编一个不存在的机房）。"""
    up = (text or "").upper()
    scored: List[Tuple[int, Room]] = []
    for r in rooms:
        score = 0
        if r.name and r.name in text:
            score += 4
        if r.code and r.code.upper() in up:
            score += 5
        if bld and r.building == bld:
            score += 3
        if flr and r.floor == flr:
            score += 3
        if score > 0:
            scored.append((score, r))
    scored.sort(key=lambda x: (-x[0], len(x[1].name or ""), x[1].code or ""))
    return [r for _, r in scored][:limit]


# ========================= 大模型 =========================

_SYS_PROMPT = (
    "你是物业设备台账建档助手。只输出一个 JSON 对象，不要输出任何解释，不要用 markdown 代码块。"
)


def _build_user_prompt(name: str, loc: str, bld: str, flr: str,
                       subs: List[Subsystem], cands: List[Room],
                       buildings: List[str], floors: List[str]) -> str:
    sub_lines = "\n".join(f"- {s.name}" for s in subs) or "（无）"
    room_lines = "\n".join(
        f"- {r.code} | {r.building} {r.floor} {r.name}" for r in cands
    ) or "（无候选）"
    return f"""现场人员正在新建设备，请根据他填写的信息判断下列字段。

【设备名称】{name or "（空）"}
【位置描述】{loc or "（空）"}
【已填楼栋】{bld or "（空）"}
【已填楼层】{flr or "（空）"}

【可选子系统】（subsystem_name 必须严格等于下列之一，判断不出就填空串）
{sub_lines}

【候选机房】（room_code 必须是下列 code 之一，匹配不到填空串）
{room_lines}

【已知楼栋】（building 必须严格等于下列之一）
{"、".join(buildings) or "（无）"}

【已知楼层】（floor 必须严格等于下列之一）
{"、".join(floors) or "（无）"}

只输出这个 JSON：
{{"device_type":"","subsystem_name":"","room_code":"","building":"","floor":"","location_desc":""}}

要求：
1. device_type：设备类型词，如 照明配电箱 / 送风机 / 摄像机；判断不出填空串。
2. subsystem_name：设备所属系统，只能取上面的可选子系统名称之一。
3. room_code：位置最可能对应的机房，只能取候选机房的 code；不能确定填空串，**不要猜**。
4. building / floor：只能取上面已知楼栋/已知楼层里的值；判断不出填空串。
5. location_desc：把位置描述整理成一行（楼层+机房+方位/参照物），**不许编造没提到的信息**；
   原位置描述为空就填空串。"""


def _parse_json_obj(txt: str) -> Optional[dict]:
    s = (txt or "").strip()
    if not s:
        return None
    s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
    s = re.sub(r"```\s*$", "", s).strip()
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else None
    except Exception:  # noqa: BLE001
        pass
    m = re.search(r"\{[\s\S]*\}", s)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except Exception:  # noqa: BLE001
        return None


async def _ask_llm(prompt: str) -> dict:
    """调用 OpenAI 兼容端点（复用 agent_llm，绝不另写 HTTP、绝不碰密钥）。"""
    cfg = replace(LLMConfig.from_env(), timeout_s=LLM_TIMEOUT_S, max_tokens=600, temperature=0)
    if not cfg.configured:
        raise LLMError("not_configured", "未配置 AGENT_LLM_API_KEY")
    provider = OpenAICompatProvider(cfg)
    try:
        resp = await provider.chat([
            {"role": "system", "content": _SYS_PROMPT},
            {"role": "user", "content": prompt},
        ])
    finally:
        try:
            await provider.aclose()
        except Exception:  # noqa: BLE001
            pass
    try:
        content = resp["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001
        raise LLMError("bad_response", f"响应结构异常：{e}")
    obj = _parse_json_obj(content or "")
    if obj is None:
        raise LLMError("bad_response", "模型输出不是 JSON")
    return obj


# ========================= 限流 =========================

_rate: Dict[int, deque] = {}


def _rate_ok(uid: int) -> bool:
    now = time.monotonic()
    dq = _rate.setdefault(uid, deque())
    while dq and now - dq[0] > 60:
        dq.popleft()
    if len(dq) >= RATE_LIMIT_PER_MIN:
        return False
    dq.append(now)
    return True


# ========================= 日志（不含密钥、不含模型原文） =========================

def _log(line: str) -> None:
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:  # noqa: BLE001 日志失败绝不能影响建档
        pass


def _clip(s: str, n: int) -> str:
    s = (s or "").replace("\n", " ").replace("\r", " ").strip()
    return s if len(s) <= n else s[:n] + "…"


# ========================= 主流程 =========================

def _sug(value: Any, source: str, confidence: str, reason: str = "") -> Dict[str, Any]:
    d: Dict[str, Any] = {"value": value, "source": source, "confidence": confidence}
    if reason:
        d["reason"] = reason
    return d


async def build_suggestion(db: Session, data: Any, user: Any) -> Dict[str, Any]:
    """产出 AI 补全建议。data 需有 name/location_desc/building/floor/room_id/subsystem_id/device_code。"""
    t0 = time.monotonic()
    uid = int(getattr(user, "id", 0) or 0)
    uname = str(getattr(user, "name", "") or getattr(user, "username", "") or "")

    if not _rate_ok(uid):
        raise SuggestRateLimited(
            f"AI 补全调用过于频繁（1 分钟最多 {RATE_LIMIT_PER_MIN} 次），请稍后再试"
        )

    name = (getattr(data, "name", "") or "").strip()
    loc = (getattr(data, "location_desc", "") or "").strip()
    bld_in = (getattr(data, "building", "") or "").strip()
    flr_in = (getattr(data, "floor", "") or "").strip()
    room_in = getattr(data, "room_id", None)
    sub_in = getattr(data, "subsystem_id", None)
    code_in = (getattr(data, "device_code", "") or "").strip()

    if not name and not loc:
        raise SuggestBadInput("请先填写设备名称或位置描述，再点「AI 补全」")

    rooms = _load_rooms(db)
    subs = _load_subsystems(db)
    buildings = sorted({r.building for r in rooms if r.building}, key=len, reverse=True)
    floors = sorted(
        {r.floor for r in rooms if r.floor and r.floor not in ("—", "-", "－")},
        key=len, reverse=True,
    )
    room_by_id = {r.id: r for r in rooms}
    sub_by_name = {s.name: s for s in subs}
    sub_by_id = {s.id: s for s in subs}

    # ---- 1) 规则层：楼栋/楼层命中（不依赖模型，先算出来喂养候选机房） ----
    rule_bld = bld_in or _detect_token(loc, buildings) or _detect_token(name, buildings)
    rule_flr = flr_in or _detect_token(loc, floors)
    loc_core = _strip_buildings(loc, buildings)

    room_in_obj = room_by_id.get(int(room_in)) if room_in else None
    text = f"{loc} {name}".strip()
    cands = _room_candidates(rooms, text, rule_bld, rule_flr)

    # ---- 2) 模型层（超时/报错 → 降级，不阻断） ----
    ai: Dict[str, Any] = {}
    llm_used = False
    degraded = False
    degrade_reason = ""
    if LLMConfig.from_env().configured:
        try:
            prompt = _build_user_prompt(name, loc, bld_in, flr_in, subs, cands, buildings, floors)
            ai = await asyncio.wait_for(_ask_llm(prompt), timeout=LLM_TIMEOUT_S + 1.5) or {}
            llm_used = True
        except (asyncio.TimeoutError, LLMError) as e:
            degraded = True
            degrade_reason = f"模型不可用（{type(e).__name__}）"
        except Exception as e:  # noqa: BLE001 任何异常都不许让用户卡住
            degraded = True
            degrade_reason = f"模型异常（{type(e).__name__}）"
    else:
        degraded = True
        degrade_reason = "未配置模型密钥"

    suggest: Dict[str, Any] = {}

    # ---- 3) 设备类型（仅参考：不单独存字段，靠编号前缀与名称体现） ----
    kw_type = _keyword_type(name)
    ai_type = str(ai.get("device_type") or "").strip()
    ai_type = ai_type if (ai_type and len(ai_type) <= 20) else ""
    if ai_type:
        suggest["device_type"] = _sug(ai_type, "ai", "high" if llm_used else "medium")
    elif kw_type:
        suggest["device_type"] = _sug(kw_type, "rule", "medium", "按设备名称关键词匹配")

    # ---- 4) 所属系统：白名单校验（必须在 subsystems 表真实存在） ----
    if not sub_in:
        ai_sub = str(ai.get("subsystem_name") or "").strip()
        if ai_sub and ai_sub in sub_by_name:
            s = sub_by_name[ai_sub]
            suggest["subsystem_id"] = {
                "value": s.id, "subsystem_name": s.name, "source": "ai", "confidence": "high",
            }
        else:
            kw_sid = _keyword_subsystem(name)
            if kw_sid and kw_sid in sub_by_id:
                s = sub_by_id[kw_sid]
                reason = "按设备名称关键词判定"
                if llm_used and ai_sub:
                    reason = f"模型给出的系统「{_clip(ai_sub, 20)}」不在系统字典内，已丢弃，按名称关键词判定"
                suggest["subsystem_id"] = {
                    "value": s.id, "subsystem_name": s.name, "source": "rule",
                    "confidence": "medium", "reason": reason,
                }

    # ---- 5) 机房：只能从候选里挑（模型编的 code 一律丢弃） ----
    room_pick: Optional[Room] = None
    room_src = ""
    if room_in_obj is not None:
        room_pick = room_in_obj           # 用户已选，作为位置上下文（不建议覆盖）
        room_src = "input"
    else:
        ai_room_code = str(ai.get("room_code") or "").strip().upper()
        if llm_used and ai_room_code:
            hit = [r for r in cands if (r.code or "").upper() == ai_room_code]
            if hit:
                room_pick, room_src = hit[0], "ai"
        if room_pick is None:
            strong = [r for r in cands if r.name and r.name in text]
            if len(strong) == 1:
                room_pick, room_src = strong[0], "rule"
        # 一致性校验：楼栋/楼层已确定时，机房必须一致，否则丢弃
        if room_pick is not None:
            if (rule_bld and room_pick.building != rule_bld) or (rule_flr and room_pick.floor != rule_flr):
                room_pick, room_src = None, ""

    # ---- 6) 楼栋/楼层：优先规则；规则无解时用机房反查（比模型猜可靠）；最后才用模型 ----
    final_bld = rule_bld or (room_pick.building if room_pick is not None else "")
    final_flr = rule_flr or (room_pick.floor if room_pick is not None else "")
    if not final_bld and llm_used:
        cand_bld = str(ai.get("building") or "").strip()
        if cand_bld in buildings:
            final_bld = cand_bld
    if not final_flr and llm_used:
        cand_flr = str(ai.get("floor") or "").strip()
        valid_floors = {r.floor for r in rooms if r.building == final_bld} if final_bld else set(floors)
        if cand_flr in valid_floors:
            final_flr = cand_flr

    if not bld_in and final_bld:
        if final_bld == rule_bld:
            reason = f"位置描述里识别到楼栋「{final_bld}」"
            suggest["building"] = _sug(final_bld, "rule", "high", reason)
        elif room_pick is not None and final_bld == room_pick.building:
            suggest["building"] = _sug(
                final_bld, "rule", "high", f"由机房 {room_pick.code} 反查得到",
            )
        else:
            suggest["building"] = _sug(final_bld, "ai", "medium", "模型按位置描述推断（库中确有该楼栋）")

    if not flr_in and final_flr:
        if final_flr == rule_flr:
            suggest["floor"] = _sug(final_flr, "rule", "high", f"位置描述里识别到楼层「{final_flr}」")
        elif room_pick is not None and final_flr == room_pick.floor:
            suggest["floor"] = _sug(
                final_flr, "rule", "high", f"由机房 {room_pick.code} 反查得到",
            )
        else:
            suggest["floor"] = _sug(final_flr, "ai", "medium", "模型按位置描述推断（库中确有该楼层）")

    if room_in is None and room_pick is not None and room_src != "input":
        suggest["room_id"] = _sug(room_pick.id, room_src, "high" if room_src == "ai" else "medium",
                                  f"{room_pick.building} {room_pick.floor} {room_pick.name}")
        suggest["room_name"] = f"{room_pick.name}（{room_pick.code}）"

    # ---- 7) 位置描述规范化：只做整理，不许编造 ----
    if not loc:
        ai_loc = str(ai.get("location_desc") or "").strip()
        if ai_loc and len(ai_loc) <= 100:
            suggest["location_desc"] = _sug(ai_loc, "ai", "medium")

    # ---- 8) 设备编号：纯规则生成（用户已填编号则不再建议） ----
    if not code_in:
        if room_pick is not None and room_src != "input":
            loc_raw = f"{room_pick.floor}{room_pick.name}"
            loc_from = f"机房「{room_pick.name}」({room_pick.floor})"
        elif loc_core:
            loc_raw = loc_core
            loc_from = f"位置描述「{_clip(loc_core, 20)}」"
        elif final_flr:
            loc_raw = final_flr
            loc_from = f"楼层「{final_flr}」"
        elif final_bld:
            loc_raw = final_bld
            loc_from = f"楼栋「{final_bld}」"
        else:
            loc_raw = ""
            loc_from = "位置信息不足"

        loc_abbr = _abbr(loc_raw)
        dev_abbr = _abbr(name)
        low = False
        notes: List[str] = []
        if not loc_abbr:
            loc_abbr = "DEV"
            low = True
            notes.append("位置段无法转为字母（信息不足或全是符号），已用 DEV 兜底")
        if not dev_abbr:
            dev_abbr = "DEV"
            low = True
            notes.append("设备名段无法转为字母，已用 DEV 兜底")

        prefix = f"{loc_abbr}-{dev_abbr}-"
        code, max_used = _next_device_code(db, prefix)
        if code is None:
            missing_code = {
                "field": "device_code", "label": "设备编号",
                "question": f"前缀 {prefix} 下尾号已用尽或连续冲突，请手动填写编号",
            }
        else:
            missing_code = None
            tail_reason = (
                f"，该前缀当前最大尾数 {max_used:02d}" if max_used else "，该前缀尚无编号"
            )
            reason = f"{loc_from} + 设备「{_clip(name or '未填名称', 20)}」{tail_reason}"
            if notes:
                reason += "；" + "；".join(notes)
            suggest["device_code"] = _sug(
                code, "rule", "low" if low else "high", reason,
            )
    else:
        missing_code = None

    # ---- 9) missing：推断不出的字段一律列出（绝不填默认值） ----
    missing: List[Dict[str, str]] = []
    if not name:
        missing.append({
            "field": "name", "label": "设备名称",
            "question": "设备名称为空，编号里的「设备名缩写」无从生成，请先填写设备名称（如：照明配电箱）",
        })
    if not bld_in and not final_bld:
        if final_flr:
            opts = sorted({r.building for r in rooms if r.floor == final_flr and r.building})
            if len(opts) > 1:
                head = "、".join(opts[:3])
                names = f"{head} 等 {len(opts)} 个楼栋都有" if len(opts) > 3 else f"{head} 都有"
                q = f"位置只写到「{final_flr}」，系统里 {names}{final_flr}，请指明楼栋"
            else:
                q = f"位置只写到「{final_flr}」，未能识别楼栋，请指明"
        else:
            q = "位置描述里没有识别到楼栋（如 GTC / 东停车楼），请补充"
        missing.append({"field": "building", "label": "所属楼栋", "question": q})
    if not flr_in and not final_flr and (final_bld or bld_in):
        missing.append({
            "field": "floor", "label": "所属楼层",
            "question": f"已识别楼栋为「{final_bld or bld_in}」，但位置描述里没有楼层，请指明",
        })
    if room_in is None and room_pick is None and (final_bld or bld_in) and (final_flr or flr_in):
        missing.append({
            "field": "room_id", "label": "机房",
            "question": "楼栋楼层已定位，但候选中无法唯一确定机房，请在「机房」里手动选择",
        })
    if not sub_in and "subsystem_id" not in suggest:
        missing.append({
            "field": "subsystem_id", "label": "所属系统",
            "question": "设备名称不足以判断所属系统，请手动选择（不替你默认「其他系统」）",
        })
    if not loc and "location_desc" not in suggest and room_pick is None:
        missing.append({
            "field": "location_desc", "label": "位置描述",
            "question": "位置描述为空且未识别到机房，建议补充具体位置（如：西侧墙面，距门 3 米）",
        })
    if missing_code:
        missing.append(missing_code)

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    code_val = (suggest.get("device_code") or {}).get("value", "")
    _log(
        f"{datetime.now(timezone.utc) + timedelta(hours=8):%Y-%m-%d %H:%M:%S}\t"
        f"user={uid}:{_clip(uname, 20)}\tname={_clip(name, 30)!r}\tloc={_clip(loc, 30)!r}\t"
        f"ms={elapsed_ms}\tllm={llm_used}\tdegraded={degraded}"
        f"{'(' + degrade_reason + ')' if degrade_reason else ''}\t"
        f"code={code_val or '-'}\tmissing={len(missing)}"
    )

    return {
        "suggest": suggest,
        "missing": missing,
        "llm_used": llm_used,
        "degraded": degraded,
        "degrade_reason": degrade_reason,
        "elapsed_ms": elapsed_ms,
    }
