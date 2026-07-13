"""一次性幂等迁移：把库内历史 /uploads/ 路径改写为 /ops/uploads/。

- 规避与同机物料管理系统在 /uploads/ 上的命名冲突（运维上传命名空间化到 /ops/uploads）。
- 幂等：REPLACE 仅作用于仍以 /uploads/ 开头的记录，迁移后不再命中。
- 既可由 server-setup.sh 调用，也在后端启动（main.py lifespan）时自动执行。

用法：
    python backend/migrate_uploads.py
"""
import os
import sys

# 复用 database 的引擎配置
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sqlalchemy import text  # noqa: E402
from database import engine  # noqa: E402


def migrate() -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE users SET avatar = REPLACE(avatar, '/uploads/', '/ops/uploads/') "
            "WHERE avatar LIKE '/uploads/%'"
        ))
        conn.execute(text(
            "UPDATE shift_tasks SET images = REPLACE(images, '/uploads/', '/ops/uploads/') "
            "WHERE images LIKE '%/uploads/%'"
        ))
    print("[迁移] 上传路径已命名为 /ops/uploads/（幂等）")


if __name__ == "__main__":
    migrate()
