# -*- coding: utf-8 -*-
"""QA 独立验证 · fixture 行数与并集（item 1 前置）

只读 fixture，复现 asset_ledger_routes._load_all 的并集口径：
  并集 = DISTINCT 非空 device_code，取自 devices ∪ records(non-null,non-'' ) ∪ fixed_assets
"""
import sqlite3

P = r"C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/backend/scripts/_online_fixture.db"
con = sqlite3.connect(P)


def one(sql):
    return con.execute(sql).fetchone()[0]


print("== 三表原始行数 ==")
for t in ("devices", "fixed_assets", "records"):
    print(f"  {t}: {one(f'SELECT COUNT(*) FROM {t}')}")

print("== device_code 空/NULL 计数 ==")
print("  devices 空:", one("SELECT COUNT(*) FROM devices WHERE device_code IS NULL OR device_code=''"))
print("  fixed_assets 空:", one("SELECT COUNT(*) FROM fixed_assets WHERE device_code IS NULL OR device_code=''"))
print("  records 空:", one("SELECT COUNT(*) FROM records WHERE device_code IS NULL OR device_code=''"))

# 复现 _ALL_SQL 的 UNION（含 NULL/空），再按 _load_all 的 `if not code: continue` 过滤
sql_union_raw = """
WITH allc AS (
    SELECT device_code FROM devices
    UNION
    SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code <> ''
    UNION
    SELECT device_code FROM fixed_assets
)
SELECT COUNT(*) FROM allc
"""
sql_union_nonempty = """
WITH allc AS (
    SELECT device_code FROM devices
    UNION
    SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code <> ''
    UNION
    SELECT device_code FROM fixed_assets
)
SELECT COUNT(*) FROM allc WHERE device_code IS NOT NULL AND device_code <> ''
"""
print("== 并集 ==")
print("  UNION 原始行数（含 NULL/空）:", one(sql_union_raw))
print("  过滤 NULL/空后（=_load_all 行数）:", one(sql_union_nonempty))

# 分表 distinct 非空
for t in ("devices", "fixed_assets", "records"):
    print(f"  DISTINCT 非空 {t}:",
          one(f"SELECT COUNT(DISTINCT device_code) FROM {t} WHERE device_code IS NOT NULL AND device_code<>''"))

# fixed_assets 每个 device_code 是否唯一（影响 LEFT JOIN 行数）
print("== 唯一性 ==")
print("  devices device_code 重复组数:",
      one("SELECT COUNT(*) FROM (SELECT device_code FROM devices GROUP BY device_code HAVING COUNT(*)>1)"))
print("  fixed_assets device_code 重复组数:",
      one("SELECT COUNT(*) FROM (SELECT device_code FROM fixed_assets GROUP BY device_code HAVING COUNT(*)>1)"))

con.close()
