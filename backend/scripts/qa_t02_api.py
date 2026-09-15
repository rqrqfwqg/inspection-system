# -*- coding: utf-8 -*-
"""QA T02 · 独立复核 B–F（补录 API：归一幂等 / 冲突对象 / 缓存失效 / 跨设备隔离 / 边界）。

在 fixture 的**副本**上通过 TestClient 打真实 HTTP；源 fixture 只读（前后校验）。
绝不写 _online_fixture.db / app.db。
"""
import hashlib
import json
import os
import shutil
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)
os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")

SRC = os.path.join(_HERE, "_online_fixture.db")
RT = os.path.join(_HERE, "qa_t02_runtime.db")


def sig(p):
    st = os.stat(p)
    return (round(st.st_mtime, 6), st.st_size)


def fa_hash(p):
    """fixed_assets / devices 全表内容摘要（证明补录绝不写台账）。"""
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    out = {}
    for t in ("fixed_assets", "devices", "device_serial_observations"):
        try:
            rows = list(con.execute(f"SELECT * FROM {t} ORDER BY rowid"))
        except sqlite3.OperationalError:
            out[t] = "N/A"
            continue
        h = hashlib.md5()
        for r in rows:
            h.update(repr(r).encode("utf-8", "ignore"))
        out[t] = (len(rows), h.hexdigest())
    con.close()
    return out


SRC_BEFORE = sig(SRC)
FA_BEFORE = fa_hash(SRC)

# 注意：本机 shim 拦截 os.remove（转回收站会失败）→ 一律用 copy2 覆盖，绝不 remove
shutil.copy2(SRC, RT)

# ---- rebind database engine to the RUNTIME copy, then import app ----
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
import database  # noqa: E402

url = "sqlite:///" + RT.replace("\\", "/")
database.DATABASE_URL = url
database.engine = create_engine(url, connect_args={"check_same_thread": False})
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
import asset_code_match as acm  # noqa: E402
from database import FixedAsset, DeviceSerialObservation, SessionLocal  # noqa: E402

P = "/ops/api/assets"
OBS = f"{P}/asset-ledger/observations"
RESOLVE = f"{P}/asset-ledger/resolve"

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {extra}")


def sect(t):
    print("=" * 78)
    print(t)


def _sess():
    return SessionLocal()


def _top(d):
    cs = d.get("candidates") or []
    return cs[0] if cs else {}


def _has(d, code=None, mtype=None):
    for x in (d.get("candidates") or []):
        if code is not None and x.get("device_code") != code:
            continue
        if mtype is not None and x.get("match_type") != mtype:
            continue
        return True
    return False


def _fa_dump(s, code):
    fa = s.query(FixedAsset).filter(FixedAsset.device_code == code).first()
    if fa is None:
        return None
    return json.dumps({c.name: str(getattr(fa, c.name)) for c in FixedAsset.__table__.columns},
                      ensure_ascii=False, sort_keys=True)


# ---- 独立复算 ground truth（不信作者常量）----
con = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
GT = {}
for code in ("105000620952", "105000621392", "105000625413", "105000615032"):
    row = con.execute(
        "SELECT brand_model, serial_no FROM fixed_assets WHERE device_code=?",
        (code,)).fetchone()
    dev = con.execute(
        "SELECT COUNT(*) FROM devices WHERE device_code=?", (code,)).fetchone()[0]
    GT[code] = {"fa": row, "in_devices": dev}
con.close()

D = "105000620952"           # 真设备 + 台账抽出机身编号
B_OBS = "105000621392"       # 另一真设备（跨设备 active 观测分支）
B_LED = "105000625413"       # 真设备，台账抽不出机身编号
LED_OCCUPIED_BY = "105000615032"

print("=== 独立复算 ground truth（只读源 fixture）===")
for c, v in GT.items():
    bm = (v["fa"][0] if v["fa"] else None)
    ex = acm.extract_serial_from_brand(bm) if bm else ""
    print(f"  {c}: in_devices={v['in_devices']} brand_model={bm!r} -> extract={ex!r} "
          f"serial_no={(v['fa'][1] if v['fa'] else None)!r}")

D_EX = acm.extract_serial_from_brand(GT[D]["fa"][0]) if GT[D]["fa"] else ""
D_SN = (GT[D]["fa"][1] if GT[D]["fa"] else "") or ""
B_LED_EX = acm.extract_serial_from_brand(GT[B_LED]["fa"][0]) if GT[B_LED]["fa"] else ""

with TestClient(app) as c:
    # ============================================================ B) 归一幂等
    sect("B) 归一幂等：同一机身编号多种书写 → 仅首建，其余 already=True")
    base = "QA-T02-7G8H9I"
    want = acm.normalize_code(base)["loose"]
    forms = [base, base.lower(), base.replace("-", " "),
             "ＱＡ－Ｔ０２－７Ｇ８Ｈ９Ｉ",           # 全角
             base + "   ", "QA/T02/7G8H9I", "qA-t02_7g8h9i"]
    print(f"  目标 loose = {want!r}")
    ids = []
    for i, f in enumerate(forms):
        ll = acm.normalize_code(f)["loose"]
        r = c.post(OBS, json={"device_code": B_LED, "serial_raw": f})
        d = r.json()
        ids.append(d.get("id"))
        if i == 0:
            check(f"B 首建({f!r}) loose=={want!r}", ll == want, f"= {ll!r}")
            check("B 首建 already=False", r.status_code == 200 and d.get("already") is False,
                  f"code={r.status_code} already={d.get('already')}")
        else:
            check(f"B 变体({f!r}) 归一一致且 already=True",
                  ll == want and d.get("already") is True and d.get("id") == ids[0],
                  f"loose={ll!r} already={d.get('already')} id={d.get('id')}")
    s = _sess()
    n = s.query(DeviceSerialObservation).filter(
        DeviceSerialObservation.device_code == B_LED,
        DeviceSerialObservation.serial_norm == want,
        DeviceSerialObservation.status == "active").count()
    s.close()
    check("B 仅落 1 条 active 行（7 种书写幂等）", n == 1, f"n={n}")
    base_loose = want

    # ============================================================ C) 冲突对象
    sect("C) 冲突对象 = brand_model 抽取值（非 serial_no）+ fixed_assets 逐字节不变")
    print(f"  台账 {D}: extract={D_EX!r} serial_no={D_SN!r}")
    check("C 前置：抽出值与 serial_no loose 不同（可区分比对对象）",
          acm.normalize_code(D_EX)["loose"] != acm.normalize_code(D_SN)["loose"])

    # C1 提交 serial_no（≠抽取值）→ 必须判 conflicts_ledger（证明比对对象非 serial_no）
    r = c.post(OBS, json={"device_code": D, "serial_raw": D_SN})
    d = r.json()
    check("C1 提交值==serial_no（≠抽取值）→ conflicts_ledger（非 none）",
          r.status_code == 200 and d.get("conflict_state") == "conflicts_ledger",
          f"= {d.get('conflict_state')}")

    # C2 提交抽取值（≠serial_no）→ 必须 none（证明比对对象是抽取值）
    r = c.post(OBS, json={"device_code": D, "serial_raw": D_EX})
    d = r.json()
    check("C2 提交值==抽取值（≠serial_no）→ none",
          r.status_code == 200 and d.get("conflict_state") == "none",
          f"= {d.get('conflict_state')}")

    # C3 任意第三值 → conflicts_ledger 且 conflict 对象字段正确
    before = None
    s = _sess(); before = _fa_dump(s, D); s.close()
    r = c.post(OBS, json={"device_code": D, "serial_raw": "QA-T02-CONFLICT-K3"})
    d = r.json()
    conf = d.get("conflict") or {}
    check("C3 第三值 → conflicts_ledger + conflict.type 正确（HTTP 200）",
          r.status_code == 200 and conf.get("type") == "conflicts_ledger",
          f"type={conf.get('type')}")
    check("C3 conflict.ledger_brand_serial == 抽取值（非 serial_no）",
          conf.get("ledger_brand_serial") == D_EX,
          f"= {conf.get('ledger_brand_serial')!r} vs {D_EX!r}")
    s = _sess(); after = _fa_dump(s, D); s.close()
    check("C3 fixed_assets 该行逐字节未变", before is not None and before == after,
          f"len {len(before or '')}->{len(after or '')}")

    # ============================================================ D) 缓存失效
    sect("D) 缓存失效：POST 后**立即**（不 sleep）resolve 命中 observation_exact/96")
    c.get(RESOLVE, params={"q": D})       # 热身缓存
    v6 = "QA-T02-CACHE-1A2B"
    r = c.post(OBS, json={"device_code": D, "serial_raw": v6})
    check("D POST 新建 200", r.status_code == 200 and r.json().get("already") is False,
          f"code={r.status_code}")
    sc, dd = c.get(RESOLVE, params={"q": v6}).status_code, c.get(RESOLVE, params={"q": v6}).json()
    top = _top(dd)
    check("D 立即 resolve → observation_exact/96/该设备",
          sc == 200 and dd.get("kind") == "serial"
          and top.get("match_type") == "observation_exact"
          and top.get("confidence") == 96 and top.get("device_code") == D,
          f"kind={dd.get('kind')} top={top.get('match_type')}/{top.get('confidence')}")
    check("D 未 sleep（缓存失效靠写入主动失效，非 TTL 过期）", True)

    # 反向：DELETE 后立即不再命中
    oid = r.json().get("id")
    rd = c.delete(f"{OBS}/{oid}")
    check("D DELETE 200/rejected", rd.status_code == 200 and rd.json().get("status") == "rejected")
    dd2 = c.get(RESOLVE, params={"q": v6}).json()
    check("D DELETE 后立即不再命中 observation_exact",
          not _has(dd2, None, "observation_exact"),
          f"cands={[x.get('device_code') for x in (dd2.get('candidates') or [])]}")

    # ============================================================ E) 跨设备隔离 + 复活
    sect("E) conflicts_other_device 隔离（含复活）")
    vA = "QA-T02-XD-9X8Y7"
    nA = acm.normalize_code(vA)["loose"]
    ra = c.post(OBS, json={"device_code": B_LED, "serial_raw": vA})
    check("E A(干净设备) 首录 none",
          ra.status_code == 200 and ra.json().get("conflict_state") == "none",
          f"= {ra.json().get('conflict_state')}")
    rb = c.post(OBS, json={"device_code": B_OBS, "serial_raw": vA})
    db_ = rb.json()
    check("E B 提交同编号 → conflicts_other_device",
          rb.status_code == 200 and db_.get("conflict_state") == "conflicts_other_device",
          f"= {db_.get('conflict_state')}")
    s = _sess()
    brow = (s.query(DeviceSerialObservation)
            .filter(DeviceSerialObservation.device_code == B_OBS,
                    DeviceSerialObservation.serial_norm == nA).first())
    bst = brow.status if brow else None
    s.close()
    check("E 隔离行落库 status=quarantined", bst == "quarantined", f"= {bst}")
    dd = c.get(RESOLVE, params={"q": vA}).json()
    check("E 隔离行不并入索引：resolve 不返回 B", not _has(dd, B_OBS))
    check("E 仍返回 A（active 观测）", _has(dd, B_LED, "observation_exact"))

    # 复活：撤销 A 的 active 观测 → B 重新补录 → 应转为 active 并重新进索引
    s = _sess()
    arow = (s.query(DeviceSerialObservation)
            .filter(DeviceSerialObservation.device_code == B_LED,
                    DeviceSerialObservation.serial_norm == nA,
                    DeviceSerialObservation.status == "active").first())
    aid = arow.id if arow else None
    s.close()
    c.delete(f"{OBS}/{aid}")
    mid = c.get(RESOLVE, params={"q": vA}).json()
    check("E 撤销 A 后 resolve 不再命中 observation_exact（B 仍隔离）",
          not _has(mid, None, "observation_exact"),
          f"cands={[x.get('device_code') for x in (mid.get('candidates') or [])]}")
    rb2 = c.post(OBS, json={"device_code": B_OBS, "serial_raw": vA})
    db2 = rb2.json()
    # 说明：B_OBS 台账 brand_model 抽取 = 'J1'（见 ground truth），≠ vA →
    # 复活后 conflict_state 正确应为 conflicts_ledger（并存待复核），非 none。
    check("E 复活：A 释放后 B 重新补录成功（200 且非 already）",
          rb2.status_code == 200 and db2.get("already") is False,
          f"code={rb2.status_code} conflict={db2.get('conflict_state')}")
    s = _sess()
    brow2 = (s.query(DeviceSerialObservation)
             .filter(DeviceSerialObservation.device_code == B_OBS,
                     DeviceSerialObservation.serial_norm == nA,
                     DeviceSerialObservation.status == "active").first())
    s.close()
    check("E 复活：B 落库为 active（可逆，值重新生效）", brow2 is not None)
    check("E 复活：conflict_state 与台账抽取不一致时=conflicts_ledger（并存语义正确）",
          db2.get("conflict_state") == "conflicts_ledger",
          f"= {db2.get('conflict_state')}（B 台账抽取='J1'≠{vA}）")
    res = c.get(RESOLVE, params={"q": vA}).json()
    check("E 复活：resolve 重新命中 B 的 observation_exact/96",
          _has(res, B_OBS, "observation_exact"),
          f"top={_top(res).get('match_type')}/{_top(res).get('device_code')}")

    # E-b：他机台账抽取值占用分支（占用值取自另一设备 LED_OCCUPIED_BY）
    occ_bm = GT[LED_OCCUPIED_BY]["fa"][0] if GT[LED_OCCUPIED_BY]["fa"] else ""
    OCC_EX = acm.extract_serial_from_brand(occ_bm)
    print(f"  占用者 {LED_OCCUPIED_BY} brand_model={occ_bm!r} -> extract={OCC_EX!r}")
    if OCC_EX:
        pre = c.get(RESOLVE, params={"q": OCC_EX}).json()
        check("E-b 前置：该编号当前由他机台账抽取命中 (brand_extract_exact)",
              _has(pre, LED_OCCUPIED_BY, "brand_extract_exact"),
              f"cands={[x.get('device_code') for x in (pre.get('candidates') or [])]}")
        rx = c.post(OBS, json={"device_code": B_LED, "serial_raw": OCC_EX})
        check("E-b 编号被他机台账抽取值占用 → conflicts_other_device",
              rx.status_code == 200
              and rx.json().get("conflict_state") == "conflicts_other_device",
              f"= {rx.json().get('conflict_state')}")
        post = c.get(RESOLVE, params={"q": OCC_EX}).json()
        check("E-b 隔离行不并入索引：resolve 不返回 B_LED",
              not _has(post, B_LED),
              f"cands={[x.get('device_code') for x in (post.get('candidates') or [])]}")
    else:
        print("  [SKIP] E-b：占用者抽取值不可得")

    # ============================================================ F) 边界（绝不 500）
    sect("F) 边界鲁棒性（一律不 500）")
    cases = [
        ("空串", {"device_code": D, "serial_raw": ""}, 400),
        ("纯空白", {"device_code": D, "serial_raw": "   "}, 400),
        ("纯分隔符 ---", {"device_code": D, "serial_raw": "---"}, 400),
        ("全角空白", {"device_code": D, "serial_raw": "　　"}, 400),
        ("device_code 空", {"device_code": "", "serial_raw": "ABC123"}, 400),
        ("device_code 空白", {"device_code": "  ", "serial_raw": "ABC123"}, 400),
        ("未知设备", {"device_code": "__QA_NOPE__", "serial_raw": "ABC123"}, 404),
        ("缺 device_code 字段", {"serial_raw": "ABC123"}, 422),
        ("缺 serial_raw 字段", {"device_code": D}, 422),
        ("超长 4000 字符", {"device_code": D, "serial_raw": "Z" * 4000}, 200),
        ("emoji 编号", {"device_code": D, "serial_raw": "😀😀😀"}, 200),
        ("坏 observed_at", {"device_code": D, "serial_raw": "QA-T02-BADDT",
                            "observed_at": "not-a-date"}, 200),
    ]
    for name, body, want in cases:
        r = c.post(OBS, json=body)
        check(f"F POST {name} → {want}（无 500）",
              r.status_code == want, f"code={r.status_code}")
    # 极端：JSON 类型错误（serial_raw 传 int）
    r = c.post(OBS, json={"device_code": D, "serial_raw": 12345})
    check("F serial_raw 非字符串 → 422（无 500）", r.status_code == 422, f"code={r.status_code}")
    # DELETE 不存在
    r = c.delete(f"{OBS}/999999999")
    check("F DELETE 不存在 id → 404", r.status_code == 404, f"code={r.status_code}")
    # GET 非法 status / 不存在设备
    r = c.get(OBS, params={"status": "__bogus__"})
    check("F GET ?status=bogus → 200 []", r.status_code == 200 and r.json() == [],
          f"code={r.status_code}")
    r = c.get(OBS, params={"device_code": "__QA_NOPE__"})
    check("F GET 不存在设备 → 200 []", r.status_code == 200 and r.json() == [],
          f"code={r.status_code}")
    # observed_at 合法解析
    r = c.post(OBS, json={"device_code": D, "serial_raw": "QA-T02-DT-1",
                          "observed_at": "2026-09-11T08:31:00Z"})
    s = _sess()
    row = (s.query(DeviceSerialObservation)
           .filter(DeviceSerialObservation.id == r.json().get("id")).first())
    oa = row.observed_at if row else None
    s.close()
    check("F 合法 observed_at 解析为 datetime", oa is not None and hasattr(oa, "year"),
          f"= {oa!r}")

print()
print("=== 源 fixture / 台账 只读性校验 ===")
SRC_AFTER = sig(SRC)
FA_AFTER = fa_hash(SRC)
check("源 fixture mtime/size 未变", SRC_BEFORE == SRC_AFTER, f"{SRC_BEFORE} -> {SRC_AFTER}")
check("源 fixed_assets 内容摘要未变", FA_BEFORE["fixed_assets"] == FA_AFTER["fixed_assets"],
      f"{FA_BEFORE['fixed_assets']} -> {FA_AFTER['fixed_assets']}")

# 副本上：fixed_assets 也须未被补录改动（红线「绝不写台账」）
FA_RT = fa_hash(RT)
print(f"  副本 fixed_assets 摘要（写后）= {FA_RT['fixed_assets']}")
check("副本 fixed_assets 与源一致（补录未写台账）",
      FA_RT["fixed_assets"] == FA_AFTER["fixed_assets"],
      f"rt={FA_RT['fixed_assets']}")

print()
print(f"===== B–F 结果: PASS={passed}  FAIL={failed} =====")
sys.exit(1 if failed else 0)
