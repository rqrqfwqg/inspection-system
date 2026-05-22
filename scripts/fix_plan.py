import sys
sys.path.insert(0, 'backend')
from database import get_db, InspectionRule, Room, InspectionPlan
from datetime import datetime
import json
import calendar
from main import _build_plan_data

db = next(get_db())

# 获取规则和机房
rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
rooms = db.query(Room).filter(Room.is_active == True).all()

if not rule:
    print("未找到规则")
    exit()

# 修正规则为正确的值
rule.high_freq_days = 7   # 高频每月7次
rule.low_freq_times = 2   # 低频每月2次
db.commit()
print(f"规则已修正: 高频={rule.high_freq_days}次/月, 低频={rule.low_freq_times}次/月")

# 重新生成2026年3月计划
year, month = 2026, 3
plan_data = _build_plan_data(year, month, rule, rooms)

plan = db.query(InspectionPlan).filter(InspectionPlan.year == year, InspectionPlan.month == month).first()
if plan:
    plan.data = json.dumps(plan_data, ensure_ascii=False)
    plan.name = f"{year}年{month}月巡查计划"
    plan.updated_at = datetime.utcnow()
else:
    plan = InspectionPlan(name=f"{year}年{month}月巡查计划", year=year, month=month, data=json.dumps(plan_data, ensure_ascii=False))
    db.add(plan)

db.commit()
print("计划已重新生成!")

# 验证
total_high = sum(d["high"] for d in plan_data.values())
total_low = sum(d["low"] for d in plan_data.values())
print(f"高频总={total_high}, 低频总={total_low}")
