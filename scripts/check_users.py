"""查看数据库中的用户数据"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from database import get_db, User

db = next(get_db())
users = db.query(User).all()

print("\n=== 数据库中的用户列表 ===\n")
print(f"共 {len(users)} 个用户:\n")
for user in users:
    print(f"ID: {user.id}")
    print(f"邮箱: {user.email}")
    print(f"姓名: {user.name}")
    print(f"部门: {user.department or '未设置'}")
    print(f"职位: {user.position or '未设置'}")
    print(f"角色: {user.role}")
    print(f"状态: {'活跃' if user.is_active else '未激活'}")
    print(f"创建时间: {user.created_at}")
    print("-" * 40)

db.close()
