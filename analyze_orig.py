import json

data = json.load(open('plan_data.json', 'r', encoding='utf-8'))

# 分析每一天
print("=== 原始 plan_data.json 分配模式 ===")
for day_key in sorted(data.keys(), key=lambda x: int(x))[:15]:
    day_data = data[day_key]
    morning_rooms = day_data.get('morning', {}).get('rooms', [])
    evening_rooms = day_data.get('evening', {}).get('rooms', [])
    high = sum(1 for r in morning_rooms + evening_rooms if r.get('类型') == '高频')
    low = sum(1 for r in morning_rooms + evening_rooms if r.get('类型') == '低频')
    print(f"第{day_key}天: 高频={high}, 低频={low}, 总={high+low}")

# 统计高频机房的总数量
all_high = set()
all_low = set()
for day_key in data.keys():
    day_data = data[day_key]
    for r in day_data.get('morning', {}).get('rooms', []):
        if r.get('类型') == '高频':
            all_high.add(r.get('机房编号'))
        else:
            all_low.add(r.get('机房编号'))
    for r in day_data.get('evening', {}).get('rooms', []):
        if r.get('类型') == '高频':
            all_high.add(r.get('机房编号'))
        else:
            all_low.add(r.get('机房编号'))

print(f"\n=== 机房统计 ===")
print(f"高频机房总数: {len(all_high)}")
print(f"低频机房总数: {len(all_low)}")

# 统计每间高频机房出现的次数
high_room_counts = {}
for day_key in data.keys():
    day_data = data[day_key]
    for r in day_data.get('morning', {}).get('rooms', []) + day_data.get('evening', {}).get('rooms', []):
        if r.get('类型') == '高频':
            code = r.get('机房编号')
            high_room_counts[code] = high_room_counts.get(code, 0) + 1

low_room_counts = {}
for day_key in data.keys():
    day_data = data[day_key]
    for r in day_data.get('morning', {}).get('rooms', []) + day_data.get('evening', {}).get('rooms', []):
        if r.get('类型') == '低频':
            code = r.get('机房编号')
            low_room_counts[code] = low_room_counts.get(code, 0) + 1

print(f"\n=== 高频机房巡查次数分布 ===")
from collections import Counter
print(Counter(high_room_counts.values()))

print(f"\n=== 低频机房巡查次数分布 ===")
print(Counter(low_room_counts.values()))
