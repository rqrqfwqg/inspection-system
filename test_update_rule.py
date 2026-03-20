import requests

# 更新规则配置
url = "http://127.0.0.1:5000/api/inspection-rules/1"
data = {
    "name": "标准巡查规则",
    "high_freq_days": 4,
    "low_freq_times": 2,
    "is_active": True
}

response = requests.put(url, json=data)
print(f"状态码: {response.status_code}")
print(f"结果: {response.json()}")
