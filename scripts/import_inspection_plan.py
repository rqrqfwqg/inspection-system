import pandas as pd
import json
import requests

# 读取 Excel 文件
file_path = 'E:/小萌新的尝试/交接班台账软件/交接班台账软件/月度巡查计划.xlsx'

# 读取早班和晚班明细
morning_df = pd.read_excel(file_path, sheet_name='早班明细')
evening_df = pd.read_excel(file_path, sheet_name='晚班明细')

print(f"早班记录数: {len(morning_df)}")
print(f"晚班记录数: {len(evening_df)}")

def extract_day_num(tianci):
    """从天次(如'第1天')提取数字"""
    if pd.isna(tianci):
        return None
    return int(tianci.replace('第', '').replace('天', ''))

def build_shift_data(df):
    """构建单个班次的数据结构"""
    days = {}

    for _, row in df.iterrows():
        day_num = extract_day_num(row['天次'])
        if day_num is None:
            continue

        if day_num not in days:
            days[day_num] = {
                'rooms': [],
                'grouped': {}
            }

        # 添加房间
        room = {
            '楼栋': row['楼栋'],
            '楼层': row['楼层'],
            '机房名称': row['机房名称'],
            '机房编号': row['机房编号'],
            '类型': row['类型']
        }

        days[day_num]['rooms'].append(room)

        # 楼层分组
        floor_key = f"{row['楼栋']} {row['楼层']}"
        if floor_key not in days[day_num]['grouped']:
            days[day_num]['grouped'][floor_key] = []
        days[day_num]['grouped'][floor_key].append(room)

    return days

# 构建早班和晚班数据
print("\n正在处理数据...")
morning_data = build_shift_data(morning_df)
evening_data = build_shift_data(evening_df)

# 合并早晚班数据
plan_data = {}
for day_num in range(1, 31):  # 假设30天
    m = morning_data.get(day_num, {'rooms': [], 'grouped': {}})
    e = evening_data.get(day_num, {'rooms': [], 'grouped': {}})

    # 统计高频/低频
    high = sum(1 for r in m['rooms'] if r['类型'] == '高频') + sum(1 for r in e['rooms'] if r['类型'] == '高频')
    low = sum(1 for r in m['rooms'] if r['类型'] == '低频') + sum(1 for r in e['rooms'] if r['类型'] == '低频')

    # 合并楼层
    floors = set(m['grouped'].keys()) | set(e['grouped'].keys())

    plan_data[str(day_num)] = {
        'day': day_num,
        'label': f'第{day_num}天',
        'cls': 'a' if day_num % 2 == 1 else 'b',
        'morning': m,  # 直接存储 rooms 和 grouped
        'evening': e,  # 直接存储 rooms 和 grouped
        'high': high,
        'low': low,
        'total': high + low,
        'floors': sorted(list(floors))
    }

print(f"总天数: {len(plan_data)}")

# 统计
total_high = sum(d['high'] for d in plan_data.values())
total_low = sum(d['low'] for d in plan_data.values())
total_rooms = sum(d['total'] for d in plan_data.values())
print(f"高频总数: {total_high}")
print(f"低频总数: {total_low}")
print(f"巡查总次数: {total_rooms}")

# 转换为 JSON
plan_json = json.dumps(plan_data, ensure_ascii=False)

# 保存数据到文件
with open('plan_data.json', 'w', encoding='utf-8') as f:
    f.write(plan_json)
print("\n数据已保存到 plan_data.json")

# 先查询并删除已存在的2026年3月计划
print("\n检查并删除已存在的2026年3月巡查计划...")
try:
    list_response = requests.get("http://127.0.0.1:9527/api/inspection-plans")
    if list_response.status_code == 200:
        plans = list_response.json()
        for plan in plans:
            if plan.get('year') == 2026 and plan.get('month') == 3:
                plan_id = plan.get('id')
                delete_url = f"http://127.0.0.1:9527/api/inspection-plans/{plan_id}"
                del_response = requests.delete(delete_url)
                if del_response.status_code == 200:
                    print(f"已删除旧计划 ID: {plan_id}")
                else:
                    print(f"删除失败: {del_response.text}")
except Exception as e:
    print(f"查询/删除计划失败: {e}")

# 发送到后端 API
api_url = "http://127.0.0.1:9527/api/inspection-plans"
payload = {
    "name": "月度巡查计划",
    "year": 2026,
    "month": 3,
    "data": plan_json
}

print("\n正在导入到数据库...")
try:
    response = requests.post(api_url, json=payload)
    if response.status_code == 200:
        print("OK 数据导入成功!")
        result = response.json()
        print(f"  计划ID: {result.get('id')}")
    else:
        print(f"X 导入失败: {response.status_code}")
        print(f"  错误信息: {response.text}")
except Exception as e:
    print(f"X 连接错误: {e}")
