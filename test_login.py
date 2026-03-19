import urllib.request
import json

url = "http://127.0.0.1:9527/api/auth/login"

# 测试1: 邮箱登录
data = json.dumps({"phone": "admin@example.com", "password": "admin123"}).encode()
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req) as resp:
        print("邮箱登录成功:", resp.read().decode()[:100])
except Exception as e:
    print("邮箱登录失败:", e)

# 测试2: 手机号登录
data2 = json.dumps({"phone": "00000000000", "password": "admin123"}).encode()
req2 = urllib.request.Request(url, data=data2, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req2) as resp:
        print("手机号登录成功:", resp.read().decode()[:100])
except Exception as e:
    print("手机号登录失败:", e)

# 测试3: 检查原始密码
data3 = json.dumps({"phone": "admin@example.com", "password": "123456890"}).encode()
req3 = urllib.request.Request(url, data=data3, headers={"Content-Type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req3) as resp:
        print("原始密码登录成功:", resp.read().decode()[:100])
except Exception as e:
    print("原始密码登录失败:", e)
