import sqlite3
import json

conn = sqlite3.connect('backend/app.db')
cursor = conn.cursor()

cursor.execute("SELECT id, data FROM inspection_plans WHERE year=2026 AND month=3")
plans = cursor.fetchall()

if plans:
    data = plans[0][1]
    plan_data = json.loads(data)

    print("每天巡查计划:")
    for day in [1, 2, 3, 4, 5, 9, 13, 15, 17, 21, 25, 28]:
        date_str = f"2026-03-{day:02d}"
        if date_str in plan_data:
            d = plan_data[date_str]
            print(f"{day}号: 高频={d.get('high')}, 低频={d.get('low')}")

conn.close()
