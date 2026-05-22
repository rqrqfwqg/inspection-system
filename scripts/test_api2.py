import requests

# 登录获取token
login_resp = requests.post(
    "http://106.54.20.90:8888/api/auth/login",
    json={"phone": "00000000000", "password": "123456890"}
)
token = login_resp.json().get("access_token")
headers = {"Authorization": f"Bearer {token}"}

# 检查现有计划
plans_resp = requests.get("http://106.54.20.90:8888/api/inspection-plans", headers=headers)
print("现有计划:", plans_resp.status_code, plans_resp.text[:500])

# 尝试不带 overwrite 生成计划（模拟前端行为）
generate_resp = requests.post(
    "http://106.54.20.90:8888/api/inspection-plans/generate",
    json={"year": 2026, "month": 3, "overwrite": False},
    headers=headers
)
print("生成计划(overwrite=false):", generate_resp.status_code, generate_resp.text)
