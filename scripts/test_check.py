import sqlite3
import json

conn = sqlite3.connect('backend/app.db')
cursor = conn.cursor()

# 查询数据
cursor.execute("SELECT id, year, month, data FROM inspection_plans WHERE year=2026 AND month=3")
row = cursor.fetchone()
if row:
    data = json.loads(row[3])
    print("日期     高频   低频   合计")
    total_high = 0
    total_low = 0
    for day in range(1, 29):
        date_str = f'2026-03-{day:02d}'
        if date_str in data:
            p = data[date_str]
            h = p.get('high', 0)
            l = p.get('low', 0)
            t = p.get('total', 0)
            print(f'{date_str}  {h:4d}  {l:4d}  {t:4d}')
            total_high += h
            total_low += l
    print(f'合计:    {total_high}  {total_low}')
else:
    print("没有找到数据")
