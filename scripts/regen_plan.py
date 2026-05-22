import requests

# 先登录获取 token
login_resp = requests.post('http://127.0.0.1:9527/api/auth/login', json={'phone': '13570383740', 'password': 'admin123'})
if login_resp.status_code != 200:
    print('登录失败', login_resp.status_code, login_resp.text)
    exit()
token = login_resp.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

# 重新生成 2026年3月计划（覆盖）
gen_resp = requests.post('http://127.0.0.1:9527/api/inspection-plans/generate',
    json={'year': 2026, 'month': 3, 'overwrite': True}, headers=headers)
print('生成结果:', gen_resp.status_code)
print(gen_resp.json())
