# -*- coding: utf-8 -*-
"""QA 独立验证 · item 1：fixture 是否忠实于线上库

方法：
  1. 从 fixture 的并集里随机抽 N 个 device_code（一半取自固定资产集合以保证有 brand_model）。
  2. 通过只读技能 online_db.py（TAT SQL）分批拉线上对应行的
       devices.asset_code / fixed_assets.asset_code / fixed_assets.brand_model / fixed_assets.serial_no
  3. 按 _load_all 的装配口径（asset_code = fa.asset_code or d.asset_code）比对。

仅只读。绝不写线上库、绝不改 fixture。
"""
import json
import os
import random
import sqlite3
import subprocess
import sys

PY = r"C:/Users/yan/.workbuddy/binaries/python/versions/3.13.12/python.exe"
SKILL = r"C:/Users/yan/.workbuddy/skills/inspection-online-db/online_db.py"
FIX = r"C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/backend/scripts/_online_fixture.db"
ENV = dict(os.environ)
ENV["PYTHONPATH"] = r"C:/Users/yan/.workbuddy/binaries/python/envs/default/Lib/site-packages"

N_UNION = 120
N_FA = 80
BATCH = 40


def norm_ws(v):
    import re
    return re.sub(r"\s+", " ", str(v or "")).strip()


# ---- 1. 抽样 ----
con = sqlite3.connect(FIX)
codes = set()
union_codes = [r[0] for r in con.execute(
    "SELECT DISTINCT device_code FROM (SELECT device_code FROM devices "
    "UNION SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code<>'' "
    "UNION SELECT device_code FROM fixed_assets)")]
fa_codes = [r[0] for r in con.execute("SELECT DISTINCT device_code FROM fixed_assets")]
rnd = random.Random(20260826)
codes.update(rnd.sample(union_codes, min(N_UNION, len(union_codes))))
codes.update(rnd.sample(fa_codes, min(N_FA, len(fa_codes))))
codes = sorted(codes)
print(f"样本 device_code 数 = {len(codes)}（并集 {N_UNION} + 固定资产 {N_FA}，去重后）")

# fixture 侧期望值（按 _load_all 口径）
fix_map = {}
for c in codes:
    d = con.execute("SELECT asset_code FROM devices WHERE device_code=?", (c,)).fetchone()
    f = con.execute("SELECT asset_code, brand_model, serial_no FROM fixed_assets WHERE device_code=?", (c,)).fetchone()
    d_ac = norm_ws(d[0]) if d else ""
    f_ac = norm_ws(f[0]) if f else ""
    fix_map[c] = {
        "asset_code": f_ac or d_ac,
        "fa_asset_code": f_ac,
        "d_asset_code": d_ac,
        "brand_model": norm_ws(f[1]) if f else "",
        "serial_no": norm_ws(f[2]) if f else "",
    }
con.close()


# ---- 2. 线上分批查询 ----
def q(sql):
    p = subprocess.run([PY, SKILL, "sql", sql, "--max-chars", "24000"],
                       env=ENV, capture_output=True, text=True, timeout=300)
    out = p.stdout or ""
    # 截掉末尾 "# 返回 N 行"
    out = out.split("\n# 返回")[0].strip()
    try:
        return json.loads(out)
    except Exception:
        print("PARSE FAIL raw:", out[:500], file=sys.stderr)
        raise


online = {}
for i in range(0, len(codes), BATCH):
    chunk = codes[i:i + BATCH]
    inlist = ",".join("'" + c.replace("'", "''") + "'" for c in chunk)
    sql = (
        "SELECT a.device_code AS device_code, "
        "d.asset_code AS d_asset_code, "
        "f.asset_code AS fa_asset_code, f.brand_model AS brand_model, f.serial_no AS serial_no "
        "FROM (SELECT device_code FROM devices WHERE device_code IN (" + inlist + ") "
        "UNION SELECT device_code FROM records WHERE device_code IN (" + inlist + ") "
        "UNION SELECT device_code FROM fixed_assets WHERE device_code IN (" + inlist + ")) a "
        "LEFT JOIN devices d ON d.device_code=a.device_code "
        "LEFT JOIN fixed_assets f ON f.device_code=a.device_code "
        "WHERE a.device_code IN (" + inlist + ")"
    )
    rows = q(sql)
    for r in rows:
        online[r["device_code"]] = r
    print(f"  批次 {i//BATCH+1}: 拉取 {len(rows)} 行（累计 {len(online)}）")

# ---- 3. 比对 ----
mismatch = []
missing_online = []
for c in codes:
    o = online.get(c)
    if o is None:
        missing_online.append(c)
        continue
    exp = fix_map[c]
    got = {
        "asset_code": norm_ws(o.get("fa_asset_code")) or norm_ws(o.get("d_asset_code")),
        "fa_asset_code": norm_ws(o.get("fa_asset_code")),
        "d_asset_code": norm_ws(o.get("d_asset_code")),
        "brand_model": norm_ws(o.get("brand_model")),
        "serial_no": norm_ws(o.get("serial_no")),
    }
    for k in ("asset_code", "fa_asset_code", "d_asset_code", "brand_model", "serial_no"):
        if exp[k] != got[k]:
            mismatch.append((c, k, exp[k], got[k]))

print()
print(f"== 比对结果：样本 {len(codes)} 条 ==")
print(f"  线上缺失（并集里没有）: {len(missing_online)}  {missing_online[:10]}")
print(f"  字段不一致条数: {len(mismatch)}")
for c, k, e, g in mismatch[:30]:
    print(f"    {c}  [{k}]  fixture={e!r}  online={g!r}")
print("  结论:", "一致 PASS" if not mismatch and not missing_online else "不一致 FAIL")
