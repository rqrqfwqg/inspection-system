#!/usr/bin/env python3
"""通过API批量导入机房数据到服务器"""
import requests
import json

# 服务器配置
SERVER_URL = "http://106.54.20.90:8888"
ADMIN_PHONE = "00000000000"
ADMIN_PASSWORD = "123456890"

def login():
    """登录获取token"""
    response = requests.post(
        f"{SERVER_URL}/api/auth/login",
        json={"phone": ADMIN_PHONE, "password": ADMIN_PASSWORD}
    )
    if response.status_code == 200:
        return response.json().get("access_token")
    else:
        print(f"登录失败: {response.status_code} - {response.text}")
        return None

def import_rooms(token):
    """批量导入机房"""
    # 读取本地JSON数据，尝试多种编码
    encodings = ['utf-8-sig', 'utf-8', 'gbk', 'gb2312']
    data = None
    for enc in encodings:
        try:
            with open("rooms_data.json", "r", encoding=enc) as f:
                data = json.load(f)
            print(f"使用编码: {enc}")
            break
        except UnicodeDecodeError:
            continue
    
    if data is None:
        print("无法读取JSON文件")
        return
    
    rooms = data.get("rooms", [])
    print(f"准备导入 {len(rooms)} 条机房数据...")
    
    # 批量导入（每100条一批）
    batch_size = 100
    total_created = 0
    total_updated = 0
    
    for i in range(0, len(rooms), batch_size):
        batch = rooms[i:i+batch_size]
        print(f"导入第 {i//batch_size + 1} 批 ({len(batch)} 条)...")
        
        response = requests.post(
            f"{SERVER_URL}/api/rooms/batch",
            json={"rooms": batch},
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code == 200:
            result = response.json()
            total_created += result.get("created", 0)
            total_updated += result.get("updated", 0)
            print(f"  -> 成功: 新增 {result.get('created', 0)}, 更新 {result.get('updated', 0)}")
        else:
            print(f"  -> 失败: {response.status_code} - {response.text}")
    
    print(f"\n导入完成! 共新增 {total_created}, 更新 {total_updated}")

if __name__ == "__main__":
    token = login()
    if token:
        import_rooms(token)
    else:
        print("无法登录，请检查用户名密码")
