"""仅执行导入：将 plan_data.json 导入到数据库"""
import json
import requests

with open('plan_data.json', 'r', encoding='utf-8') as f:
    new_data = json.load(f)

plan_json = json.dumps(new_data, ensure_ascii=False)

# 获取管理员 token
print("获取管理员 token...")
login_resp = requests.post(
    "http://127.0.0.1:9527/api/auth/login",
    json={"phone": "13570383740", "password": "admin123"}
)
if login_resp.status_code != 200:
    login_resp = requests.post(
        "http://127.0.0.1:9527/api/auth/login",
        json={"phone": "13570383740", "password": "admin"}
    )

token = None
if login_resp.status_code == 200:
    token = login_resp.json().get('access_token')
    print("Token OK")
else:
    print(f"Login failed: {login_resp.status_code} {login_resp.text}")

if not token:
    exit(1)

headers = {"Authorization": f"Bearer {token}"}

# 删除旧计划
print("删除旧计划...")
list_resp = requests.get("http://127.0.0.1:9527/api/inspection-plans", headers=headers)
if list_resp.status_code == 200:
    plans = list_resp.json()
    for plan in plans:
        if plan.get('year') == 2026 and plan.get('month') == 3:
            pid = plan.get('id')
            del_resp = requests.delete(f"http://127.0.0.1:9527/api/inspection-plans/{pid}", headers=headers)
            print(f"Deleted plan ID={pid}: {del_resp.status_code}")
else:
    print(f"List failed: {list_resp.status_code}")

# 导入新计划
print("导入新计划...")
payload = {
    "name": "2026年3月巡查计划",
    "year": 2026,
    "month": 3,
    "data": plan_json
}
create_resp = requests.post("http://127.0.0.1:9527/api/inspection-plans", json=payload, headers=headers)
if create_resp.status_code == 200:
    result = create_resp.json()
    print(f"[OK] Import success! Plan ID: {result.get('id')}")
    # 统计验证
    total_low = sum(d.get('low', 0) for d in new_data.values())
    total_high = sum(d.get('high', 0) for d in new_data.values())
    print(f"Low freq total: {total_low}")
    print(f"High freq total: {total_high}")
else:
    print(f"[FAIL] {create_resp.status_code} {create_resp.text}")
