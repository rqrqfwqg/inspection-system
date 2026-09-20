"""运维执行域 · 一次性幂等迁移脚本（工单 / 事件 / 备件镜像）。

职责
----
1. **先备份**：`app.db` → `app.db.bak.<时间戳>`（严禁覆盖原库、严禁原地改）。
2. **体检**：`PRAGMA integrity_check` 必须为 `ok`，否则中止（不带病迁移）。
3. **建表**：用 SQLAlchemy 元数据 `create_all` 只**新建缺失表**；
   **绝不 ALTER 任何既有表**（资产台账核心表一行不动）。
4. **守恒核对**：迁移前后打印 `devices` / `records` / `fixed_assets` 行数，
   证明资产底座未被触碰（AC-08：新表写入后 ledger total 守恒不变；基线以线上为准，快照 8455）。

用法
----
    python migrate_work_orders.py                        # 迁移 backend/app.db
    python migrate_work_orders.py --db /path/to/copy.db  # 迁移指定副本（本地验证用）

重复执行安全：已存在的表会被跳过；备份每次都会另存一份（带时间戳，不覆盖旧备份）。
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

from sqlalchemy import create_engine, inspect, text

# 导入即把新表注册到 `Base.metadata`（create_all 才会有它们）；
# `from database import Base` 同时完成 database 模块加载，故无需单独 import database。
import work_order_models  # noqa: F401
from database import Base

# 本脚本负责的物理表（与 work_order_models 一一对应）
NEW_TABLES = (
    "work_orders",
    "work_order_events",
    "sync_receipts",
    "spare_parts_catalog",
    "spare_parts_inventory",
    "work_order_spare_consumptions",
)

# 守恒核对用：资产底座表（迁移前后行数必须一致）
LEDGER_TABLES = ("devices", "records", "fixed_assets")

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.db")


def _backup(db_path: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{db_path}.bak.{ts}"
    shutil.copy2(db_path, bak)
    print(f"[迁移] 已备份 → {bak}")
    return bak


def _integrity_check(db_path: str) -> str:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        result = con.execute("PRAGMA integrity_check;").fetchone()[0]
    finally:
        con.close()
    print(f"[迁移] PRAGMA integrity_check = {result}")
    return result


def _ledger_counts(db_path: str) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        out = {}
        for table in LEDGER_TABLES:
            try:
                out[table] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.OperationalError:
                out[table] = None
        return out
    finally:
        con.close()


def migrate(db_path: str) -> int:
    print("=" * 64)
    print("运维执行域迁移开始（工单 / 备件镜像）")
    print(f"目标库：{db_path}")
    print("=" * 64)

    if not os.path.exists(db_path):
        print(f"[迁移] 未找到数据库 {db_path}，中止。")
        return 2

    before = _ledger_counts(db_path)
    print(f"[迁移] 迁移前资产底座行数：{before}")

    _backup(db_path)
    status = _integrity_check(db_path)
    if status.lower() != "ok":
        print("[迁移] integrity_check 未通过，已中止（原库未被改动）。")
        return 3

    engine = create_engine(f"sqlite:///{db_path}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)          # 只建缺失表，不做 ALTER

    inspector = inspect(engine)
    missing = [t for t in NEW_TABLES if not inspector.has_table(t)]
    present = [t for t in NEW_TABLES if inspector.has_table(t)]
    print(f"[迁移] 已确认新表存在（{len(present)}/{len(NEW_TABLES)}）：{', '.join(present)}")
    if missing:
        print(f"[迁移] 失败：以下表未建成：{', '.join(missing)}")
        return 4

    # 空表计数（幂等复跑时应保持 0；迁移只建结构、不造业务数据）
    with engine.connect() as conn:
        for table in NEW_TABLES:
            n = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            print(f"[迁移] {table:<32} rows={n}")

    after = _ledger_counts(db_path)
    print(f"[迁移] 迁移后资产底座行数：{after}")
    if before != after:
        print("[迁移] 警告：资产底座行数发生变化，请立即人工核查！")
        return 5
    print("[迁移] 资产底座行数守恒（未被触碰）")
    print("=" * 64)
    print("迁移完成")
    print("=" * 64)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="运维执行域幂等迁移（只建新表，不做 ALTER）")
    parser.add_argument("--db", default=DEFAULT_DB, help="目标 SQLite 库路径")
    args = parser.parse_args(argv)
    return migrate(os.path.abspath(args.db))


if __name__ == "__main__":
    sys.exit(main())
