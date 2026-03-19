import json

with open('plan_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

days = list(data.values())
print(f'总天数: {len(days)}')

# 找出有低频机房的天
low_days = [d for d in days if d.get('low', 0) > 0]
print(f'有低频机房的天数: {len(low_days)}')

# 获取所有低频机房列表（去重）
all_low_rooms = set()
for d in days:
    for r in d.get('morning', {}).get('rooms', []):
        if r.get('类型') == '低频':
            all_low_rooms.add(r.get('机房编号', '') + ' ' + r.get('机房名称', ''))
    for r in d.get('evening', {}).get('rooms', []):
        if r.get('类型') == '低频':
            all_low_rooms.add(r.get('机房编号', '') + ' ' + r.get('机房名称', ''))

print(f'低频机房总数（去重）: {len(all_low_rooms)}')
print('低频机房列表:')
for r in sorted(all_low_rooms):
    print(f'  {r}')

# 统计每间低频机房出现次数
room_count = {}
for d in days:
    for r in d.get('morning', {}).get('rooms', []):
        if r.get('类型') == '低频':
            key = r.get('机房编号', '') + ' ' + r.get('机房名称', '')
            room_count[key] = room_count.get(key, 0) + 1
    for r in d.get('evening', {}).get('rooms', []):
        if r.get('类型') == '低频':
            key = r.get('机房编号', '') + ' ' + r.get('机房名称', '')
            room_count[key] = room_count.get(key, 0) + 1

print('\n每间低频机房出现次数:')
for k, v in sorted(room_count.items(), key=lambda x: x[1]):
    print(f'  {k}: {v}次')
