# -*- coding: utf-8 -*-
"""QA T02 · 环境探针：scripts 目录、fixture 表集合/mtime、app.db、内核 mtime"""
import os
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)

print("=== scripts/ 目录 ===")
for n in sorted(os.listdir(_HERE)):
    p = os.path.join(_HERE, n)
    if os.path.isfile(p):
        print(f"  {n:<44} {os.path.getsize(p):>10}  {__import__('datetime').datetime.fromtimestamp(os.path.getmtime(p))}")

for label, p in [("fixture", os.path.join(_HERE, "_online_fixture.db")),
                 ("app.db", os.path.join(_BACKEND, "app.db")),
                 ("copy", os.path.join(_HERE, "qa_t02.db"))]:
    print(f"\n=== {label}: {p} ===")
    if not os.path.exists(p):
        print("  (不存在)")
        continue
    print("  mtime =", __import__('datetime').datetime.fromtimestamp(os.path.getmtime(p)),
          " size =", os.path.getsize(p))
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    ts = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    print(f"  tables({len(ts)}) = {ts}")
    print("  has device_serial_observations =",
          "device_serial_observations" in ts)
    con.close()

print("\n=== 内核 mtime ===")
for n in ("asset_code_match.py", "asset_ledger_routes.py", "database.py",
          "migrate_asset_schema.py", "asset_schemas.py"):
    p = os.path.join(_BACKEND, n)
    print(f"  {n:<28} {__import__('datetime').datetime.fromtimestamp(os.path.getmtime(p))}")
