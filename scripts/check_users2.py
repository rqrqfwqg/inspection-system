import sys
sys.path.insert(0, 'backend')
from database import get_db, User
db = next(get_db())
users = db.query(User).all()
for u in users:
    print(f"name={u.name} phone={u.phone} email={u.email} role={u.role}")
