import json
data = json.load(open('plan_data.json', 'r', encoding='utf-8'))

total_high = 0
total_low = 0
for day_key in data.keys():
    day = data[day_key]
    for r in day.get('morning', {}).get('rooms', []) + day.get('evening', {}).get('rooms', []):
        if r.get('类型') == '高频':
            total_high += 1
        else:
            total_low += 1

print(f'高频总巡查次: {total_high}')
print(f'低频总巡查次: {total_low}')
print(f'高频机房数: 220')
print(f'高频机房月均次数: {total_high / 220:.1f}')
