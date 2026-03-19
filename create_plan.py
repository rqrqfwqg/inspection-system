import json

# 读取提取的数据（用 gbk）
with open('plan_clean.json', 'r', encoding='gbk') as f:
    content = f.read()
    plan_data = json.loads(content)

# 发送到后端 API
import requests
response = requests.post(
    'http://127.0.0.1:9527/api/inspection-plans',
    json=plan_data,
    headers={'Content-Type': 'application/json'}
)

print(f"Status: {response.status_code}")
if response.status_code == 200:
    print("巡查计划创建成功！")
else:
    print(f"Error: {response.text}")
