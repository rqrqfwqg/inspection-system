import json
data = json.load(open('plan_data.json', 'r', encoding='utf-8'))
day1 = data['1']
m = day1.get('morning', {}).get('rooms', [])
e = day1.get('evening', {}).get('rooms', [])
print('早班高频:', sum(1 for r in m if r.get('类型')=='高频'))
print('早班低频:', sum(1 for r in m if r.get('类型')=='低频'))
print('晚班高频:', sum(1 for r in e if r.get('类型')=='高频'))
print('晚班低频:', sum(1 for r in e if r.get('类型')=='低频'))
print('早班总:', len(m))
print('晚班总:', len(e))
