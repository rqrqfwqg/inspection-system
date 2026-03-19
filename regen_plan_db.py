import sys
import json
import calendar
sys.path.insert(0, 'backend')

from database import get_db, InspectionPlan, Room, InspectionRule
from datetime import datetime
from main import _build_plan_data

db = next(get_db())

# 获取规则和机房
rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
rooms = db.query(Room).filter(Room.is_active == True).all()

if not rule:
    print("未找到规则")
    exit()

print(f"规则: 高频每月{rule.high_freq_days}次, 低频每月{rule.low_freq_times}次")
print(f"机房数: 高频={sum(1 for r in rooms if r.room_type=='高频')}, 低频={sum(1 for r in rooms if r.room_type=='低频')}")

year, month = 2026, 3

# 使用后端的 _build_plan_data 函数
plan_data = _build_plan_data(year, month, rule, rooms)

# 更新数据库
plan = db.query(InspectionPlan).filter(InspectionPlan.year == year, InspectionPlan.month == month).first()
if plan:
    plan.data = json.dumps(plan_data, ensure_ascii=False)
    plan.name = f"{year}年{month}月巡查计划"
    plan.updated_at = datetime.utcnow()
    print("已更新现有计划")
else:
    plan = InspectionPlan(
        name=f"{year}年{month}月巡查计划",
        year=year,
        month=month,
        data=json.dumps(plan_data, ensure_ascii=False)
    )
    db.add(plan)
    print("已创建新计划")

db.commit()

# 验证
total_high = sum(d["high"] for d in plan_data.values())
total_low = sum(d["low"] for d in plan_data.values())
print(f"\n生成完成: 高频总巡查次={total_high}, 低频总巡查次={total_low}")

# 显示前15天
total_days = calendar.monthrange(year, month)[1]
print(f"\n前15天明细:")
for day in range(1, min(16, total_days + 1)):
    d = plan_data[f"{year}-{month:02d}-{day:02d}"]
    print(f"第{day}天: 高频={d['high']}, 低频={d['low']}, 总={d['total']}")
