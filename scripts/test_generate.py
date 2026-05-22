import requests

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {'Authorization': f'Bearer {token}'}

# 测试生成5月计划
gen_resp = requests.post(
    'http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 5, 'overwrite': False},
    headers=headers
)
print(f'Status: {gen_resp.status_code}')
print(f'Response: {gen_resp.text}')
