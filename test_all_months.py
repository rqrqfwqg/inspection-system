import requests

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {'Authorization': f'Bearer {token}'}

# 检查所有已存在的计划
plans_resp = requests.get('http://106.54.20.90:8888/api/inspection-plans', headers=headers)
plans = plans_resp.json()
print('已存在的计划:')
for p in plans:
    print(f'  {p["year"]}年{p["month"]}月')

# 测试6月（不存在的月份）
print('\n测试生成6月计划:')
gen_resp = requests.post(
    'http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 6, 'overwrite': False},
    headers=headers
)
print(f'Status: {gen_resp.status_code}')
print(f'Response: {gen_resp.text}')
