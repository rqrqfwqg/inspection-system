import requests

login_resp = requests.post('http://106.54.20.90:8888/api/auth/login', json={'phone': '00000000000', 'password': '123456890'})
token = login_resp.json().get('access_token')
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# 测试各种月份
for month in [3, 4, 5, 6, 7]:
    r = requests.post('http://106.54.20.90:8888/api/inspection-plans/generate',
        json={'year': 2026, 'month': month, 'overwrite': False}, headers=headers)
    print(f'{month}月: {r.status_code} - {r.text[:60]}')
