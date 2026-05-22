import sys
sys.path.insert(0, 'backend')
from database import get_db, InspectionRule, Room

db = next(get_db())

# 检查规则
rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
if not rule:
    print("错误: 未找到生效的巡查规则")
else:
    print(f"规则: 高频={rule.high_freq_days}次/月, 低频={rule.low_freq_times}次/月")

# 检查机房
rooms = db.query(Room).filter(Room.is_active == True).all()
high_count = sum(1 for r in rooms if r.room_type == '高频')
low_count = sum(1 for r in rooms if r.room_type == '低频')
print(f"机房: 高频={high_count}, 低频={low_count}, 总={len(rooms)}")

# 检查是否有计划
from database import InspectionPlan
plan = db.query(InspectionPlan).filter(InspectionPlan.year == 2026, InspectionPlan.month == 3).first()
print(f"2026年3月计划: {'存在' if plan else '不存在'}")
