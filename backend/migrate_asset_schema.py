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

# field_defs 需补齐的列（2026-09-15 跨表检索钥匙）：
# `is_search_key` 与 `is_relation_key` 刻意区分 —— 后者决定记录归属哪台设备
# （一张表一个，导入时其值写成 records.device_code）；前者只扩大 /link/crossrefs
# 的检索范围，一张表可有多个，绝不参与 device_code 写入。
FIELD_DEFS_NEW_COLUMNS = {
    "is_search_key": "BOOLEAN DEFAULT 0",
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
    "device_serial_observations",
    "device_geo_observations",
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


def migrate_field_defs():
    """为 field_defs 补 is_search_key 列（幂等）。

    SQLite ALTER ADD COLUMN 对已有行填 DEFAULT 值；为防万一（旧版 SQLite /
    手工建列留下的 NULL），再补一次 UPDATE 置 0。
    """
    inspector = inspect(engine)
    if not inspector.has_table("field_defs"):
        print("[迁移] field_defs 表不存在，跳过。")
        return
    existing = {c["name"] for c in inspector.get_columns("field_defs")}
    added = []
    with engine.begin() as conn:
        for col, col_type in FIELD_DEFS_NEW_COLUMNS.items():
            if col in existing:
                continue
            conn.execute(text(f"ALTER TABLE field_defs ADD COLUMN {col} {col_type}"))
            added.append(col)
        if not existing or added:
            conn.execute(text("UPDATE field_defs SET is_search_key = 0 WHERE is_search_key IS NULL"))
    if added:
        print(f"[迁移] field_defs 已新增列：{', '.join(added)}")
    else:
        print("[迁移] field_defs 的 is_search_key 列已存在，无需 ALTER。")


def create_new_tables():
    """通过元数据创建新增表（幂等；已存在的表会被跳过）。"""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    created = [t for t in NEW_TABLES if inspector.has_table(t)]
    print(f"[迁移] 已确认新增表存在（{len(created)}/{len(NEW_TABLES)}）：{', '.join(created)}")


# device_serial_observations 的部分唯一索引（`Base.metadata.create_all` **不会**创建
# 带 `WHERE status='active'` 的部分唯一索引）+ 常规索引；`IF NOT EXISTS` 保证幂等。
DSO_INDEXES = (
    ("ux_dso_device_serial",
     "CREATE UNIQUE INDEX IF NOT EXISTS ux_dso_device_serial"
     " ON device_serial_observations(device_code, serial_norm) WHERE status = 'active'"),
    ("ix_dso_serial_norm",
     "CREATE INDEX IF NOT EXISTS ix_dso_serial_norm"
     " ON device_serial_observations(serial_norm)"),
    ("ix_dso_device",
     "CREATE INDEX IF NOT EXISTS ix_dso_device"
     " ON device_serial_observations(device_code)"),
)


def migrate_device_serial_observations():
    """为 device_serial_observations 建部分唯一索引 + 常规索引（幂等）。

    `create_all` 只建表、不建「带 WHERE 的部分唯一索引」，故须在此显式建立；
    `CREATE ... IF NOT EXISTS` 保证反复执行安全（第二次不报错、索引仍在）。
    """
    inspector = inspect(engine)
    if not inspector.has_table("device_serial_observations"):
        print("[迁移] device_serial_observations 表不存在，跳过索引创建。")
        return
    with engine.begin() as conn:
        existing = {r[0] for r in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
            " AND tbl_name = 'device_serial_observations'")).all()}
        created = []
        for name, ddl in DSO_INDEXES:
            if name in existing:
                continue
            conn.execute(text(ddl))
            created.append(name)
    if created:
        print(f"[迁移] device_serial_observations 已建索引：{', '.join(created)}")
    else:
        print("[迁移] device_serial_observations 索引已齐备，无需创建。")


def main():
    print("=" * 60)
    print("T3GTC 资产模块迁移开始")
    print("=" * 60)
    backup_db()
    migrate_devices()
    migrate_import_batches()
    migrate_field_defs()
    create_new_tables()
    migrate_device_serial_observations()
    print("=" * 60)
    print("迁移完成 ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()
