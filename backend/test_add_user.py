"""测试添加用户功能"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import requests
import json
from datetime import datetime

BASE_URL = "http://127.0.0.1:5000/api"

def test_add_user():
    # 测试数据
    user_data = {
        "email": f"newuser_{datetime.now().timestamp()}@test.com",
        "name": "测试新用户",
        "password": "test123456",
        "department": "运营部",
        "position": "运营专员",
        "phone": "13888888888"
    }
    
    print("\n=== 测试添加用户 ===\n")
    print(f"发送数据:")
    print(json.dumps(user_data, indent=2, ensure_ascii=False))
    
    try:
        response = requests.post(
            f"{BASE_URL}/auth/register",
            json=user_data,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"\n状态码: {response.status_code}")
        
        if response.status_code == 200:
            print("\n创建成功!")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
        else:
            print(f"\n创建失败!")
            print(response.text)
            
    except Exception as e:
        print(f"\n错误: {str(e)}")

if __name__ == "__main__":
    test_add_user()
