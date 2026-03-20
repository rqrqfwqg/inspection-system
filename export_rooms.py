import sqlite3
conn = sqlite3.connect('backend/app.db')
cursor = conn.cursor()
cursor.execute('SELECT building, floor, name, code, room_type, shift, is_active FROM rooms')
rows = cursor.fetchall()

# 生成Python导入脚本
with open('import_rooms_server.py', 'w', encoding='utf-8') as f:
    f.write('''
from database import SessionLocal, Room
db = SessionLocal()

rooms = [
''')
    for r in rows:
        f.write(f"    Room(building={repr(r[0])}, floor={repr(r[1])}, name={repr(r[2])}, code={repr(r[3])}, room_type={repr(r[4])}, shift={repr(r[5])}, is_active={bool(r[6])}),\n")
    f.write(''']

for r in rooms:
    db.add(r)
db.commit()
print(f'已创建 {len(rooms)} 个机房')
db.close()
''')
conn.close()
print("生成成功!")
