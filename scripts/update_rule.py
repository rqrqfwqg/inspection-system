import sys
sys.path.insert(0, 'backend')

from database import get_db, InspectionRule

db = next(get_db())
rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
if rule:
    rule.high_freq_days = 7  # 高频机房每月巡查7次
    rule.low_freq_times = 2  # 低频机房每月巡查2次
    db.commit()
    print(f"规则已更新: 高频每月{rule.high_freq_days}次, 低频每月{rule.low_freq_times}次")
else:
    print("未找到生效的规则")
