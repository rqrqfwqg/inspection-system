import requests

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {'Authorization': f'Bearer {token}'}

# 获取所有计划
plans_resp = requests.get('http://106.54.20.90:8888/api/inspection-plans?limit=100', headers=headers)
plans = plans_resp.json()
print('所有计划:')
for p in plans:
    print(f'  id={p["id"]}, {p["year"]}年{p["month"]}月, name={p["name"]}')

# 手动用 overwrite=true 重新生成4月计划
gen_resp = requests.post(
    'http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 4, 'overwrite': True},
    headers=headers
)
print(f'\n重新生成4月计划: {gen_resp.status_code}')
print(gen_resp.text)
