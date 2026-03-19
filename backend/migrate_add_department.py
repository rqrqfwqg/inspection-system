import sqlite3, os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cols = [row[1] for row in cur.execute('PRAGMA table_info(shift_tasks)')]
print('Current columns:', cols)

if 'department' not in cols:
    cur.execute('ALTER TABLE shift_tasks ADD COLUMN department TEXT')
    conn.commit()
    print('Added department column to shift_tasks.')
else:
    print('department column already exists.')

conn.close()
