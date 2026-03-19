"""直接操作数据库更新巡查计划（跳过API）"""
import sys
import json
from datetime import datetime

sys.path.insert(0, 'backend')
from database import get_db, InspectionPlan

with open('plan_data.json', 'r', encoding='utf-8') as f:
    new_data = json.load(f)

plan_json = json.dumps(new_data, ensure_ascii=False)

# 统计验证
total_low = sum(d.get('low', 0) for d in new_data.values())
total_high = sum(d.get('high', 0) for d in new_data.values())
print(f"Low freq total: {total_low}")
print(f"High freq total: {total_high}")

db = next(get_db())

# 找到并删除2026年3月的计划
plans = db.query(InspectionPlan).filter(
    InspectionPlan.year == 2026,
    InspectionPlan.month == 3
).all()

for p in plans:
    print(f"Deleting plan ID={p.id}, name={p.name}")
    db.delete(p)
db.commit()

# 创建新计划
new_plan = InspectionPlan(
    name="2026年3月巡查计划",
    year=2026,
    month=3,
    data=plan_json,
    created_at=datetime.utcnow(),
    updated_at=datetime.utcnow()
)
db.add(new_plan)
db.commit()
db.refresh(new_plan)
print(f"[OK] Created plan ID={new_plan.id}")
print("Done!")
