import requests
import json

# 调用本地后端API重新生成计划
url = "http://127.0.0.1:5000/api/inspection-plans/generate"
data = {
    "year": 2026,
    "month": 3,
    "overwrite": True,
    "rule_id": None
}

try:
    response = requests.post(url, json=data, timeout=120)
    print(f"状态码: {response.status_code}")
    result = response.json()
    print(f"结果: {json.dumps(result, ensure_ascii=False, indent=2)}")
except Exception as e:
    print(f"错误: {e}")
