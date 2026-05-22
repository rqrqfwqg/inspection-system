import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 检查现有列
users_cols = [r[1] for r in cur.execute('PRAGMA table_info(users)')]
shift_cols = [r[1] for r in cur.execute('PRAGMA table_info(shift_tasks)')]
print('users cols:', users_cols)
print('shift_tasks cols:', shift_cols)

# 补 users 表缺失的列
if 'is_active' not in users_cols:
    cur.execute('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1')
    print('Added is_active to users')
if 'avatar' not in users_cols:
    cur.execute('ALTER TABLE users ADD COLUMN avatar TEXT')
    print('Added avatar to users')
if 'phone' not in users_cols:
    cur.execute('ALTER TABLE users ADD COLUMN phone TEXT')
    print('Added phone to users')
if 'updated_at' not in users_cols:
    cur.execute('ALTER TABLE users ADD COLUMN updated_at TEXT')
    print('Added updated_at to users')

# 补 shift_tasks 表缺失的列
if 'department' not in shift_cols:
    cur.execute('ALTER TABLE shift_tasks ADD COLUMN department TEXT')
    print('Added department to shift_tasks')
if 'completed_by' not in shift_cols:
    cur.execute('ALTER TABLE shift_tasks ADD COLUMN completed_by TEXT')
    print('Added completed_by to shift_tasks')

conn.commit()
conn.close()
print('Migration done.')
