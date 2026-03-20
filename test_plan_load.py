import requests

# 测试页面加载时调用的 API 序列
base = 'http://106.54.20.90:8888'

# 1. 获取所有计划
r1 = requests.get(f'{base}/api/inspection-plans?limit=100')
plans = r1.json()
print('已有计划:', [(p['year'], p['month']) for p in plans])

# 2. 获取4月计划数据
r2 = requests.get(f'{base}/api/inspection-plans/by-year-month?year=2026&month=4')
if r2.status_code == 200 and r2.json():
    data = r2.json()
    print(f'\n4月计划数据: id={data.get("id")}, 数据天数={len(data.get("data", {}))}')
    # 显示第一天数据
    day1 = list(data.get('data', {}).keys())[0] if data.get('data') else None
    if day1:
        print(f'第一天({day1})有数据')
else:
    print('4月计划数据获取失败')
