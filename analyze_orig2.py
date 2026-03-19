import json
data = json.load(open('plan_data.json', 'r', encoding='utf-8'))

# 分析每天早班和晚班的高/低频分布
print("=== 原始数据 day1 ===")
day1 = data['1']
print("早班:")
m = day1.get('morning', {}).get('rooms', [])
print(f"  总数: {len(m)}")
print(f"  高频: {sum(1 for r in m if r.get('类型')=='高频')}")
print(f"  低频: {sum(1 for r in m if r.get('类型')=='低频')}")

print("晚班:")
e = day1.get('evening', {}).get('rooms', [])
print(f"  总数: {len(e)}")
print(f"  高频: {sum(1 for r in e if r.get('类型')=='高频')}")
print(f"  低频: {sum(1 for r in e if r.get('类型')=='低频')}")

# 查看高频机房的编号是否有重复（同一间机房同一天出现两次？）
print("\n=== 检查是否有重复 ===")
all_high_codes_day1 = set()
for r in m + e:
    if r.get('类型') == '高频':
        code = r.get('机房编号')
        if code in all_high_codes_day1:
            print(f"重复: {code}")
        all_high_codes_day1.add(code)
print(f"高频机房唯一编号数: {len(all_high_codes_day1)}")

# 查看所有天的高频间数分布
print("\n=== 高频间数分布 ===")
high_counts = []
for day_key in sorted(data.keys(), key=lambda x: int(x)):
    day = data[day_key]
    m_rooms = day.get('morning', {}).get('rooms', [])
    e_rooms = day.get('evening', {}).get('rooms', [])
    high_m = sum(1 for r in m_rooms if r.get('类型')=='高频')
    high_e = sum(1 for r in e_rooms if r.get('类型')=='高频')
    high_counts.append(high_m + high_e)
    if int(day_key) <= 15:
        print(f"第{day_key}天: 早班高频={high_m}, 晚班高频={high_e}, 合计={high_m+high_e}")

print(f"\n高频间数范围: {min(high_counts)} - {max(high_counts)}")
