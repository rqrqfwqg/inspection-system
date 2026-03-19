import sys
sys.path.insert(0, 'backend')
import requests

# 测试 API
base_url = "http://127.0.0.1:9527"

# 1. 先登录
login_resp = requests.post(f"{base_url}/api/auth/login", json={"phone": "13570383740", "password": "admin123"})
if login_resp.status_code != 200:
    print("登录失败:", login_resp.status_code, login_resp.text)
    exit()

token = login_resp.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. 查看当前生效规则
rule_resp = requests.get(f"{base_url}/api/inspection-rules/active", headers=headers)
print("当前规则:", rule_resp.json())

# 3. 生成计划
gen_resp = requests.post(f"{base_url}/api/inspection-plans/generate",
    json={"year": 2026, "month": 3, "overwrite": True}, headers=headers)
print("生成结果:", gen_resp.status_code, gen_resp.json())
