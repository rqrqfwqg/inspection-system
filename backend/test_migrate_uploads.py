"""backend/migrate_uploads.py 幂等迁移测试。

- 插入一条历史 /uploads/ 路径的临时用户；
- 运行迁移脚本（子进程），断言退出码 0 且路径改写为 /ops/uploads/；
- 再次运行，断言退出码仍为 0 且路径不再变化（幂等）；
- 清理临时数据。
"""
import os
import subprocess
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal, User  # noqa: E402


BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _python():
    venv_py = os.path.join(BACKEND_DIR, "venv", "Scripts", "python.exe")
    if os.path.exists(venv_py):
        return venv_py
    return "C:/Users/yan/.workbuddy/binaries/python/versions/3.13.12/python.exe"


def _run_migrate():
    return subprocess.run(
        [_python(), "migrate_uploads.py"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
    )


def test_migrate_idempotent_exit_zero():
    orig = f"/uploads/idem_{uuid.uuid4().hex}.png"
    db = SessionLocal()
    try:
        u = User(
            email=f"idem_{uuid.uuid4().hex}@test.local",
            name="idem",
            phone=f"000{uuid.uuid4().hex[:7]}",
            password_hash="x",
            role="user",
            avatar=orig,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        uid = u.id
    finally:
        db.close()

    # 第一次迁移
    r1 = _run_migrate()
    assert r1.returncode == 0, f"首次迁移失败: {r1.stderr}"

    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == uid).first()
        assert u.avatar == orig.replace("/uploads/", "/ops/uploads/"), \
            f"路径未正确改写: {u.avatar}"
    finally:
        db.close()

    # 第二次迁移：必须幂等（退出码 0 且路径不变）
    r2 = _run_migrate()
    assert r2.returncode == 0, f"二次迁移失败: {r2.stderr}"

    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == uid).first()
        assert u.avatar == orig.replace("/uploads/", "/ops/uploads/"), \
            f"二次迁移后路径不应再变化: {u.avatar}"
    finally:
        db.close()

    # 清理临时数据
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == uid).first()
        if u:
            db.delete(u)
            db.commit()
    finally:
        db.close()
