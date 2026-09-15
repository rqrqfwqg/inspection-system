# -*- coding: utf-8 -*-
"""QA T02 · fixture 表集合/mtime/size 快照（用于红线前后对比，只读）。"""
import os
import sqlite3
import sys
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)

for label, p in [("fixture", os.path.join(_HERE, "_online_fixture.db")),
                 ("app.db", os.path.join(_BACKEND, "app.db"))]:
    print(f"=== {label}: {os.path.basename(p)} ===")
    if not os.path.exists(p):
        print("  (不存在)")
        continue
    st = os.stat(p)
    print(f"  mtime={datetime.fromtimestamp(st.st_mtime)}  size={st.st_size}")
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    ts = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    con.close()
    print(f"  tables({len(ts)})={ts}")
    print(f"  has_DSO={'device_serial_observations' in ts}")
