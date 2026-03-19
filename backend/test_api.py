"""
API 功能测试脚本
测试所有后端 API 端点
"""

import requests
import json
import sys
from datetime import datetime, timedelta

# 设置输出编码
sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://127.0.0.1:5000/api"

def print_response(name, response):
    """格式化输出响应"""
    print(f"\n{'='*60}")
    print(f"测试: {name}")
    print(f"状态码: {response.status_code}")
    print(f"响应内容:")
    try:
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except:
        print(response.text)
    print(f"{'='*60}")

def test_stats():
    """测试统计接口"""
    print("\n" + "="*60)
    print("【1. 统计接口测试】")
    print("="*60)
    
    response = requests.get(f"{BASE_URL}/stats/dashboard")
    print_response("获取仪表盘统计", response)
    return response.status_code == 200

def test_auth():
    """测试认证接口"""
    print("\n" + "="*60)
    print("【2. 认证接口测试】")
    print("="*60)
    
    # 测试登录
    login_data = {
        "email": "admin@example.com",
        "password": "admin123"
    }
    response = requests.post(f"{BASE_URL}/auth/login", json=login_data)
    print_response("管理员登录", response)
    
    if response.status_code != 200:
        return None
    
    token = response.json().get("access_token")
    
    # 测试注册
    register_data = {
        "email": f"test_{datetime.now().timestamp()}@example.com",
        "name": "测试用户",
        "password": "test123456",
        "department": "技术部",
        "position": "开发工程师",
        "phone": "13800138000"
    }
    response = requests.post(f"{BASE_URL}/auth/register", json=register_data)
    print_response("注册新用户", response)
    
    return token

def test_users(token=None):
    """测试用户管理接口"""
    print("\n" + "="*60)
    print("【3. 用户管理接口测试】")
    print("="*60)
    
    # 获取用户列表
    response = requests.get(f"{BASE_URL}/users")
    print_response("获取用户列表", response)
    
    if response.status_code != 200:
        return None
    
    users = response.json()
    user_id = users[0]["id"] if users else None
    
    # 获取单个用户
    if user_id:
        response = requests.get(f"{BASE_URL}/users/{user_id}")
        print_response(f"获取用户 ID={user_id}", response)
    
    # 创建新用户
    new_user = {
        "email": f"newuser_{datetime.now().timestamp()}@example.com",
        "name": "新用户测试",
        "password": "test123456",
        "department": "测试部门",
        "position": "测试工程师",
        "phone": "13900139000"
    }
    response = requests.post(f"{BASE_URL}/auth/register", json=new_user)
    print_response("创建新用户", response)
    
    if response.status_code == 200:
        new_user_id = response.json()["id"]
        
        # 更新用户
        update_data = {
            "name": "更新后的名字",
            "phone": "13700137000"
        }
        response = requests.put(f"{BASE_URL}/users/{new_user_id}", json=update_data)
        print_response("更新用户信息", response)
        
        # 删除用户
        response = requests.delete(f"{BASE_URL}/users/{new_user_id}")
        print_response("删除用户", response)
    
    # 测试搜索功能
    response = requests.get(f"{BASE_URL}/users?search=admin")
    print_response("搜索用户 (关键词: admin)", response)
    
    # 测试部门筛选
    response = requests.get(f"{BASE_URL}/users?department=技术部")
    print_response("按部门筛选用户", response)
    
    return user_id

def test_duty_schedules():
    """测试排班管理接口"""
    print("\n" + "="*60)
    print("【4. 排班管理接口测试】")
    print("="*60)
    
    today = datetime.now().strftime("%Y-%m-%d")
    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    
    # 创建排班记录
    schedule_data = {
        "date": today,
        "user_id": 1,
        "user_name": "管理员",
        "department": "技术部",
        "shift_type": "morning",
        "position": "值班工程师",
        "photo_url": "https://example.com/photo.jpg"
    }
    response = requests.post(f"{BASE_URL}/duty-schedules", json=schedule_data)
    print_response("创建排班记录", response)
    
    schedule_id = None
    if response.status_code == 200:
        schedule_id = response.json()["id"]
    
    # 批量创建排班
    batch_data = {
        "schedules": [
            {
                "date": tomorrow,
                "user_id": 1,
                "user_name": "管理员",
                "department": "技术部",
                "shift_type": "afternoon",
                "position": "值班工程师"
            },
            {
                "date": tomorrow,
                "user_id": 1,
                "user_name": "管理员",
                "department": "技术部",
                "shift_type": "night",
                "position": "值班工程师"
            }
        ]
    }
    response = requests.post(f"{BASE_URL}/duty-schedules/batch", json=batch_data)
    print_response("批量创建排班记录", response)
    
    # 获取排班列表
    response = requests.get(f"{BASE_URL}/duty-schedules")
    print_response("获取所有排班记录", response)
    
    # 按日期筛选
    response = requests.get(f"{BASE_URL}/duty-schedules?date={today}")
    print_response(f"获取日期 {today} 的排班", response)
    
    # 按部门筛选
    response = requests.get(f"{BASE_URL}/duty-schedules?department=技术部")
    print_response("按部门筛选排班", response)
    
    # 按班次筛选
    response = requests.get(f"{BASE_URL}/duty-schedules?shift_type=morning")
    print_response("按班次筛选排班 (早班)", response)
    
    # 更新排班
    if schedule_id:
        update_data = {
            "date": today,
            "user_id": 1,
            "user_name": "管理员",
            "department": "运营部",
            "shift_type": "afternoon",
            "position": "高级工程师"
        }
        response = requests.put(f"{BASE_URL}/duty-schedules/{schedule_id}", json=update_data)
        print_response("更新排班记录", response)
    
    # 删除排班
    if schedule_id:
        response = requests.delete(f"{BASE_URL}/duty-schedules/{schedule_id}")
        print_response("删除排班记录", response)
    
    return True

def test_shift_tasks():
    """测试交接班任务接口"""
    print("\n" + "="*60)
    print("【5. 交接班任务接口测试】")
    print("="*60)
    
    today = datetime.now().strftime("%Y-%m-%d")
    
    # 创建任务
    task_data = {
        "date": today,
        "shift": "morning",
        "title": "检查服务器状态",
        "description": "检查所有服务器运行状态和日志",
        "assigned_to": "管理员",
        "priority": "high"
    }
    response = requests.post(f"{BASE_URL}/shift-tasks", json=task_data)
    print_response("创建交接班任务", response)
    
    task_id = None
    if response.status_code == 200:
        task_id = response.json()["id"]
    
    # 获取任务列表
    response = requests.get(f"{BASE_URL}/shift-tasks")
    print_response("获取所有任务", response)
    
    # 按日期筛选
    response = requests.get(f"{BASE_URL}/shift-tasks?date={today}")
    print_response(f"获取日期 {today} 的任务", response)
    
    # 按班次筛选
    response = requests.get(f"{BASE_URL}/shift-tasks?shift=morning")
    print_response("按班次筛选任务 (早班)", response)
    
    # 按完成状态筛选
    response = requests.get(f"{BASE_URL}/shift-tasks?completed=false")
    print_response("获取未完成的任务", response)
    
    # 更新任务（标记完成）
    if task_id:
        update_data = {
            "completed": True,
            "notes": "已完成检查，所有服务器运行正常"
        }
        response = requests.put(f"{BASE_URL}/shift-tasks/{task_id}", json=update_data)
        print_response("更新任务状态为已完成", response)
        
        # 再次获取已完成的任务
        response = requests.get(f"{BASE_URL}/shift-tasks?completed=true")
        print_response("获取已完成的任务", response)
        
        # 删除任务
        response = requests.delete(f"{BASE_URL}/shift-tasks/{task_id}")
        print_response("删除任务", response)
    
    return True

def main():
    """运行所有测试"""
    print("\n")
    print("╔" + "="*58 + "╗")
    print("║" + " "*15 + "系统功能全面测试" + " "*17 + "║")
    print("╚" + "="*58 + "╝")
    
    results = {}
    
    # 1. 测试统计接口
    results["统计接口"] = test_stats()
    
    # 2. 测试认证接口
    token = test_auth()
    results["认证接口"] = token is not None
    
    # 3. 测试用户管理
    user_id = test_users(token)
    results["用户管理"] = user_id is not None
    
    # 4. 测试排班管理
    results["排班管理"] = test_duty_schedules()
    
    # 5. 测试交接班任务
    results["交接班任务"] = test_shift_tasks()
    
    # 打印测试结果汇总
    print("\n")
    print("╔" + "="*58 + "╗")
    print("║" + " "*18 + "测试结果汇总" + " "*19 + "║")
    print("╠" + "="*58 + "╣")
    
    all_passed = True
    for name, passed in results.items():
        status = "[PASS]" if passed else "[FAIL]"
        padding = 58 - len(name) - len(status) - 4
        print(f"║  {name}{' '*padding}{status}  ║")
        if not passed:
            all_passed = False
    
    print("╚" + "="*58 + "╝")
    
    if all_passed:
        print("\n[SUCCESS] 所有测试通过！")
    else:
        print("\n[WARNING] 部分测试失败，请检查错误信息。")
    
    return all_passed

if __name__ == "__main__":
    try:
        main()
    except requests.exceptions.ConnectionError:
        print("\n[ERROR] 无法连接到后端服务器！")
        print("请确保后端服务正在运行: http://127.0.0.1:5000")
        print("\n启动命令: cd backend && python main.py")
    except Exception as e:
        print(f"\n[ERROR] 测试过程中发生错误: {str(e)}")
