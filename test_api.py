import requests

# 登录获取token
login_resp = requests.post(
    "http://106.54.20.90:8888/api/auth/login",
    json={"phone": "00000000000", "password": "123456890"}
)
print("登录:", login_resp.status_code, login_resp.text)
if login_resp.status_code != 200:
    exit(1)

token = login_resp.json().get("token") or login_resp.json().get("access_token")
print("Token:", token[:20] + "..." if token else "None")

# 尝试生成计划
headers = {"Authorization": f"Bearer {token}"}
generate_resp = requests.post(
    "http://106.54.20.90:8888/api/inspection-plans/generate",
    json={"year": 2026, "month": 3, "overwrite": True},
    headers=headers
)
print("生成计划:", generate_resp.status_code, generate_resp.text)
