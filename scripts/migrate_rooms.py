"""
数据迁移脚本：
1. 从 plan_data.json 提取所有机房，写入 rooms 表（去重）
2. 创建默认巡查规则（高频4天一轮，低频月巡2次）
3. 创建新表（rooms, inspection_rules）
"""
import sys, json
from datetime import datetime

sys.path.insert(0, 'backend')
from database import get_db, init_db, Room, InspectionRule

# 初始化数据库（创建新表）
init_db()
print("数据库表初始化完成")

db = next(get_db())

# ---- 1. 提取机房 ----
with open('plan_data.json', 'r', encoding='utf-8') as f:
    plan_data = json.load(f)

seen_codes = set()
rooms_to_insert = []

for day_key, day_plan in plan_data.items():
    for shift_key in ('morning', 'evening'):
        shift = day_plan.get(shift_key, {})
        for room in shift.get('rooms', []):
            code = room.get('机房编号', '')
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            rooms_to_insert.append({
                'building':  room.get('楼栋', ''),
                'floor':     room.get('楼层', ''),
                'name':      room.get('机房名称', ''),
                'code':      code,
                'room_type': room.get('类型', '低频'),
                'shift':     shift_key,  # 原始班次
                'is_active': True,
            })

print(f"从计划数据中提取到 {len(rooms_to_insert)} 间机房")

# 写入 rooms 表（跳过已存在的）
created, skipped = 0, 0
for r in rooms_to_insert:
    existing = db.query(Room).filter(Room.code == r['code']).first()
    if existing:
        skipped += 1
        continue
    db.add(Room(**r))
    created += 1

db.commit()
print(f"机房导入完成: 新增 {created} 间，跳过 {skipped} 间（已存在）")

# ---- 2. 创建默认巡查规则 ----
existing_rule = db.query(InspectionRule).first()
if not existing_rule:
    rule = InspectionRule(
        name="标准巡查规则",
        high_freq_days=4,
        low_freq_times=2,
        is_active=True,
    )
    db.add(rule)
    db.commit()
    print(f"默认巡查规则已创建: 高频每4天一轮，低频月巡2次")
else:
    print(f"巡查规则已存在，跳过创建: {existing_rule.name}")

# ---- 汇总 ----
total_rooms = db.query(Room).count()
high_count  = db.query(Room).filter(Room.room_type == '高频').count()
low_count   = db.query(Room).filter(Room.room_type == '低频').count()
print(f"\n机房汇总: 共 {total_rooms} 间 (高频 {high_count}, 低频 {low_count})")
print("迁移完成!")
