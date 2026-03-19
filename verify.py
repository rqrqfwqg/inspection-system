import sys
sys.path.insert(0, 'backend')
from main import _build_plan_data
from database import get_db, InspectionRule, Room
db = next(get_db())
rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
rooms = db.query(Room).filter(Room.is_active == True).all()
data = _build_plan_data(2026, 3, rule, rooms)
print('天数:', len(data))
print('高频总:', sum(d['high'] for d in data.values()))
print('低频总:', sum(d['low'] for d in data.values()))
