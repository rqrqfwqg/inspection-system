import requests
import json

# 先查询现有的巡查计划
list_url = "http://127.0.0.1:9527/api/inspection-plans"
try:
    response = requests.get(list_url)
    if response.status_code == 200:
        plans = response.json()
        print(f"找到 {len(plans)} 个巡查计划")
        
        # 删除2026年3月的计划
        for plan in plans:
            if plan.get('year') == 2026 and plan.get('month') == 3:
                plan_id = plan.get('id')
                delete_url = f"http://127.0.0.1:9527/api/inspection-plans/{plan_id}"
                del_response = requests.delete(delete_url)
                if del_response.status_code == 200:
                    print(f"已删除计划: {plan.get('name')} (ID: {plan_id})")
                else:
                    print(f"删除失败: {del_response.text}")
except Exception as e:
    print(f"查询计划失败: {e}")

# 读取之前保存的数据
with open('plan_data.json', 'r', encoding='utf-8') as f:
    plan_json = f.read()

# 重新导入
api_url = "http://127.0.0.1:9527/api/inspection-plans"
payload = {
    "name": "月度巡查计划",
    "year": 2026,
    "month": 3,
    "data": plan_json
}

print("\n正在重新导入...")
try:
    response = requests.post(api_url, json=payload)
    if response.status_code == 200:
        print("OK 数据导入成功!")
        result = response.json()
        print(f"  计划ID: {result.get('id')}")
    else:
        print(f"X 导入失败: {response.status_code}")
        print(f"  错误信息: {response.text}")
except Exception as e:
    print(f"X 连接错误: {e}")
