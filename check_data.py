import requests
import json

# 获取当前巡查计划
response = requests.get("http://127.0.0.1:9527/api/inspection-plans/current")
if response.status_code == 200:
    data = response.json()
    print("API Response:")
    print(data)

    # 如果 data 已经是 dict
    if isinstance(data.get('data'), dict):
        plan_data = data.get('data')
    else:
        plan_data = json.loads(data.get('data', '{}'))

    print("\n数据概览:")
    print(f"  name: {data.get('name')}")
    print(f"  year: {data.get('year')}")
    print(f"  month: {data.get('month')}")
    print(f"\n总天数: {len(plan_data)}")

    # 检查第一天的数据结构
    if '1' in plan_data:
        day1 = plan_data['1']
        print(f"\n第1天数据结构:")
        print(f"  day: {day1.get('day')}")
        print(f"  label: {day1.get('label')}")
        print(f"  cls: {day1.get('cls')}")
        print(f"  high: {day1.get('high')}")
        print(f"  low: {day1.get('low')}")
        print(f"  total: {day1.get('total')}")

        print(f"\n  morning: {day1.get('morning')}")
        print(f"  evening: {day1.get('evening')}")
else:
    print(f"Error: {response.status_code}")
    print(response.text)
