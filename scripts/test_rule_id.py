import requests

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {'Authorization': f'Bearer {token}'}

# 测试不带 rule_id
print('测试1: 不带 rule_id')
r1 = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 7, 'overwrite': False}, headers=headers)
print(f'Status: {r1.status_code}, Response: {r1.text}')

# 测试带 rule_id: null
print('\n测试2: rule_id = null')
r2 = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 8, 'overwrite': False, 'rule_id': None}, headers=headers)
print(f'Status: {r2.status_code}, Response: {r2.text}')

# 测试带 rule_id: 1
print('\n测试3: rule_id = 1')
r3 = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
    json={'year': 2026, 'month': 9, 'overwrite': False, 'rule_id': 1}, headers=headers)
print(f'Status: {r3.status_code}, Response: {r3.text}')
