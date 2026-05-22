import requests
import json

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {
    'Authorization': f'Bearer {token}',
    'Content-Type': 'application/json'
}

# 模拟前端发送的请求（overwrite=true）
data = {'year': 2026, 'month': 4, 'overwrite': True, 'rule_id': None}
print('发送数据:', json.dumps(data))

r = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
    json=data, headers=headers)
print(f'Status: {r.status_code}')
print(f'Response: {r.text}')

# 模拟前端发送的请求（overwrite=false）
print('\n--- 测试 overwrite=false ---')
data2 = {'year': 2026, 'month': 4, 'overwrite': False, 'rule_id': None}
r2 = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
    json=data2, headers=headers)
print(f'Status: {r2.status_code}')
print(f'Response: {r2.text}')
