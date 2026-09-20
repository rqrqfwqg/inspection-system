# -*- coding: utf-8 -*-
"""机身编码匹配 · 后端自测（批次② · 只读 · v2 含 R1/R2 + 线上 fixture）

覆盖：
  A) 打 `/ops/api/assets/asset-ledger/resolve`（§3.2 + R1 降权 + R2 歧义）
  B) 硬断言：brand_extract_exact / observation_exact 的 matched_value 不含 CJK 且 ≠ serial_no
  C) §1.3 提取器回归表（用 `extract_serial_from_brand` 直接跑）
  D) 索引覆盖率 + R2 `shared_values` 键数
  E) 列表接口 `GET /asset-ledger` 系列改动前后逐字节一致（对比基线）
     online → scripts/_ledger_baseline_online.json ；local → scripts/_ledger_baseline.json

数据源（T3）
------------
  --fixture online（默认）：scripts/_online_fixture.db（**线上真数据**，由 _online_fixture.py 拉取）。
      开工先自证「合并行数 == 8977」，不等立即报错退出（拒绝在不可信数据上跑测试）。
  --fixture local           ：本工程 app.db（本机示范副本；旧基线 scripts/_ledger_baseline.json）。
  --db-url <sqlite 路径>    ：显式指定任意库。

v2 相对原任务表的 3 处**内核升级**（依线上复核结论，非断言写错）：
  1) T1/R1：未登记（ledger_only）行的精确命中不许越级 → 出口封顶 88 分（source_demoted=True）。
     故 `G-1D9APt` 的台账-only 行 100→88，让位给 105000620952 的 brand_extract_exact(92)。
  2) T2/R2：被 ≥2 台设备共用的值判歧义 → kind='ambiguous'、exact=False、shared_count=N、
     hint.can_observe=False。故 `0512001`(401) 与 `BQL-B1-SB-01`(3) 均为 ambiguous。
  3) T3：测试数据源换成线上 fixture（约 8977 行），本地数字作废。
  4) R3：`device_code` 不计入 R2 共用值——其撞车（GW2F/GW-2F、J1/J-1 双格式并存）
     会命中多行、返回多候选，不构成歧义；且 `q=J-1` 这类**已登记设备编号**被判
     ambiguous 属回归。`SHARED_VALUE_FIELDS` 收敛为 (asset_code, serial_no, brand_model)。
  5) R4：机身编号的「抽取形式」（`brand_model` 抽取结果）**也计入共用值**——用户照铭牌
     输入的正是抽取形式（`5950-36PM-E` / `C89E8`），只数整串会漏判歧义；行内去重不变。
     R5：子串层最小长度 `FUZZY_MIN_LEN=3`（精确层不受影响）；过短时 hint 提示补充输入。
     R6：子串层**两侧 loose 归一**（全角/空格/分隔符差异均可命中）。
     R7：`count` = **总命中数（不受 limit 截断）**；`candidates` 才受 limit 截断。

用法（务必用该工程 venv）：
    ./venv/Scripts/python.exe scripts/test_code_resolve.py                 # 默认 online
    ./venv/Scripts/python.exe scripts/test_code_resolve.py --fixture local
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")

FIXTURE_DB = os.path.join(_BACKEND, "scripts", "_online_fixture.db")
LOCAL_DB = os.path.join(_BACKEND, "app.db")
#: 线上全集合合并行数（devices ∪ records ∪ fixed_assets），线上复核值
EXPECTED_ONLINE_MERGED = 8977


# ---------------------------------------------------------------- 数据源选择（必须先于 import main）
def parse_args():
    ap = argparse.ArgumentParser(description="机身编码匹配内核自测")
    ap.add_argument("--fixture", choices=["online", "local"], default="online",
                    help="online=线上 fixture（默认）；local=本机 app.db")
    ap.add_argument("--db-url", default=None, help="显式指定 sqlite 库文件路径")
    return ap.parse_args()


def _merged_count(db_path):
    """devices ∪ records ∪ fixed_assets 的合并行数（与 _online_fixture 的自证口径一致）。"""
    con = sqlite3.connect(db_path)
    try:
        return con.execute(
            "SELECT COUNT(*) FROM (SELECT device_code FROM devices"
            " UNION SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code<>''"
            " UNION SELECT device_code FROM fixed_assets)").fetchone()[0]
    finally:
        con.close()


def _inject_db(db_path):
    """在 import main 之前把 database 的 engine/SessionLocal 重绑定到目标库。"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import database
    url = "sqlite:///" + os.path.abspath(db_path).replace("\\", "/")
    engine = create_engine(url, connect_args={"check_same_thread": False})
    database.DATABASE_URL = url
    database.engine = engine
    database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return url


ARGS = parse_args()
if ARGS.db_url:
    MODE = "custom"
    DB_PATH = os.path.abspath(ARGS.db_url)
    BASELINE_NAME = "_ledger_baseline.json"
elif ARGS.fixture == "online":
    MODE = "online"
    DB_PATH = FIXTURE_DB
    BASELINE_NAME = "_ledger_baseline_online.json"
else:
    MODE = "local"
    DB_PATH = LOCAL_DB
    BASELINE_NAME = "_ledger_baseline.json"

print("=" * 78)
print(f"[fixture={MODE}] 源库（只读）= {DB_PATH}")
if not os.path.exists(DB_PATH):
    sys.exit(f"[FATAL] 目标库不存在：{DB_PATH}"
             + ("（先跑 scripts/_online_fixture.py 生成线上 fixture）" if MODE == "online" else ""))
# 🔒 只读基线快照：测试一律在**源库副本**上跑 —— 绝不写 _online_fixture.db / app.db。
#    （批次③ 起 Base.metadata 新增 device_serial_observations，app lifespan 的
#     init_db()→create_all 会向目标库补建该空表；落在副本上 → 源 fixture 保持只读。）
_SRC_DB = DB_PATH
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "_resolve_test_runtime.db")
shutil.copy2(_SRC_DB, DB_PATH)
print(f"[fixture={MODE}] 实际使用（只写副本）= {DB_PATH}")
if MODE == "online":
    _merged = _merged_count(DB_PATH)
    print(f"[fixture=online] 线上 fixture 合并行数（devices ∪ records ∪ fixed_assets）= {_merged}"
          f"（期望 {EXPECTED_ONLINE_MERGED}）")
    if _merged != EXPECTED_ONLINE_MERGED:
        sys.exit(f"[FATAL] fixture 行数 {_merged} != 期望 {EXPECTED_ONLINE_MERGED}，拒绝在不可信数据上跑测试。")

_DB_URL = _inject_db(DB_PATH)

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
import asset_code_match as acm  # noqa: E402
import asset_ledger_routes as alr  # noqa: E402
from database import get_db, FixedAsset  # noqa: E402

P = "/ops/api/assets"
RESOLVE = f"{P}/asset-ledger/resolve"
CJK = re.compile(r"[\u4e00-\u9fff]")
TARGET = "105000620952"

# R2 线上复核期望值
# '0512001' 的共用台数 = 对 device_code/asset_code/serial_no/brand_model **四字段并集**
#   （行内去重）= 447（线上 fixture 实测）。其中**仅 brand_model='0512001' 就占 401**
#   （即 team-lead 初判口径），余 46 台来自 asset_code/serial_no 等字段——
#   说明「四字段并集」比「仅 brand_model」更全，更符合「该值被 N 台共用」的语义。
SHARED_0512001 = 447
SHARED_BQL = 3
#: 只有 online（线上 fixture）才断言**精确**共用台数；其它库数据面不同，
#: 只断言「确实被 ≥2 台共用（判为歧义）」。
_EXPECT_EXACT = (MODE == "online")

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  [PASS] {name} {extra}")
    else:
        failed += 1
        print(f"  [FAIL] {name} {extra}")


def top(d):
    return (d.get("candidates") or [{}])[0]


def cand_at(d, i):
    cs = d.get("candidates") or []
    return cs[i] if len(cs) > i else {}


def dump(d):
    return json.dumps({
        "query": d.get("query"), "normalized": d.get("normalized"),
        "kind": d.get("kind"), "exact": d.get("exact"), "count": d.get("count"),
        "shared_count": d.get("shared_count"),
        "cands": [{k: x.get(k) for k in
                   ("device_code", "match_type", "matched_value", "confidence",
                    "source", "source_demoted")}
                  for x in d.get("candidates", [])],
        "hint": d.get("hint"),
    }, ensure_ascii=False)


def find(d, code, mtype=None):
    for x in d.get("candidates", []):
        if x["device_code"] == code and (mtype is None or x["match_type"] == mtype):
            return x
    return None


def main():
    db = next(get_db())
    serial_map = {fa.device_code: (fa.serial_no or "") for fa in db.query(FixedAsset).all()}

    with TestClient(app) as c:
        # ============ A) ============
        print("=" * 78)
        print("A) /asset-ledger/resolve（§3.2 + R1 + R2 + R3 + R4/R5/R6/R7）")
        resp = {}

        # A1 设备编号 —— R1 不变量：已登记设备的 100 分不被撼动
        r = c.get(RESOLVE, params={"q": TARGET}); d = r.json(); resp["device_code"] = d
        print(f"  q={TARGET}\n     -> {dump(d)}")
        check("A1 HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A1 kind=device_code", d.get("kind") == "device_code", f"= {d.get('kind')}")
        check("A1 top=device_code_exact", top(d).get("match_type") == "device_code_exact",
              f"= {top(d).get('match_type')}")
        check("A1 confidence=100（R1 不变量）", top(d).get("confidence") == 100,
              f"= {top(d).get('confidence')}")
        check("A1 top 未被降权", top(d).get("source_demoted") is False,
              f"= {top(d).get('source_demoted')}")
        check("A1 命中该设备", find(d, TARGET) is not None,
              f"cands={[x['device_code'] for x in d.get('candidates', [])]}")

        # A2 机身编号 —— T1/R1：ledger_only 行降权，让位给真设备(92)
        r = c.get(RESOLVE, params={"q": "G-1D9APt"}); d = r.json(); resp["brand"] = d
        print(f"  q=G-1D9APt\n     -> {dump(d)}")
        c2 = find(d, TARGET, "brand_extract_exact")
        c1 = cand_at(d, 1)
        check("A2 HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A2 top=105000620952(真设备)", top(d).get("device_code") == TARGET,
              f"= {top(d).get('device_code')}")
        check("A2 top=brand_extract_exact", top(d).get("match_type") == "brand_extract_exact",
              f"= {top(d).get('match_type')}")
        check("A2 top confidence=92", top(d).get("confidence") == 92, f"= {top(d).get('confidence')}")
        check("A2 kind=serial（top 是机身编号命中）", d.get("kind") == "serial", f"= {d.get('kind')}")
        check("A2 第二=G-1D9APt（ledger_only）", c1.get("device_code") == "G-1D9APt",
              f"= {c1.get('device_code')}")
        check("A2 第二 confidence=88（R1 封顶）", c1.get("confidence") == 88,
              f"= {c1.get('confidence')}")
        check("A2 第二 source=ledger_only", c1.get("source") == "ledger_only", f"= {c1.get('source')}")
        check("A2 第二 source_demoted=True", c1.get("source_demoted") is True,
              f"= {c1.get('source_demoted')}")
        check("A2 105000620952 以 brand_extract_exact(92) 命中",
              c2 is not None and c2.get("confidence") == 92, f"= {c2}")
        check("A2 matched_value=G-1D9APt", (c2 or {}).get("matched_value") == "G-1D9APt",
              f"= {(c2 or {}).get('matched_value')!r}")

        # A3 小写 + 空格（loose 归一后应与 A2 等价）
        r = c.get(RESOLVE, params={"q": "g 1d9apt"}); d = r.json(); resp["loose"] = d
        print(f"  q='g 1d9apt'\n     -> {dump(d)}")
        check("A3 HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A3 normalized.loose=G1D9APT", d["normalized"]["loose"] == "G1D9APT",
              f"= {d['normalized']['loose']}")
        check("A3 top=105000620952（与 A2 等价）", top(d).get("device_code") == TARGET,
              f"= {top(d).get('device_code')}")

        # A4 序列号（≠机身编号，异类空间）
        r = c.get(RESOLVE, params={"q": "152100424110742M"}); d = r.json(); resp["serial_no"] = d
        print(f"  q=152100424110742M（该设备的序列号）\n     -> {dump(d)}")
        check("A4 HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A4 kind=serial_no", d.get("kind") == "serial_no", f"= {d.get('kind')}")
        check("A4 top=serial_no_exact", top(d).get("match_type") == "serial_no_exact",
              f"= {top(d).get('match_type')}")
        check("A4 confidence=70", top(d).get("confidence") == 70, f"= {top(d).get('confidence')}")
        check("A4 未被标成机身编号(serial)", d.get("kind") != "serial", f"= {d.get('kind')}")
        check("A4 非 ambiguous", d.get("kind") != "ambiguous", f"= {d.get('kind')}")
        check("A4 shared_values['152100424110742M'] == 1（独占）",
              alr._get_match_index(db)["shared_values"].get("152100424110742M") == 1,
              f"= {alr._get_match_index(db)['shared_values'].get('152100424110742M')}")

        # A5 纯数字分类码 '0512001' —— T2/R2：401 台共用 → 歧义
        r = c.get(RESOLVE, params={"q": "0512001"}); d = r.json(); resp["alias"] = d
        print(f"  q=0512001（纯数字分类码，447 台共用 = asset_code 46 + brand_model 401）\n     -> {dump(d)}")
        check("A5 HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A5 kind=ambiguous", d.get("kind") == "ambiguous", f"= {d.get('kind')}")
        check("A5 exact=False", d.get("exact") is False, f"= {d.get('exact')}")
        check(f"A5 shared_count={SHARED_0512001}（online 口径）" if _EXPECT_EXACT
              else "A5 shared_count>=2（非 online 只断言歧义）",
              (d.get("shared_count") == SHARED_0512001) if _EXPECT_EXACT
              else (d.get("shared_count", 0) >= 2),
              f"= {d.get('shared_count')}")
        check("A5 hint.can_observe=False", (d.get("hint") or {}).get("can_observe") is False,
              f"hint={d.get('hint')}")
        check("A5 候选仍返回（alias_exact 98 居首）", top(d).get("match_type") == "alias_exact",
              f"= {top(d).get('match_type')}")
        # 拆解 '0512001' 的共用来源（对照 team-lead「仅 brand_model=401」口径）
        _allrows = alr._load_all(db)
        _bv = {_f: sum(1 for _r in _allrows
                       if acm.normalize_code(_r.get(_f))["loose"] == "0512001")
               for _f in acm.SHARED_VALUE_FIELDS}
        print(f"     [拆解] '0512001' 各字段命中行数 = {_bv}；并集(行内去重) = {d.get('shared_count')}")
        if _EXPECT_EXACT:
            check("A5 shared_count >= 仅 brand_model 口径(401)",
                  d.get("shared_count", 0) >= 401,
                  f"= {d.get('shared_count')}（brand_model={_bv.get('brand_model')}）")
        check("A5 shared_count == 索引值（内核自洽）",
              d.get("shared_count") == alr._get_match_index(db)["shared_values"].get("0512001"),
              f"= {d.get('shared_count')}")

        # A5c R2：asset_code='BQL-B1-SB-01' 被 3 台共用 → 歧义
        r = c.get(RESOLVE, params={"q": "BQL-B1-SB-01"}); d = r.json(); resp["shared_bql"] = d
        print(f"  q=BQL-B1-SB-01（资产代码，3 台共用）\n     -> {dump(d)}")
        check("A5c HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A5c kind=ambiguous", d.get("kind") == "ambiguous", f"= {d.get('kind')}")
        check("A5c exact=False", d.get("exact") is False, f"= {d.get('exact')}")
        check(f"A5c shared_count={SHARED_BQL}（online 口径）" if _EXPECT_EXACT
              else "A5c shared_count>=2（非 online 只断言歧义）",
              (d.get("shared_count") == SHARED_BQL) if _EXPECT_EXACT
              else (d.get("shared_count", 0) >= 2),
              f"= {d.get('shared_count')}")
        check("A5c hint.can_observe=False", (d.get("hint") or {}).get("can_observe") is False,
              f"hint={d.get('hint')}")

        # A5b 真正无命中的输入 → kind=none + hint（保留「未匹配→可补录」验收）
        r = c.get(RESOLVE, params={"q": "ZZ-NOPE-9Q8W7E"}); d = r.json(); resp["none"] = d
        print(f"  q=ZZ-NOPE-9Q8W7E（确无命中）\n     -> {dump(d)}")
        check("A5b HTTP 200", r.status_code == 200, f"code={r.status_code}")
        check("A5b kind=none", d.get("kind") == "none", f"= {d.get('kind')}")
        check("A5b count=0", d.get("count") == 0, f"= {d.get('count')}")
        check("A5b hint.can_observe=true", bool((d.get("hint") or {}).get("can_observe")),
              f"hint={d.get('hint')}")

        # A6 limit 边界
        print("-" * 78)
        d3 = c.get(RESOLVE, params={"q": "配电箱", "limit": 3}).json()
        check("A6 limit 生效（<=3）", len(d3["candidates"]) <= 3, f"= {len(d3['candidates'])}")
        d20 = c.get(RESOLVE, params={"q": "配电箱", "limit": 999}).json()
        check("A6 limit 上限 20", len(d20["candidates"]) <= 20, f"= {len(d20['candidates'])}")
        d26 = c.get(RESOLVE, params={"q": "配电箱", "limit": 20}).json()
        print(f"     q=配电箱 命中(限20) kind={d26.get('kind')} count={d26.get('count')} "
              f"shared_count={d26.get('shared_count')} top={top(d26).get('match_type')}")

        # A7 路由顺序回归
        print("-" * 78)
        rd = c.get(f"{P}/asset-ledger/detail", params={"code": TARGET})
        check("A7 /detail?code=... 仍 200 且 found",
              rd.status_code == 200 and rd.json().get("found") is True,
              f"code={rd.status_code} found={rd.json().get('found')}")
        check("A7 /asset-ledger 仍 200",
              c.get(f"{P}/asset-ledger", params={"page_size": 5}).status_code == 200)

        # A8 R3：device_code 撞车**不得**判歧义（GW2F/GW-2F、J1/J-1 双格式并存 = 同一实体）
        print("-" * 78)
        d = c.get(RESOLVE, params={"q": "J-1"}).json(); resp["j1"] = d
        print(f"  q=J-1（已登记设备编号；与台账-only 的 J1 双格式并存）\n     -> {dump(d)}")
        check("A8a q=J-1 非 ambiguous（R3 回归）", d.get("kind") != "ambiguous",
              f"kind={d.get('kind')} shared_count={d.get('shared_count')}")
        check("A8a kind=device_code", d.get("kind") == "device_code", f"= {d.get('kind')}")
        check("A8a exact=true", d.get("exact") is True, f"= {d.get('exact')}")
        check("A8a count>=2（线上实测=3：另有一台 brand_model 抽出 J1 的真设备）",
              d.get("count", 0) >= 2, f"= {d.get('count')}")
        check("A8a top=J-1/device_code_exact/100/devices/未降权",
              top(d).get("device_code") == "J-1"
              and top(d).get("match_type") == "device_code_exact"
              and top(d).get("confidence") == 100
              and top(d).get("source") == "devices"
              and top(d).get("source_demoted") is False,
              f"= {top(d)}")
        _j1_ledger = find(d, "J1", "device_code_exact")
        check("A8a 台账-only 的 J1 命中 device_code_exact/88/已降权",
              (_j1_ledger or {}).get("confidence") == 88
              and (_j1_ledger or {}).get("source") == "ledger_only"
              and (_j1_ledger or {}).get("source_demoted") is True,
              f"= {_j1_ledger}")
        _extra = find(d, "105000621392", "brand_extract_exact")
        print(f"     [NOTE] 线上实测多出一台**已登记**真设备 105000621392：其 brand_model "
              f"抽取值 = {(_extra or {}).get('matched_value')!r} → brand_extract_exact(92)；"
              f"故 count=3（team-lead 预估 2 未含此台）。台账-only 的 J1(88) 落到第三。")
        check("A8a 该 92 分候选确为 brand_extract_exact",
              (_extra or {}).get("confidence") == 92, f"= {_extra}")
        # A8b 其余双格式并存对：均必须**非** ambiguous
        for _q in ("J1", "J-4", "J4", "GE-2F-KTJF-101", "GE2F-KTJF-101",
                   "GW2F-KTJF-101", "P11N2F-KTJF-102"):
            _d = c.get(RESOLVE, params={"q": _q}).json()
            check(f"A8b q={_q} 非 ambiguous", _d.get("kind") != "ambiguous",
                  f"kind={_d.get('kind')} shared_count={_d.get('shared_count')}")


        # ============ A9) R4：机身编号的「抽取形式」也计入共用值 ============
        print("-" * 78)
        d = c.get(RESOLVE, params={"q": "595036PME"}).json(); resp["r4_pme"] = d
        print(f"  q=595036PME（= 型号 5950-36PM-E 的抽取形式）\n     -> {dump(d)}")
        check("A9a kind=ambiguous", d.get("kind") == "ambiguous", f"= {d.get('kind')}")
        check("A9a exact=False", d.get("exact") is False, f"= {d.get('exact')}")
        check("A9a shared_count=145", d.get("shared_count") == 145, f"= {d.get('shared_count')}")
        check("A9a hint.can_observe=False", (d.get("hint") or {}).get("can_observe") is False,
              f"hint={d.get('hint')}")
        check("A9a 仍有候选（145 台里给 limit 条）", len(d.get("candidates") or []) > 0,
              f"= {len(d.get('candidates') or [])}")
        _d2 = c.get(RESOLVE, params={"q": "5950-36PM-E"}).json()
        check("A9b q=5950-36PM-E 与 q=595036PME 等价",
              _d2.get("kind") == d.get("kind") and _d2.get("shared_count") == d.get("shared_count"),
              f"kind={_d2.get('kind')} shared_count={_d2.get('shared_count')}")
        # A9c —— R4 存在的**唯一理由**：整串各不相同、抽取结果相同
        d = c.get(RESOLVE, params={"q": "C89E8"}).json(); resp["r4_c89e8"] = d
        print(f"  q=C89E8（4 台整串不同、抽取结果相同）\n     -> {dump(d)}")
        check("A9c kind=ambiguous", d.get("kind") == "ambiguous", f"= {d.get('kind')}")
        check("A9c exact=False", d.get("exact") is False, f"= {d.get('exact')}")
        check("A9c shared_count=4", d.get("shared_count") == 4, f"= {d.get('shared_count')}")
        check("A9c hint.can_observe=False", (d.get("hint") or {}).get("can_observe") is False,
              f"hint={d.get('hint')}")

        # ============ A10) R5：子串层最小长度 ============
        print("-" * 78)
        for _q, _was in (("1", 8607), ("12", 1809), ("zz", "n/a")):
            _d = c.get(RESOLVE, params={"q": _q}).json()
            print(f"  q={_q!r}（R5 前子串层命中约 {_was}）→ kind={_d.get('kind')} "
                  f"count={_d.get('count')} hint={(_d.get('hint') or {}).get('reason')}")
            check(f"A10 q={_q!r} 不再回退子串层（count=0）", _d.get("count") == 0,
                  f"= {_d.get('count')}")
            check(f"A10 q={_q!r} hint 提示补充输入（至少 3 个有效字符）",
                  "至少" in str((_d.get("hint") or {}).get("reason", "")),
                  f"= {(_d.get('hint') or {}).get('reason')}")
        _d1050 = c.get(RESOLVE, params={"q": "1050"}).json()
        print(f"  q='1050'（loose 长 4 >= 3）→ 子串层仍生效 count={_d1050.get('count')}")
        # R5 只挡子串层：2~3 字符的**精确**命中照旧。
        # G1 走机身编号抽取层(kind=serial/count=1)；J1 走 device_code 层；
        # 42U / F3b 亦为精确层命中——R4 后它们因被多台共用而判 ambiguous，但**不是** count=0。
        for _q in ("G1", "J1", "42U", "F3b"):
            _d = c.get(RESOLVE, params={"q": _q}).json()
            check(f"A10 精确层未受 R5 影响 q={_q!r}", _d.get("count", 0) >= 1,
                  f"kind={_d.get('kind')} count={_d.get('count')} shared={_d.get('shared_count')}")
        _d = c.get(RESOLVE, params={"q": "配电箱", "limit": 8}).json()
        check("A10 q=配电箱（loose 长 3）子串层仍生效且 count=1073",
              _d.get("count") == 1073, f"= {_d.get('count')}")
        check("A10 R7：count > len(candidates)（count 未受 limit 截断）",
              _d.get("count", 0) > len(_d.get("candidates") or []),
              f"count={_d.get('count')} cands={len(_d.get('candidates') or [])}")

        # ============ A11) R6：子串层两侧 loose 归一 ============
        print("-" * 78)
        for _a, _b in (("ＧＥ１Ｆ", "GE1F"), ("ge 2f ktjf", "GE2FKTJF"),
                       ("ge2f-ktjf-101", "GE2FKTJF101")):
            _da = c.get(RESOLVE, params={"q": _a}).json()
            _db = c.get(RESOLVE, params={"q": _b}).json()
            print(f"  q={_a!r} → kind={_da.get('kind')} count={_da.get('count')}  |  "
                  f"q={_b!r} → kind={_db.get('kind')} count={_db.get('count')}")
            check(f"A11 {_a!r} 与 {_b!r} 结果一致",
                  _da.get("count") == _db.get("count") and _da.get("kind") == _db.get("kind"),
                  f"{_da.get('kind')}/{_da.get('count')} vs {_db.get('kind')}/{_db.get('count')}")
        _d = c.get(RESOLVE, params={"q": "ge 2f ktjf"}).json()
        check("A11 q='ge 2f ktjf' 命中数 > 0（R6 前为 0）", _d.get("count", 0) > 0,
              f"= {_d.get('count')}")

        # ============ A12) R4 零误伤回归（team-lead 9 条 + 2 反例，逐条）============
        print("-" * 78)
        _sv = alr._get_match_index(db)["shared_values"]
        ZERO_HARM = [
            # (q, shared_values 键, 期望共用数, 期望 kind, 期望 top.match_type)
            ("G-1D9APt", "G1D9APT", 1, "serial", "brand_extract_exact"),
            ("J-1", "J1", 1, "device_code", "device_code_exact"),
            ("J1", "J1", 1, "device_code", "device_code_exact"),
            ("J-4", "J4", 1, "device_code", "device_code_exact"),
            ("105000620952", "105000620952", 0, "device_code", "device_code_exact"),
            ("152100424110742M", "152100424110742M", 1, "serial_no", "serial_no_exact"),
            ("10430201211100004970", "10430201211100004970", 0, "alias", "alias_exact"),
            ("GE-2F-KTJF-101", "GE2FKTJF101", 0, "device_code", "device_code_exact"),
            ("GW2F-KTJF-101", "GW2FKTJF101", 0, "device_code", "device_code_exact"),
            ("0512001", "0512001", 447, "ambiguous", "alias_exact"),
            ("BQL-B1-SB-01", "BQLB1SB01", 3, "ambiguous", "alias_exact"),
        ]
        for _q, _key, _exp_sv, _exp_kind, _exp_mt in ZERO_HARM:
            _d = c.get(RESOLVE, params={"q": _q}).json()
            _sv_act = _sv.get(_key, 0)
            print(f"  q={_q:<22} sv[{_key!r}]={_sv_act}（期望 {_exp_sv}）  "
                  f"kind={_d.get('kind')}  top={top(_d).get('match_type')}")
            check(f"A12 q={_q!r} shared_values 计数 = {_exp_sv}", _sv_act == _exp_sv,
                  f"= {_sv_act}")
            check(f"A12 q={_q!r} kind = {_exp_kind}", _d.get("kind") == _exp_kind,
                  f"= {_d.get('kind')}")
            check(f"A12 q={_q!r} top = {_exp_mt}", top(_d).get("match_type") == _exp_mt,
                  f"= {top(_d).get('match_type')}")
            if _exp_sv < 2:
                check(f"A12 q={_q!r} 非 ambiguous（R4 零误伤）",
                      _d.get("kind") != "ambiguous", f"= {_d.get('kind')}")

        # ============ B) 硬断言 ============
        print("=" * 78)
        print("B) 硬断言：brand_extract_exact / observation_exact 的 matched_value 不得含 CJK、不得等于 serial_no")
        bad_cjk, bad_serial, checked = [], [], 0
        for name, d in resp.items():
            for cand in d.get("candidates", []):
                if cand["match_type"] in ("brand_extract_exact", "observation_exact"):
                    checked += 1
                    mv = cand["matched_value"] or ""
                    if CJK.search(mv):
                        bad_cjk.append((name, cand["device_code"], mv))
                    if mv and mv == serial_map.get(cand["device_code"], ""):
                        bad_serial.append((name, cand["device_code"], mv))
        check(f"B1 候选 matched_value 无 CJK（检查 {checked} 条）", not bad_cjk, f"违反={bad_cjk}")
        check("B2 候选 matched_value ≠ 该设备 serial_no", not bad_serial, f"违反={bad_serial}")

        # ============ C) §1.3 回归表 ============
        print("=" * 78)
        print("C) extract_serial_from_brand 回归表（§1.3）")
        cases = [
            ("白云电器，配电箱 G-1D9APt", "G-1D9APt"),
            ("西默电气，配电箱G-B1AD1EPSa1", "G-B1AD1EPSa1"),
            ("成套配电箱ALE2B21/大航有能电气有限公司", "ALE2B21"),
            ("母线槽插接箱/MCCB-250F140/3PMX/施耐德", "MCCB-250F140"),
            ("24口接入层交换机（堆叠,POE）中兴 ZXR10 5950-36PM-E", "5950-36PM-E"),
            ("室内枪式IP摄像机 宇视IPC-L2A4-FW", "IPC-L2A4-FW"),
            ("配电箱 6kW弱电间 白云电器", ""),
            ("0512001", ""),
        ]
        for src, exp in cases:
            got = acm.extract_serial_from_brand(src)
            check(f"C '{src}'", got == exp, f"got={got!r} exp={exp!r}")

        # ============ D) 索引覆盖率 + R2 ============
        print("=" * 78)
        print("D) 索引覆盖率（brand_serial 抽取值）+ R2 shared_values")
        rows = alr._load_all(db)
        n_rows = len(rows)
        non_empty = 0
        cjk_rows = 0
        serial_conflict = 0
        for r in rows:
            v = acm.extract_serial_from_brand(r.get("brand_model"))
            if v:
                non_empty += 1
                if CJK.search(v):
                    cjk_rows += 1
                if v == (r.get("serial_no") or ""):
                    serial_conflict += 1
        idx = alr._get_match_index(db)
        idx_vals = sum(len(v) for v in idx["brand_serial"].values())
        idx_cjk = 0
        for entries in idx["brand_serial"].values():
            for e in entries:
                if isinstance(e, tuple) and len(e) == 2 and CJK.search(str(e[1] or "")):
                    idx_cjk += 1

        from collections import Counter  # noqa: E402

        def _share_source(_r, _f):
            """R2/R3/R4 的取值来源：SHARED_VALUE_FIELDS 整串原文 ＋ brand_serial（抽取结果）。"""
            if _f == "brand_serial":
                return acm.normalize_code(
                    acm.extract_serial_from_brand(_r.get("brand_model")))["loose"]
            return acm.normalize_code(_r.get(_f))["loose"]

        SHARE_SOURCES = list(acm.SHARED_VALUE_FIELDS) + ["brand_serial"]
        per_field_shared = {}
        for f in SHARE_SOURCES:
            cnt = Counter()
            for r in rows:
                lv = _share_source(r, f)
                if lv:
                    cnt[lv] += 1
            per_field_shared[f] = sum(1 for _k, v in cnt.items() if v >= 2)

        sv = idx["shared_values"]
        sv_total_keys = len(sv)
        sv_ge2 = sum(1 for _k, v in sv.items() if v >= 2)
        print(f"     全集合行数 = {n_rows}")
        print(f"     抽出非空 brand_serial 行数 = {non_empty}")
        print(f"     其中含 CJK 条数 = {cjk_rows}  （必须为 0）")
        print(f"     抽取值 == 该行 serial_no 的条数 = {serial_conflict}  （机身编号≠序列号，应为 0）")
        print(f"     索引 brand_serial 空间键数 = {len(idx['brand_serial'])}，条目数 = {idx_vals}，含 CJK = {idx_cjk}")
        print(f"     R2/R3/R4 shared_values 总键数({len(SHARE_SOURCES)}来源) = {sv_total_keys}")
        print(f"     R2/R3/R4 shared_values 被≥2台共用键数 = {sv_ge2}"
              "  ← 与 q=0512001 的 shared_count 是巧合撞数，二者无关")
        print(f"     R2/R3/R4 单来源「被≥2台共用」键数 = {per_field_shared}")
        print(f"     R2/R3/R4 抽查：'0512001'={sv.get('0512001')}  'BQLB1SB01'={sv.get('BQLB1SB01')}  "
              f"'G1D9APT'={sv.get('G1D9APT')}  'J1'={sv.get('J1')}")
        print(f"     R4 抽查：'595036PME'={sv.get('595036PME')}  'C89E8'={sv.get('C89E8')}  "
              f"'IPCL2A4FW'={sv.get('IPCL2A4FW')}")

        def _top_sharers(field, n=8):
            cnt, sample = Counter(), {}
            for _r in rows:
                _raw = (acm.extract_serial_from_brand(_r.get("brand_model"))
                        if field == "brand_serial" else str(_r.get(field) or "").strip())
                _lv = _share_source(_r, field)
                if _lv:
                    cnt[_lv] += 1
                    sample.setdefault(_lv, _raw)
            return [(sample[k], c) for k, c in cnt.most_common(n)]

        print(f"     [留痕] serial_no 头部共用者 = {_top_sharers('serial_no')}")
        print(f"     [留痕] asset_code 头部共用者 = {_top_sharers('asset_code')}")
        print(f"     [留痕] brand_model 头部共用者 = {_top_sharers('brand_model')}")
        print(f"     [留痕] brand_serial(R4 新增) 头部共用者 = {_top_sharers('brand_serial')}")
        check("D1 抽出非空 brand_serial 行数 > 0", non_empty > 0, f"= {non_empty}")
        check("D2 含 CJK 条数 == 0", cjk_rows == 0, f"= {cjk_rows}")
        check("D3 索引条目数 == 非空行数", idx_vals == non_empty, f"{idx_vals} vs {non_empty}")
        check("D4 索引内 brand_serial 无 CJK", idx_cjk == 0, f"= {idx_cjk}")
        check("D5 shared_values 非空", sv_total_keys > 0, f"= {sv_total_keys}")
        check("D6 '0512001' 被≥2台共用（R2 生效）", sv.get("0512001", 0) >= 2,
              f"= {sv.get('0512001')}")
        # ---- R3：device_code 已剔除 ----
        R3_DROP = ["GE2FKTJF101", "GE2FKTJF205", "GW2FKTJF101", "GW2FKTJF205",
                   "P11N2FKTJF102", "J1", "J4"]
        _cnt7 = {k: sv.get(k, 0) for k in R3_DROP}
        print(f"     [R3/R4] 7 个 device_code 撞车值现计数 = {_cnt7}（R4 后可=1，但必须 <2）")
        _still_amb = {k: v for k, v in _cnt7.items() if v >= 2}
        check("D7 R3/R4：7 个 device_code 撞车 loose 值均**不判歧义**（计数<2）", not _still_amb,
              f"≥2 的={_still_amb}")
        check("D8 R3/R4：shared_values 总键数 = 4908", sv_total_keys == 4908, f"= {sv_total_keys}")
        check("D9 R3/R4：被≥2台共用键数 = 584", sv_ge2 == 584, f"= {sv_ge2}")
        check("D10 R4：brand_serial 单来源共用键数 = 137",
              per_field_shared.get("brand_serial") == 137,
              f"= {per_field_shared.get('brand_serial')}")
        check("D11 R4：sv['595036PME'] = 145", sv.get("595036PME") == 145,
              f"= {sv.get('595036PME')}")
        check("D12 R4：sv['C89E8'] = 4", sv.get("C89E8") == 4, f"= {sv.get('C89E8')}")

        # ============ E) 列表接口回归 ============
        print("=" * 78)
        print(f"E) GET /asset-ledger 系列：改动前后逐字节一致（基线 {BASELINE_NAME}）")
        base_path = os.path.join(_BACKEND, "scripts", BASELINE_NAME)
        if not os.path.exists(base_path):
            print(f"     (未找到基线文件 {base_path}，跳过 E)")
        else:
            with open(base_path, "r", encoding="utf-8") as f:
                base = json.load(f)
            CASES = [
                ("list_p1", f"{P}/asset-ledger", {"page": 1, "page_size": 5}),
                ("list_p2", f"{P}/asset-ledger", {"page": 2, "page_size": 5}),
                ("list_with_asset", f"{P}/asset-ledger", {"state": "with_asset", "page_size": 1}),
                ("list_q_pdx", f"{P}/asset-ledger", {"q": "配电箱", "page_size": 3}),
                ("list_sort_price", f"{P}/asset-ledger", {"sort": "price_tax", "order": "desc", "page_size": 5}),
                ("summary", f"{P}/asset-ledger/summary", {}),
                ("detail", f"{P}/asset-ledger/detail", {"code": TARGET}),
            ]
            for name, url, params in CASES:
                rr = c.get(url, params=params)
                cur = {"status": rr.status_code, "json": rr.json()}
                same = (cur["status"] == base[name]["status"]
                        and json.dumps(cur["json"], ensure_ascii=False, sort_keys=True)
                        == json.dumps(base[name]["json"], ensure_ascii=False, sort_keys=True))
                check(f"E {name} 与基线一致", same, f"status={cur['status']} vs {base[name]['status']}")

        # ============ F) 收口回归：R3' 硬不变量 + P2-2 ============
        print("=" * 78)
        print("F) R3'（已登记设备编号不被共用值误判歧义）+ P2-2（_fuzzy_hits 内置 R5）")

        # ---- F-A：固定契约：已登记设备编号 → kind=device_code 且 exact=True ----
        REGISTERED_J = ["J-1", "J-2", "J-3", "J-4", "J-5", "J-6", "J-7",
                        "J-10", "J-11", "J-12", "J-13"]
        for _q in REGISTERED_J:
            _d = c.get(RESOLVE, params={"q": _q}).json()
            check(f"F-A 已登记设备编号 {_q} → device_code/exact=True",
                  _d.get("kind") == "device_code" and _d.get("exact") is True,
                  f"kind={_d.get('kind')} exact={_d.get('exact')} shared={_d.get('shared_count')}")

        # ---- F-B：注入式未来场景（纯内存，不写回 fixture DB）----
        rows2 = [dict(r) for r in alr._load_all(db)]
        _syn = {"device_code": "__SYNTH_J1__", "source": "ledger_only",
                "brand_model": "白云电器，配电箱 J1", "name": "合成测试行"}
        _ext = acm.extract_serial_from_brand(_syn["brand_model"])
        print(f"     合成行 brand_model 抽取 = {_ext!r}（loose={acm.normalize_code(_ext)['loose']!r}）")
        check("F-B 合成行抽取 loose == 'J1'（前置条件）",
              acm.normalize_code(_ext)["loose"] == "J1", f"= {acm.normalize_code(_ext)['loose']!r}")
        rows2.append(_syn)
        idx2 = acm.build_match_index(db, rows2)
        check("F-B 注入后 sv['J1'] >= 2（影子行确实抬高了共用计数）",
              idx2["shared_values"].get("J1", 0) >= 2, f"= {idx2['shared_values'].get('J1')}")

        # 1) q='J-1'（已登记）：R3' 生效 → 仍 device_code/exact，**不**因共用值翻成歧义
        _d = acm.resolve_code(idx2, "J-1")
        check("F-B 注入后 q='J-1' 仍 device_code/exact（R3' 生效，不回归）",
              _d["kind"] == "device_code" and _d.get("exact") is True,
              f"kind={_d.get('kind')} exact={_d.get('exact')} shared={_d.get('shared_count')}")
        # 2) q='J1'：loose('J1')==loose('J-1')，与 'J-1' **同 loose 桶** → R3'（桶内恰好 1 台已登记）
        #    同样生效。因此二者结果**必然相同**（=device_code）。
        #    [NOTE] team-lead 原期望此处 ambiguous；但 R3' 判据是「loose 桶内恰好 1 台已登记设备」，
        #    'J1'(影子) 与 'J-1'(已登记) 共用同一 loose 桶，无法区分 → 同判 device_code。
        #    「R3' 未过度放宽」由下方纯影子编号 G-1D5ATx1 / WP-2D7APk1 仍 ambiguous 来证明。
        _d_j1 = acm.resolve_code(idx2, "J1")
        _d_jd = acm.resolve_code(idx2, "J-1")
        print(f"     [NOTE] q='J1' 与 q='J-1' 同 loose 桶 → 同结果 "
              f"({_d_j1['kind']}/{_d_j1['exact']})；口径以回报为准。")
        check("F-B 注入后 q='J1' 与 q='J-1' 同判（同 loose 桶，R3' 对已登记编号生效）",
              _d_j1["kind"] == _d_jd["kind"] == "device_code" and _d_j1["exact"] is True,
              f"J1={_d_j1['kind']}/{_d_j1['exact']}  J-1={_d_jd['kind']}/{_d_jd['exact']}")
        # 3) 纯影子编号（无已登记同名）：R3' 不得误伤 → 仍 ambiguous
        for _q in ("G-1D5ATx1", "WP-2D7APk1"):
            _d = acm.resolve_code(idx2, _q)
            check(f"F-B 注入后 q={_q} 仍 ambiguous（R3' 未误伤纯影子编号）",
                  _d["kind"] == "ambiguous", f"kind={_d.get('kind')} shared={_d.get('shared_count')}")
        # 4) 普通已登记设备：不受影响
        _d = acm.resolve_code(idx2, "105000620952")
        check("F-B 注入后 q='105000620952' 仍 device_code/exact",
              _d["kind"] == "device_code" and _d.get("exact") is True,
              f"kind={_d.get('kind')} exact={_d.get('exact')}")

        # ---- F-C：P2-2：_fuzzy_hits 自身守 R5（直调）----
        idxr = alr._get_match_index(db)
        _fh_short = acm._fuzzy_hits(idxr, "ab")
        check("F-C _fuzzy_hits('ab') == []（loose 长 2 < FUZZY_MIN_LEN）",
              _fh_short == [], f"len={len(_fh_short)}")
        _fh = acm._fuzzy_hits(idxr, "ge 2f ktjf")
        _dz = acm.resolve_code(idxr, "ge 2f ktjf")
        check("F-C _fuzzy_hits('ge 2f ktjf') 非空", len(_fh) > 0, f"len={len(_fh)}")
        check("F-C _fuzzy_hits('ge 2f ktjf') 与 resolve 模糊层 count 一致",
              len(_fh) == _dz.get("count") and _dz.get("count", 0) > 0,
              f"{len(_fh)} vs count={_dz.get('count')}")
        check("F-C _fuzzy_hits('42U')（loose 长 3）生效（>=FUZZY_MIN_LEN）",
              len(acm._fuzzy_hits(idxr, "42U")) >= 1,
              f"len={len(acm._fuzzy_hits(idxr, '42U'))}")

        # ============ G) 歧义 hint「动作指引」分档（P2 收尾）============
        print("=" * 78)
        print("G) ambiguous hint 动作指引分档（按候选条数）")

        _d = c.get(RESOLVE, params={"q": "0512001"}).json()
        _r = (_d.get("hint") or {}).get("reason", "")
        print(f"  q=0512001 count={_d.get('count')} shared={_d.get('shared_count')} reason={_r!r}")
        check("G q=0512001 hint 含『当前仅定位到 1 台设备』且不含『在候选中确认』",
              ("当前仅定位到 1 台设备" in _r) and ("在候选中确认" not in _r), f"= {_r!r}")

        _d = c.get(RESOLVE, params={"q": "BQL-B1-SB-01"}).json()
        _r = (_d.get("hint") or {}).get("reason", "")
        print(f"  q=BQL-B1-SB-01 count={_d.get('count')} shared={_d.get('shared_count')} reason={_r!r}")
        check("G q=BQL-B1-SB-01 hint 含『当前仅定位到 1 台设备』且不含『在候选中确认』",
              ("当前仅定位到 1 台设备" in _r) and ("在候选中确认" not in _r), f"= {_r!r}")

        _d = c.get(RESOLVE, params={"q": "595036PME"}).json()
        _r = (_d.get("hint") or {}).get("reason", "")
        _exp = "该编号被 145 台设备共用，无法唯一确定，请按所在位置/资产编号在候选中确认"
        print(f"  q=595036PME count={_d.get('count')} shared={_d.get('shared_count')} reason={_r!r}")
        check("G q=595036PME hint.reason 逐字等于原文（不误伤）", _r == _exp, f"= {_r!r}")

        _d = c.get(RESOLVE, params={"q": "J-1"}).json()
        print(f"  q=J-1 kind={_d.get('kind')} exact={_d.get('exact')} hint={_d.get('hint')}")
        check("G q=J-1 仍 device_code/exact 且无 hint（R3' 不回归）",
              _d.get("kind") == "device_code" and _d.get("exact") is True and _d.get("hint") is None,
              f"kind={_d.get('kind')} exact={_d.get('exact')} hint={_d.get('hint')}")

        # ============ H) tier0 定向覆盖：len(uniq)==0 的歧义（P2 收尾，纯内存合成）============
        print("=" * 78)
        print("H) tier0 定向：短值 loose<3 被 >=2 行共用 → count=0 的歧义动作指引")
        _idx0 = alr._get_match_index(db)
        _short_raw = "Z-9"                                  # loose = "Z9"（len 2 < FUZZY_MIN_LEN）
        _short_loose = acm.normalize_code(_short_raw)["loose"]
        print(f"     短值 raw={_short_raw!r} loose={_short_loose!r}（len={len(_short_loose)}）")
        check("H 短值 loose 长度 < FUZZY_MIN_LEN（前置条件）",
              len(_short_loose) < acm.FUZZY_MIN_LEN, f"len={len(_short_loose)}")
        check("H 短值注入前不在 shared_values / 任何索引空间（保证计数恰为 2）",
              _short_loose not in _idx0["shared_values"]
              and _short_loose not in _idx0["device_code"]
              and _short_loose not in _idx0["alias"]
              and _short_loose not in _idx0["brand_serial"]
              and _short_loose not in _idx0["serial_no"],
              f"loose={_short_loose!r}")
        _rows_h = [dict(r) for r in alr._load_all(db)]
        for _i in ("A", "B"):
            _rows_h.append({"device_code": f"__SYNTH_T0_{_i}__", "source": "ledger_only",
                            "asset_code": _short_raw, "brand_model": "", "name": f"合成tier0行{_i}"})
        _idx_h = acm.build_match_index(db, _rows_h)
        check("H 注入后 shared_values[短值] == 2", _idx_h["shared_values"].get(_short_loose) == 2,
              f"= {_idx_h['shared_values'].get(_short_loose)}")
        _d = acm.resolve_code(_idx_h, _short_loose)
        _exp = "该编号被 2 台设备共用，无法唯一确定；当前未能定位到具体设备，请输入更完整的编号"
        print(f"     q={_short_loose!r} → kind={_d.get('kind')} count={_d.get('count')} "
              f"shared={_d.get('shared_count')} reason={(_d.get('hint') or {}).get('reason')!r}")
        check("H kind=ambiguous", _d.get("kind") == "ambiguous", f"= {_d.get('kind')}")
        check("H count=0（tier0：uniq 为空）", _d.get("count") == 0, f"= {_d.get('count')}")
        check("H shared_count=2", _d.get("shared_count") == 2, f"= {_d.get('shared_count')}")
        check("H hint.can_observe=False", (_d.get("hint") or {}).get("can_observe") is False,
              f"= {(_d.get('hint') or {}).get('can_observe')}")
        check("H hint.reason 逐字等于 tier0 文案",
              (_d.get("hint") or {}).get("reason") == _exp,
              f"= {(_d.get('hint') or {}).get('reason')!r}")

    print("=" * 78)
    print(f"===== 结果: PASS={passed}  FAIL={failed} =====")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
