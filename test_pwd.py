import sys
sys.path.insert(0, 'backend')
from database import get_db, User
from auth import verify_password

db = next(get_db())
admin = db.query(User).filter(User.role=='admin').first()
print(f"Admin: {admin.name}, phone: {admin.phone}")

# Test common passwords
test_passwords = ['admin123', 'admin', '123456', 'Admin123', 'password', '13570383740']
for pwd in test_passwords:
    ok = verify_password(pwd, admin.password_hash)
    print(f"  {pwd}: {'OK' if ok else 'FAIL'}")
