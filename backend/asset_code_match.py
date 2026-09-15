# -*- coding: utf-8 -*-
"""机身编码匹配内核（后端唯一权威实现 · 批次②只读 · v4 含 R1–R7 + R3'）

对应《机身编码匹配_技术设计.md》：
  §1.2  normalize_code            —— 归一出 raw / upper / loose 三形态
  §1.3  extract_serial_from_brand —— v2 提取器（切分加 "/"、丢弃含 CJK 段、
                                      剥离中文前缀、最长有效段、单位后缀黑名单）
  §2.2  build_match_index         —— device_code / alias / serial_no / brand_serial / fuzzy 五空间
                                      ＋ 第六空间 shared_values（R2/R3）
  §2.3  resolve_code              —— 优先级 + 可信度 + 同分次序（排序即返回顺序）
  §3.2  resolve_code 的返回体      —— {query, normalized, kind, exact, count, candidates[], hint}

本版增量（依线上复核结论）
--------------------------
R1 · `ledger_only` 不得越级：**任何**精确层命中，若候选行 `source == 'ledger_only'` 且
      `confidence > 88`，出口统一封顶到 **88**，并置 `source_demoted=True`。
      含义：未登记行可以被匹配、被展示，但不许压过已登记设备的机身编号命中（92）。
      `MATCH_PRIORITY` 常数表**一字不改**，只在出口封顶；排序改用封顶后的 confidence。
      注意：已登记设备的 `device_code_exact=100` **不受影响**（R1 只动未登记那一侧）。
R2 · 共用值必须判歧义：若查询的 loose 值被 **≥2 台**（按 ledger 合并行计）设备共用，
      返回 `kind='ambiguous'`、`exact=False`、`shared_count=N`、
      `hint.can_observe=False`；候选照常返回。`alias_exact=98` 本身不改——
      1:1 别名仍是精确命中，R2 是数据驱动的模糊化，不按来源或格式禁别名。
R3 · **`device_code` 不计入共用值统计**：R2 的失效模式是「输入得到一个*唯一且自信*的
      错误答案」；而 device_code 撞车时精确命中会**同时命中两行**、返回 ≥2 条候选供
      用户自选，**不可能**产生单一自信答案 → 归「展示两条候选」，不归歧义。
      本系统 `GW2F` 与 `GW-2F`、`J1` 与 `J-1` 长期双格式并存（同一实体），若计入会把
      已登记设备的编号（如 `J-1`）误判为 ambiguous —— 属回归，故剔除。
R3' · **把 R3 的「侥幸保护」升级为硬不变量**（QA 复核后加固）：查询串精确命中**恰好一台
      已登记设备**（`source=='devices'`）的 `device_code` 时，用户输入的就是设备编号本身
      （`MATCH_PRIORITY` 最高档 100），其效力高于「共用值」推断——后者来自**别的行**的
      自由文本 `brand_model` / `serial_no`，是弱证据。故此时**不判 ambiguous、不回传
      shared_count**。必须仍判歧义的两种情形（不许过度放宽）：
        a) 命中的 device_code 行**全是** `ledger_only` 影子行（如 `G-1D5ATx1` / `WP-2D7APk1`）；
        b) 命中 **≥2 台**已登记设备（真同名）。
      说明：R3 通过「不计 device_code」已去掉大部分误判，但 `shared_values['J1']` 仍可能
      因**另一台设备**的 `brand_model` 抽取出 `J1` 而升到 2，从而把一台已登记设备
      `J-1` 误判为歧义——这是靠数据现状而非设计在保护。R3' 用**结构性**判据取代它。
R4 · **机身编号的「抽取形式」也计入共用值**：用户照铭牌输入的正是 `brand_model` 抽取值
      （如 `5950-36PM-E` / `C89E8`），只数整串会漏判歧义 → 取值来源在
      `SHARED_VALUE_FIELDS` 之外**再增 `extract_serial_from_brand` 的结果**（行内去重不变）。
R5 · **子串层最小长度**：`len(q.loose) < FUZZY_MIN_LEN(3)` 时不回退子串层（**精确层不受影响**）；
      此时 hint 提示「请输入更完整的编号」（而非「可补录」）。
      加固（P2-2）：`_fuzzy_hits` 作为**公开工具函数**自身也守该阈值（直调亦安全）。
R6 · **子串层两侧 loose 归一**：`ＧＥ１Ｆ` / `ge 2f ktjf` / `GE-2F-KTJF-101` 与 `GE1F` 等价命中。
R7 · 契约修正：`count` = **总命中数（不受 `limit` 截断）**；`candidates` 才受 `limit` 截断。

硬约束（务必遵守）
------------------
- 🔒 `serial_no` = **序列号**（出厂序列号），**不是机身编号**。二者索引互不相通：
  `serial_no` 空间只放 `fixed_assets.serial_no`；`brand_serial` 空间只放
  `brand_model` v2 抽取值 ∪ 现场补录观测（批次③）。两者**不得互相回落**。
- 本模块是**纯函数 + 无副作用**：除 `_load_active_observations` 的只读查询外不触库、不写库。
- `brand_serial` 抽取值必须**不含任何 CJK 字符**（由 §1.3 的 CODE_TAIL 保证）。

批次② 独立性
------------
`device_serial_observations` 表属**批次③**，本批不建。`build_match_index` 对该表采用
「表不存在就跳过」的惰性读取（try/except），保证批次②可独立部署、不会因缺表而 500。
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Tuple

from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from database import DeviceAlias

# ========================= §1.2 归一化 =========================

_SPACE_RE = re.compile(r"\s+")
_SEP_RE = re.compile(r"[-_./]")


def normalize_code(s: Any) -> Dict[str, str]:
    """把任意编号字符串归一出 raw / upper / loose 三形态（§1.2，逐字照抄设计）。

    Args:
        s: 任意输入（可能为 None / 非字符串）。

    Returns:
        {"raw": 原样去首尾空白,
         "upper": NFKC 全角→半角 + 去空白 + 转大写,
         "loose": 在 upper 基础上再去掉 [-_./]（宽松等值键）}
    """
    raw = str(s or "").strip()
    upper = unicodedata.normalize("NFKC", raw)      # 全角→半角
    upper = _SPACE_RE.sub("", upper).upper()        # 去空白 + 转大写
    loose = _SEP_RE.sub("", upper)                  # 再去分隔符 → 宽松等值键
    return {"raw": raw, "upper": upper, "loose": loose}


# ========================= §1.3 机身编号提取器（v2） =========================

CODE_TAIL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._\-]*")       # 一段连续的「代码样式」字符
SPLIT = re.compile(r"[\s，,、；;：:（）()/]+")                  # 修正①：切分集合加入 "/"
UNIT_TAIL = re.compile(r"^\d+(\.\d+)?(k?W|k?V|kVA|m?A|Hz|V|A|W|mm?|℃)$", re.I)
# ↑ 防「6kW / 250V / 380A」这类额定值被当成编号

_MAX_SERIAL_LEN = 40


def extract_serial_from_brand(brand_model: Any) -> str:
    """从自由的 `brand_model` 文本里抽取**机身编号**（§1.3 v2，逐字照抄设计）。

    规则：
      1) `SPLIT`（含 "/"）切段；
      2) 每段用 `CODE_TAIL` 取**不含 CJK 的连续代码**——紧贴中文的前缀自动剥离
         （`配电箱G-B1AD1EPSa1` → `G-B1AD1EPSa1`）；
      3) 候选须「含数字 且（含字母 或 含连字符）」且不落在 `UNIT_TAIL` 单位黑名单；
      4) 取最长段，同长取更靠后者（铭牌编号常在末尾）；无候选 / >40 字符 → 空串。

    Args:
        brand_model: 品牌型号原始文本。

    Returns:
        抽取到的机身编号；抽不到返回 ""。保证**不含 CJK**。
    """
    text = re.sub(r"[\r\n]+", " ", str(brand_model or "")).strip()
    if not text:
        return ""
    segs: List[str] = []
    for tok in SPLIT.split(text):
        # 修正②：从每段里只取不含 CJK 的连续代码
        for m in CODE_TAIL.finditer(tok):
            segs.append(m.group(0))
    # 修正③：候选必须是「含数字 且（含字母 或 含连字符）」的段
    cands = [s for s in segs
             if re.search(r"\d", s) and (re.search(r"[A-Za-z]", s) or "-" in s)
             and not UNIT_TAIL.match(s)]
    if not cands:
        return ""
    # 修正④：优先「最长段」，长度相同取更靠后者
    best = max(cands, key=lambda s: (len(s), segs.index(s)))
    return best if len(best) <= _MAX_SERIAL_LEN else ""


# ========================= §2.3 优先级与可信度 =========================

#: match_type → 可信度（排序即返回顺序）。**R1/R2 不改这张表。**
MATCH_PRIORITY: Dict[str, int] = {
    "device_code_exact": 100,
    "alias_exact": 98,
    "observation_exact": 96,
    "brand_extract_exact": 92,
    "serial_no_exact": 70,
    "brand_substring": 60,
    "field_substring": 40,
}

#: match_type → kind（响应顶层 `kind` 由最高可信度命中决定）
MATCH_KIND: Dict[str, str] = {
    "device_code_exact": "device_code",
    "alias_exact": "alias",
    "observation_exact": "serial",      # 现场补录的「机身编号」
    "brand_extract_exact": "serial",    # 台账抽取的「机身编号」
    "serial_no_exact": "serial_no",     # 「序列号」（≠机身编号）
    "brand_substring": "fuzzy",
    "field_substring": "fuzzy",
}

#: 精确层（exact=true）的 match_type 集合
EXACT_TYPES = frozenset({
    "device_code_exact", "alias_exact", "observation_exact",
    "brand_extract_exact", "serial_no_exact",
})

#: 模糊层：品牌/名称类字段（命中记 brand_substring=60）
FUZZY_BRAND_FIELDS: Tuple[str, ...] = ("brand_model", "name", "asset_name")
#: 模糊层：其余可检索字段（命中记 field_substring=40），对齐列表接口的 _QUERY_FIELDS
FUZZY_OTHER_FIELDS: Tuple[str, ...] = (
    "device_code", "location", "asset_code", "transfer_no", "tag_no",
    "use_dept", "serial_no", "contract_no", "room_code",
)

#: R5：子串（模糊）层的最小有效字符数（按 loose 长度）；低于此值不回退子串层
FUZZY_MIN_LEN = 3

#: R1 封顶值：落在 brand_extract_exact(92) 之下、serial_no_exact(70) 之上
DEMOTED_CAP = 88

#: R2/R3/R4 计入共用值统计的取值来源：
#:   - `SHARED_VALUE_FIELDS`（asset_code / serial_no / brand_model，**整串原文**）；
#:   - ＋ R4：每行 `brand_model` 经 `extract_serial_from_brand` 得到的**抽取结果**
#:     （用户照铭牌输入的正是抽取形式，如 `5950-36PM-E` / `C89E8`；只数整串会漏判歧义）。
#: R3：**剔除 `device_code`**——其撞车会命中多行、返回多候选，不构成歧义；
#: 否则 `J-1`(devices)/`J1`(ledger_only) 这类双格式并存会把设备编号路径误判为歧义。
#: R3'：即便如此，共用值仍可能因**别行**自由文本而把「已登记设备编号」误判为歧义；
#:      故 `resolve_code` 出口再加硬不变量——精确命中**唯一一台已登记设备**的 device_code 时，
#:      设备编号自指**优先于**共用值歧义（见 `resolve_code` 内 R3' 判定）。
SHARED_VALUE_FIELDS: Tuple[str, ...] = ("asset_code", "serial_no", "brand_model")

#: 可信的观测来源白名单 —— **只有现场提交的观测才进匹配索引**。
#: 为何必须白名单：`device_serial_observations` 是「现场观测层」，其命中记
#: `observation_exact` = 96 分，**高于**台账抽取 `brand_extract_exact` = 92 分
#: （设计本意：现场看到铭牌比台账文字更权威）。但该表可被**绕过 API 的批量脚本直写**：
#: 2026-09-14 一次性审计脚本把 2694 条台账自身抽取值以 `source='ledger_text'` /
#: `operator='audit_consolidation'` 灌入（其中 **2183 条与当前台账抽取不一致**），
#: 这些行并非现场观测 —— 一旦并入索引，就会凭空产生大批高置信度、与甲方台账冲突的编号。
#: 故此处取**白名单语义**：仅经 `POST /asset-ledger/observations` 落库的来源算现场观测。
#: 该接口写库时把空值兜底为 `'miniprogram'`（`source=(payload.source or "miniprogram")`），
#: **绝不写空串/None**；小程序端也不传 `source`（走后端默认值）→ 白名单不会误杀真实数据。
TRUSTED_OBSERVATION_SOURCES: Tuple[str, ...] = ("miniprogram", "web")

#: 无命中时的补录提示（§3.2）
_NO_HIT_HINT: Dict[str, Any] = {
    "can_observe": True,
    "reason": "可将其补录为机身编号（需先选定所属设备）",
}


# ========================= §2.2 索引构建 =========================

def _load_active_observations(db: Session) -> List[Dict[str, Any]]:
    """读取**现场补录**观测（批次③ 的表）；**表不存在则返回空**，保证批次②独立部署。

    `device_serial_observations.serial_norm` 存的即现场观测到的**机身编号**（loose 形态）。

    两道闸，缺一不可：
    1) `status = 'active'` —— 撤销(rejected) / 被更正(superseded) / 跨设备隔离(quarantined)
      一律不进索引（隔离行本就不在 active 集合，见 `DeviceSerialObservation` docstring 第 4 点）。
    2) **`source` 必须落在 `TRUSTED_OBSERVATION_SOURCES` 白名单内** —— 绕过 API 直写库的
       台账镜像 / 审计批量行（如 `source='ledger_text'`）**不算现场观测**，不得进索引；
       理由见该常量注释（观测 96 分高于台账 92 分，放进来等于让非现场来源压过甲方台账）。
       白名单取 `LOWER(COALESCE(source,''))`：大小写不敏感，且 NULL 一律视为不可信。
    """
    names = ["s%d" % i for i in range(len(TRUSTED_OBSERVATION_SOURCES))]
    placeholders = ", ".join(":%s" % n for n in names)
    params = dict(zip(names, TRUSTED_OBSERVATION_SOURCES))
    try:
        rows = db.execute(
            sa_text("SELECT device_code, serial_raw, serial_norm"
                    " FROM device_serial_observations"
                    " WHERE status = 'active'"
                    "   AND LOWER(COALESCE(source, '')) IN (%s)" % placeholders),
            params).all()
    except Exception:
        return []  # 表不存在（批次②）或其它只读异常 → 跳过，不阻断
    return [dict(r._mapping) for r in rows]


def _empty_index() -> Dict[str, Any]:
    """六个空间 + 两个辅助表：by_code（canonical→行）、rows（子串层用）。"""
    return {
        "device_code": {},    # loose → [(row, 原值)]
        "alias": {},          # loose → [(canonical_code, alias_code)]
        "serial_no": {},      # loose → [(row, 原值)]   ← 序列号（异类，不并入机身编号）
        "brand_serial": {},   # loose → [(row, 抽取值)] 或 [(device_code, serial_raw, "observation")]
        "fuzzy": {},          # 预留（子串层实时遍历 rows）
        "shared_values": {},  # loose → 共用该值的**设备台数**（按 ledger 合并行计，R2/R3/R4）
        "by_code": {},        # device_code → row
        "rows": [],           # 全量行（子串层遍历用）
    }


def build_match_index(db: Session, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """在既有约 9000 行装配结果上一次性 O(N) 建索引（§2.2 + R2）。

    挂在 `_load_all` 的同一 60s 生命周期上；**本函数不修改 rows**（避免污染列表接口输出）。

    Args:
        db: 会话（用于只读查询 device_aliases 与 observations）。
        rows: `_load_all` 装配好的全量行。

    Returns:
        索引字典（见 `_empty_index`）。
    """
    idx = _empty_index()
    idx["rows"] = rows
    shared = idx["shared_values"]

    for r in rows:
        code = r.get("device_code") or ""
        if code:
            idx["by_code"].setdefault(code, r)

        # 设备编号空间
        n = normalize_code(code)
        if n["loose"]:
            idx["device_code"].setdefault(n["loose"], []).append((r, code))

        # 序列号空间（fixed_assets.serial_no，独立异类，绝不并入机身编号）
        sn_val = r.get("serial_no")
        sn = normalize_code(sn_val)
        if sn["loose"]:
            idx["serial_no"].setdefault(sn["loose"], []).append((r, sn_val))

        # 机身编号空间：brand_model v2 抽取
        bm = extract_serial_from_brand(r.get("brand_model"))
        bn = normalize_code(bm)
        if bn["loose"]:
            idx["brand_serial"].setdefault(bn["loose"], []).append((r, bm))

        # R2/R3/R4：共用值计数（**同一行内同名 loose 只计一次** → 等价「被 N 台设备共用」）
        # 取值来源 = SHARED_VALUE_FIELDS（整串原文） ＋ R4：brand_model 的抽取结果
        seen: set = set()
        for f in SHARED_VALUE_FIELDS:
            lv = normalize_code(r.get(f))["loose"]
            if lv:
                seen.add(lv)
        if bn["loose"]:                     # R4：抽取结果（复用上面已算好的 bn）
            seen.add(bn["loose"])
        for lv in seen:
            shared[lv] = shared.get(lv, 0) + 1

    # 别名空间（既有 device_aliases 桥接）
    try:
        for a in db.query(DeviceAlias).all():
            n = normalize_code(a.alias_code)
            if n["loose"]:
                idx["alias"].setdefault(n["loose"], []).append((a.canonical_code, a.alias_code))
    except Exception:
        pass

    # 机身编号空间：现场补录观测（批次③ 表；缺表则空）
    # ⚠️ 只并 active **且** 来源可信（source 白名单）的行 —— 见 _load_active_observations。
    for o in _load_active_observations(db):
        norm = normalize_code(o.get("serial_norm"))
        key = norm["loose"] or (o.get("serial_norm") or "")
        if key:
            idx["brand_serial"].setdefault(key, []).append(
                (o.get("device_code") or "", o.get("serial_raw") or "", "observation"))

    return idx


# ========================= §2.3 候选构造与排序 =========================

def _hit(row: Dict[str, Any], match_type: str, match_field: str,
         matched_value: Any) -> Dict[str, Any]:
    """构造一个候选（§3.2 的 candidate 结构）。"""
    return {
        "device_code": row.get("device_code") or "",
        "name": row.get("name") or "",
        "asset_name": row.get("asset_name") or "",
        "location": row.get("location") or "",
        "area": row.get("area") or "",
        "source": row.get("source") or "",
        "match_type": match_type,
        "match_field": match_field,
        "matched_value": "" if matched_value is None else str(matched_value),
        "confidence": MATCH_PRIORITY[match_type],
        # has_serial：该行是否带「序列号」(serial_no) 字段；in_devices：是否已登记进 devices
        "has_serial": bool(str(row.get("serial_no") or "").strip()),
        "in_devices": row.get("source") == "devices",
        # source_demoted：是否被 R1 降过权（未登记行精确命中封顶 88）
        "source_demoted": False,
    }


def _resolve_alias_row(index: Dict[str, Any], canonical_code: str) -> Dict[str, Any]:
    """别名/观测 → canonical 行；行不在全量集合内时给一个最小占位行（不编造内容）。"""
    row = index["by_code"].get(canonical_code)
    if row is not None:
        return row
    return {
        "device_code": canonical_code, "name": "", "asset_name": "",
        "location": "", "area": "", "source": "alias", "serial_no": "",
    }


def _fuzzy_hits(index: Dict[str, Any], q: Any) -> List[Dict[str, Any]]:
    """子串（模糊）层：镜像列表接口 `q=` 行为，O(N)。

    品牌/名称类字段优先（brand_substring=60），其余字段（field_substring=40）。
    每行只取一个最佳命中。

    R6：**两侧统一 loose 归一**（needle 与字段值都过 `normalize_code().loose`），
    使 `GE-2F-KTJF-101` / `GE2FKTJF101` / `ge 2f ktjf` / 全角 `ＧＥ１Ｆ` 都能命中。
    返回的 `matched_value` 仍是**原值**（便于前端展示）。
    R5：本函数**自身也守最小有效长度**（直调亦安全）——见下方 guard。
    """
    needle = normalize_code(q)["loose"]
    if not needle:
        return []
    # R5 防御：本函数是**公开工具函数**，直调时也须遵守最小有效长度，
    # 不再依赖调用方（`resolve_code` 的 too_short 分支）先挡一道。
    # 对 resolve 路径零行为变化：too_short 为真时 _fuzzy_hits 压根不会被调用。
    if len(needle) < FUZZY_MIN_LEN:
        return []
    out: List[Dict[str, Any]] = []
    for r in index["rows"]:
        for f in FUZZY_BRAND_FIELDS:
            v = str(r.get(f) or "")
            if needle in normalize_code(v)["loose"]:
                out.append(_hit(r, "brand_substring", f, v))
                break
        else:
            for f in FUZZY_OTHER_FIELDS:
                v = str(r.get(f) or "")
                if needle in normalize_code(v)["loose"]:
                    out.append(_hit(r, "field_substring", f, v))
                    break
    return out


def _apply_source_demotion(hits: List[Dict[str, Any]]) -> None:
    """R1：精确层命中且行为未登记（ledger_only）且 confidence>88 → 封顶 88。

    就地修改 hits；未登记行不许压过已登记设备的机身编号命中（92）。
    """
    for h in hits:
        if (h["match_type"] in EXACT_TYPES and h["source"] == "ledger_only"
                and h["confidence"] > DEMOTED_CAP):
            h["confidence"] = DEMOTED_CAP
            h["source_demoted"] = True


def _dedupe_and_sort(hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """按 device_code 去重（保留最高可信度命中），再按 §2.3：
    **封顶后的** confidence 降序 → source==devices 优先 → device_code 短者优先。

    注意：排序键用 `h["confidence"]`（可能已被 R1 封顶），而非 `MATCH_PRIORITY`，
    否则 R1 的降权不会真正改变返回顺序。
    """
    best: Dict[str, Dict[str, Any]] = {}
    for h in hits:
        code = h["device_code"]
        cur = best.get(code)
        if cur is None or ((h["confidence"], MATCH_PRIORITY[h["match_type"]])
                           > (cur["confidence"], MATCH_PRIORITY[cur["match_type"]])):
            best[code] = h
    uniq = list(best.values())
    uniq.sort(key=lambda h: (
        -h["confidence"],
        0 if h["source"] == "devices" else 1,
        len(h["device_code"] or ""),
        h["device_code"] or "",
    ))
    return uniq


# ========================= §3.2 解析入口 =========================

def resolve_code(index: Dict[str, Any], q: Any, limit: int = 8) -> Dict[str, Any]:
    """把一次输入解析为「命中类型 + 按可信度排序的候选」（§2.4 / §3.2 + R1/R2/R3'）。

    一次判定，不猜：先精确层（device_code / alias / 机身编号 / 序列号），
    精确层有命中就**只返回精确命中**（避免歧义时被迫多选）；无精确命中才回退子串层。

    Args:
        index: `build_match_index` 产出的索引。
        q: 用户输入（机身编号 / 设备编号 / 别名 / 序列号 …）。
        limit: 候选上限，默认 8、上限 20。

    Returns:
        §3.2 响应：{query, normalized, kind, exact, count, candidates[, shared_count][, hint]}。
        - R7：`count` = **总命中数（不受 `limit` 截断）**；`candidates` 才受 `limit` 截断。
          前端据此判断「还有更多」——即允许 `count > len(candidates)`。
        - kind='ambiguous' 表示该值被多台设备共用（R2/R3/R4），exact=False 且带 shared_count。
        - R3'：精确命中**唯一一台已登记设备**（source='devices'）的 device_code 时，
          设备编号自指优先于共用值歧义——不判 ambiguous、不回传 shared_count。
        - R5：精确层无命中且 `len(loose) < FUZZY_MIN_LEN` 时不回退子串层，hint 提示补充输入。
    """
    limit = max(1, min(int(limit or 8), 20))
    n = normalize_code(q)
    loose = n["loose"]

    hits: List[Dict[str, Any]] = []
    if loose:
        # 1) 设备编号（100）
        for r, code in index["device_code"].get(loose, []):
            hits.append(_hit(r, "device_code_exact", "device_code", code))
        # 2) 别名（98）
        for canonical, alias in index["alias"].get(loose, []):
            hits.append(_hit(_resolve_alias_row(index, canonical),
                             "alias_exact", "alias_code", alias))
        # 3) 机身编号：现场补录观测（96） / 台账 brand_model 抽取（92）
        for entry in index["brand_serial"].get(loose, []):
            if isinstance(entry, tuple) and len(entry) == 3 and entry[2] == "observation":
                dev_code, serial_raw, _tag = entry
                hits.append(_hit(_resolve_alias_row(index, dev_code),
                                 "observation_exact", "serial_norm", serial_raw))
            else:
                r, bm = entry
                hits.append(_hit(r, "brand_extract_exact", "brand_model", bm))
        # 4) 序列号（70，异类：标签「序列号」，≠机身编号）
        for r, sn in index["serial_no"].get(loose, []):
            hits.append(_hit(r, "serial_no_exact", "serial_no", sn))

    # 5) 子串（模糊）层——仅当精确层无命中（§2.3：命中即返回，不再混入模糊噪声），
    #    且 R5：要求有效字符长度 >= FUZZY_MIN_LEN（1~2 字符在 9000 行里动辄命中数千条，无识别价值）
    too_short = bool(loose) and len(loose) < FUZZY_MIN_LEN
    if not hits and not too_short:
        hits = _fuzzy_hits(index, q)

    # R1：出口封顶（未登记行的精确命中不许越级）
    _apply_source_demotion(hits)

    uniq = _dedupe_and_sort(hits)
    candidates = uniq[:limit]

    # R2：共用值判歧义
    shared_count = index["shared_values"].get(loose, 0) if loose else 0

    # R3'：把 R3 的「侥幸保护」升级为**硬不变量**。
    # 查询串精确命中**恰好一台已登记设备**（source=='devices'）的 device_code 时，
    # 用户输入的就是设备编号本身（MATCH_PRIORITY 最高档 100），其效力高于「共用值」推断
    # —— 后者来自别的行的**自由文本** brand_model / serial_no，是弱证据。
    # 必须仍判歧义的两种情形（不许过度放宽）：
    #   a) 命中的 device_code 行**全是** ledger_only 影子行 → 如 G-1D5ATx1 / WP-2D7APk1；
    #   b) 命中 **≥2 台**已登记设备 → 真同名。
    registered_dc = [
        r for r, _c in (index["device_code"].get(loose, []) if loose else [])
        if r.get("source") == "devices"
    ]
    dc_self_authoritative = len(registered_dc) == 1

    # R2 生效条件（含 R3' 例外）：只在「被多台共用」且「非设备编号自指」时判歧义。
    # `shared_count` / `hint` 也**只在**本条件成立时输出 —— 因为当设备编号自指时，
    # 设备编号本身即为决定性证据，**不再回传 shared_count**（避免「kind=device_code
    # 却提示『被 N 台共用』」的自相矛盾输出）。
    is_ambiguous = shared_count >= 2 and not dc_self_authoritative

    if is_ambiguous:
        kind, exact = "ambiguous", False
    elif uniq:
        top_type = candidates[0]["match_type"]
        kind = MATCH_KIND[top_type]
        exact = top_type in EXACT_TYPES
    else:
        kind, exact = "none", False

    resp: Dict[str, Any] = {
        "query": n["raw"],
        "normalized": n,
        "kind": kind,
        "exact": exact,
        "count": len(uniq),
        "candidates": candidates,
    }
    if is_ambiguous:
        resp["shared_count"] = shared_count
        # 动作指引按「候选条数」分档（P2 收尾）：PM §3.2 冻结的第一句一字不改，
        # 只替换后半句 —— 「在候选中确认」仅在候选确实 ≥2 条时才有意义。
        if len(uniq) >= 2:
            # 原文，一字不改（PM §3.2 冻结）：候选确实多个，指引成立
            reason = (f"该编号被 {shared_count} 台设备共用，无法唯一确定，"
                      "请按所在位置/资产编号在候选中确认")
        elif len(uniq) == 1:
            reason = (f"该编号被 {shared_count} 台设备共用，无法唯一确定；"
                      "当前仅定位到 1 台设备，请核对实物机身编号后再确认")
        else:
            reason = (f"该编号被 {shared_count} 台设备共用，无法唯一确定；"
                      "当前未能定位到具体设备，请输入更完整的编号")
        resp["hint"] = {"can_observe": False, "reason": reason}
    elif not uniq:
        if too_short:
            # R5：输入过短，子串层被前置条件挡下 —— 提示补充输入（而非「可补录」）
            resp["hint"] = {
                "can_observe": False,
                "reason": f"输入过短，请输入更完整的编号（至少 {FUZZY_MIN_LEN} 个有效字符）",
            }
        else:
            resp["hint"] = dict(_NO_HIT_HINT)
    return resp
