import json
from collections import Counter
data = json.load(open('plan_data.json', 'r', encoding='utf-8'))

# 统计所有高频机房编号
all_high = set()
for day_key in data.keys():
    day = data[day_key]
    for r in day.get('morning', {}).get('rooms', []) + day.get('evening', {}).get('rooms', []):
        if r.get('类型') == '高频':
            all_high.add(r.get('机房编号'))

print('高频机房总数:', len(all_high))

# 统计每间高频机房出现的次数
counts = {}
for day_key in data.keys():
    day = data[day_key]
    for r in day.get('morning', {}).get('rooms', []) + day.get('evening', {}).get('rooms', []):
        if r.get('类型') == '高频':
            code = r.get('机房编号')
            counts[code] = counts.get(code, 0) + 1

print('每间机房出现次数分布:', Counter(counts.values()))
