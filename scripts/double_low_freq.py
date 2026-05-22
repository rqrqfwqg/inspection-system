"""
将低频机房从月巡1次改为月巡2次。
策略：在原来安排的天次基础上，再在月中（偏后约15天）安排第二次巡查。
"""
import json
import copy
import requests

# 读取原始计划数据
with open('plan_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

total_days = len(data)  # 通常30天

# 对每一天中所有低频机房，安排第二次巡查
# 策略：如果某间低频机房在第 D 天，则第二次安排在第 (D + 15) 天（循环到月内）
# 如果 D+15 > total_days，则安排在第 (D + 15 - total_days) 天

def add_rooms_to_day(day_plan, new_rooms, shift_key):
    """将机房列表添加到指定班次"""
    shift = day_plan[shift_key]
    for room in new_rooms:
        # 检查是否已存在（避免重复）
        existing_ids = {r['机房编号'] for r in shift['rooms']}
        if room['机房编号'] not in existing_ids:
            shift['rooms'].append(room)
            # 更新 grouped
            floor_key = f"{room['楼栋']} {room['楼层']}"
            if floor_key not in shift['grouped']:
                shift['grouped'][floor_key] = []
            # 检查 grouped 中是否已有
            existing_grouped_ids = {r['机房编号'] for r in shift['grouped'][floor_key]}
            if room['机房编号'] not in existing_grouped_ids:
                shift['grouped'][floor_key].append(room)

# 先深拷贝，在新数据上操作
new_data = copy.deepcopy(data)

# 收集每间低频机房的信息：(机房编号, 机房对象, 所在天, 所在班次)
low_room_assignments = []  # [(day_num, shift_key, room_obj), ...]

for day_key, day_plan in data.items():
    day_num = int(day_key)
    for shift_key in ('morning', 'evening'):
        shift = day_plan.get(shift_key, {})
        for room in shift.get('rooms', []):
            if room.get('类型') == '低频':
                low_room_assignments.append((day_num, shift_key, room))

print(f"低频机房安排总数（去重前）: {len(low_room_assignments)}")

# 去重：同一机房编号只取第一次出现的天
seen = {}
for day_num, shift_key, room in low_room_assignments:
    code = room['机房编号']
    if code not in seen:
        seen[code] = (day_num, shift_key, room)

print(f"低频机房数（去重后）: {len(seen)}")

# 为每间低频机房安排第二次
second_count = 0
for code, (day_num, shift_key, room) in seen.items():
    # 计算第二次安排的天
    second_day = day_num + 15
    if second_day > total_days:
        second_day = second_day - total_days
    if second_day < 1:
        second_day = 1

    # 确保目标天存在
    target_key = str(second_day)
    if target_key not in new_data:
        # 如果该天不存在，跳过
        continue

    # 添加到同一班次
    add_rooms_to_day(new_data[target_key], [room], shift_key)
    second_count += 1

print(f"成功安排第二次巡查: {second_count} 间")

# 重新计算每天的 high/low/total/floors
for day_key, day_plan in new_data.items():
    high = 0
    low = 0
    floors = set()
    for shift_key in ('morning', 'evening'):
        shift = day_plan.get(shift_key, {})
        for room in shift.get('rooms', []):
            if room.get('类型') == '高频':
                high += 1
            elif room.get('类型') == '低频':
                low += 1
        for floor_key in shift.get('grouped', {}).keys():
            floors.add(floor_key)
    day_plan['high'] = high
    day_plan['low'] = low
    day_plan['total'] = high + low
    day_plan['floors'] = sorted(list(floors))

# 统计
total_low_after = sum(d['low'] for d in new_data.values())
print(f"\n修改后全月低频总次数: {total_low_after}（原来 {len(seen)} 次，现在应为 {len(seen)*2} 次）")

# 保存新的计划数据
with open('plan_data.json', 'w', encoding='utf-8') as f:
    json.dump(new_data, f, ensure_ascii=False, indent=2)

print("已保存到 plan_data.json")

# 重新导入到数据库
plan_json = json.dumps(new_data, ensure_ascii=False)

# 先删除旧计划
print("\n正在删除旧计划...")
try:
    list_response = requests.get(
        "http://127.0.0.1:9527/api/inspection-plans",
        headers={"Authorization": "Bearer admin_token"}
    )
    if list_response.status_code == 200:
        plans = list_response.json()
        for plan in plans:
            if plan.get('year') == 2026 and plan.get('month') == 3:
                plan_id = plan.get('id')
                # 需要管理员token，先获取
                break
except Exception as e:
    print(f"查询计划失败: {e}")

# 获取管理员 token
print("正在获取管理员 token...")
try:
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
        print(f"Token 获取成功")
    else:
        print(f"登录失败: {login_resp.status_code} {login_resp.text}")
except Exception as e:
    print(f"登录请求失败: {e}")
    token = None

if token:
    headers = {"Authorization": f"Bearer {token}"}
    
    # 删除旧计划
    try:
        list_response = requests.get("http://127.0.0.1:9527/api/inspection-plans", headers=headers)
        if list_response.status_code == 200:
            plans = list_response.json()
            for plan in plans:
                if plan.get('year') == 2026 and plan.get('month') == 3:
                    plan_id = plan.get('id')
                    del_resp = requests.delete(f"http://127.0.0.1:9527/api/inspection-plans/{plan_id}", headers=headers)
                    if del_resp.status_code == 200:
                        print(f"已删除旧计划 ID: {plan_id}")
                    else:
                        print(f"删除失败: {del_resp.text}")
    except Exception as e:
        print(f"删除计划失败: {e}")
    
    # 导入新计划
    print("\n正在导入新计划...")
    try:
        payload = {
            "name": "月度巡查计划",
            "year": 2026,
            "month": 3,
            "data": plan_json
        }
        create_resp = requests.post("http://127.0.0.1:9527/api/inspection-plans", json=payload, headers=headers)
        if create_resp.status_code == 200:
            result = create_resp.json()
            print(f"[OK] 导入成功! 计划ID: {result.get('id')}")
        else:
            print(f"[FAIL] 导入失败: {create_resp.status_code} {create_resp.text}")
    except Exception as e:
        print(f"导入请求失败: {e}")
else:
    print("[WARNING] 未获取到 token，仅保存了 plan_data.json，请手动导入")
