import sqlite3
import json
conn = sqlite3.connect('backend/app.db')
cursor = conn.cursor()
cursor.execute('SELECT building, floor, name, code, room_type, shift, is_active FROM rooms')
rows = cursor.fetchall()

rooms = []
for r in rows:
    rooms.append({
        "building": r[0],
        "floor": r[1],
        "name": r[2],
        "code": r[3],
        "room_type": r[4],
        "shift": r[5],
        "is_active": bool(r[6])
    })

print(json.dumps({"rooms": rooms}, ensure_ascii=False))
conn.close()
