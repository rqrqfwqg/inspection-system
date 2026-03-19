import sys
sys.path.insert(0, 'backend')
from database import get_db, InspectionRule

db = next(get_db())
r = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
if r:
    print(f"规则: 高频={r.high_freq_days}次/月, 低频={r.low_freq_times}次/月")
    print(f"规则ID: {r.id}")
else:
    print("未找到生效的规则")
