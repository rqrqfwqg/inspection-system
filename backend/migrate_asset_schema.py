"""T3GTC 资产模块 · 一次性幂等迁移脚本（E-P0-1）

职责：
  1. 迁移前自动备份 app.db → app.db.bak.<时间戳>（严禁覆盖原库）。
  2. 对 `devices` 表做 ALTER，补齐 8 个资产扩展列（SQLite 仅支持加可空列，均满足）。
  3. 通过 Base.metadata.create_all 自动建立新增表
     （ba_system_map / equipment_categories / device_aliases / import_batches /
      fixed_assets / device_archives / device_accessories / ba_problems）。

用法：
  venv/Scripts/python.exe migrate_asset_schema.py
重复执行安全：已存在的列/表会跳过。
"""
import os
import shutil
from datetime import datetime

from sqlalchemy import create_engine, inspect, text

import database
from database import Base, engine

# 新增到 devices 的 8 个扩展列：列名 -> SQL 类型（不加 REFERENCES，避免旧版 SQLite 限制；
# ORM 关系靠列值映射，无需库级 FK 强制）。
DEVICE_NEW_COLUMNS = {
    "transfer_no": "VARCHAR",
    "asset_code": "VARCHAR",
    "category_id": "INTEGER",
    "bim_tag": "VARCHAR",
    "source_batch_id": "INTEGER",
    "old_code": "VARCHAR",
    "old_name": "VARCHAR",
    "system_text": "VARCHAR",
}

# import_batches 需补齐的列（P1 数据质量修复：补 file_count）
IMPORT_BATCH_NEW_COLUMNS = {
    "file_count": "INTEGER",
}

# 新增表（由模型元数据批量创建）
NEW_TABLES = [
    "ba_system_map",
    "equipment_categories",
    "device_aliases",
    "import_batches",
    "fixed_assets",
    "device_archives",
    "device_accessories",
    "ba_problems",
]


def backup_db():
    """迁移前备份 app.db，返回备份文件路径。"""
    db_path = database.os.path.join(database.BASE_DIR, "app.db")
    if not os.path.exists(db_path):
        print(f"[迁移] 未找到 app.db（{db_path}），跳过备份。")
        return None
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = f"{db_path}.bak.{ts}"
    shutil.copy2(db_path, bak)
    print(f"[迁移] 已备份 app.db → {bak}")
    return bak


def migrate_devices():
    """为 devices 表补齐缺失的扩展列（幂等）。"""
    inspector = inspect(engine)
    existing = {c["name"] for c in inspector.get_columns("devices")}
    added = []
    with engine.begin() as conn:
        for col, col_type in DEVICE_NEW_COLUMNS.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE devices ADD COLUMN {col} {col_type}"))
            added.append(col)
    if added:
        print(f"[迁移] devices 已新增列：{', '.join(added)}")
    else:
        print("[迁移] devices 扩展列已齐备，无需 ALTER。")


def migrate_import_batches():
    """为 import_batches 表补齐缺失列（幂等）。"""
    inspector = inspect(engine)
    existing = {c["name"] for c in inspector.get_columns("import_batches")}
    added = []
    with engine.begin() as conn:
        for col, col_type in IMPORT_BATCH_NEW_COLUMNS.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE import_batches ADD COLUMN {col} {col_type}"))
            added.append(col)
    if added:
        print(f"[迁移] import_batches 已新增列：{', '.join(added)}")
    else:
        print("[迁移] import_batches 列已齐备，无需 ALTER。")


def create_new_tables():
    """通过元数据创建新增表（幂等；已存在的表会被跳过）。"""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    created = [t for t in NEW_TABLES if inspector.has_table(t)]
    print(f"[迁移] 已确认新增表存在（{len(created)}/{len(NEW_TABLES)}）：{', '.join(created)}")


def main():
    print("=" * 60)
    print("T3GTC 资产模块迁移开始")
    print("=" * 60)
    backup_db()
    migrate_devices()
    migrate_import_batches()
    create_new_tables()
    print("=" * 60)
    print("迁移完成 ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()
