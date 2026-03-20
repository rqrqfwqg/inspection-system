#!/bin/bash
# 巡检系统更新脚本 - 更新后端算法和前端页面
# 使用方法: 将此脚本上传到服务器 /root/inspection-system/backend/ 目录并执行

set -e

echo "========================================="
echo "  巡检系统更新脚本"
echo "========================================="

# 1. 备份当前文件
echo ""
echo "[1/4] 备份当前文件..."
cp /root/inspection-system/backend/main.py /root/inspection-system/backend/main.py.bak.$(date +%Y%m%d%H%M%S)
echo "备份完成"

# 2. 更新后端算法
echo ""
echo "[2/4] 更新后端巡查计划生成算法..."

# 创建临时Python脚本更新main.py
python3 << 'PYTHON_SCRIPT'
import re

# 读取当前main.py
with open('/root/inspection-system/backend/main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# 新的_build_plan_data函数
new_function = '''def _build_plan_data(year: int, month: int, rule: InspectionRule, rooms: List[Room]) -> dict:
    """
    根据规则和机房列表，生成该月的巡查计划数据。
    优化：同一班次尽量集中在同一栋楼，减少跨楼栋流动

    班次分配规则：
    - 早班：只巡查高频机房
    - 晚班：巡查剩余高频机房 + 低频机房
    """
    total_days = min(28, calendar.monthrange(year, month)[1])

    high_rooms = [r for r in rooms if r.room_type == "高频" and r.is_active]
    low_rooms  = [r for r in rooms if r.room_type == "低频"  and r.is_active]

    def room_to_dict(r: Room) -> dict:
        return {
            "楼栋": r.building,
            "楼层": r.floor,
            "机房名称": r.name,
            "机房编号": r.code,
            "类型": r.room_type,
        }

    # 按楼栋分组机房
    high_by_building = {}
    for r in high_rooms:
        b = r.building or "未知"
        high_by_building.setdefault(b, []).append(room_to_dict(r))
    
    low_by_building = {}
    for r in low_rooms:
        b = r.building or "未知"
        low_by_building.setdefault(b, []).append(room_to_dict(r))

    buildings = list(set([r.building for r in high_rooms + low_rooms if r.building]))
    buildings.sort()  # 按楼栋号排序
    n_buildings = len(buildings) if buildings else 1
    if n_buildings == 0:
        n_buildings = 1
        buildings = ["A"]

    # 优化：按楼栋分配到每天，避免每天跨太多楼栋
    high_times = rule.high_freq_days
    low_times = rule.low_freq_times
    
    # 每栋楼的高频机房每月巡查次数
    high_per_building = {b: len(high_by_building.get(b, [])) for b in buildings}
    low_per_building = {b: len(low_by_building.get(b, [])) for b in buildings}

    plan_data = {}
    for day in range(1, total_days + 1):
        date_str = f"{year}-{month:02d}-{day:02d}"

        # 轮换楼栋：每天分配不同的楼栋到早班和晚班
        day_offset = day % n_buildings
        
        morning_rooms = []
        evening_rooms = []
        
        morning_buildings = []
        evening_buildings = []
        
        if n_buildings == 1:
            morning_buildings = buildings
            evening_buildings = []
        elif n_buildings == 2:
            if day % 2 == 1:
                morning_buildings = [buildings[0]]
                evening_buildings = [buildings[1]]
            else:
                morning_buildings = [buildings[1]]
                evening_buildings = [buildings[0]]
        else:
            for i in range(n_buildings):
                b = buildings[(day_offset + i) % n_buildings]
                if i < max(1, n_buildings // 2):
                    morning_buildings.append(b)
                else:
                    evening_buildings.append(b)
        
        # 早班：安排选中的楼栋
        for b in morning_buildings:
            morning_rooms.extend(high_by_building.get(b, []))
        
        # 晚班：剩余高频 + 低频
        for b in evening_buildings:
            evening_rooms.extend(high_by_building.get(b, []))
        for b in buildings:
            if b not in morning_buildings or low_times > 0:
                if (day + buildings.index(b)) % max(1, 12 // max(1, low_times)) == 0:
                    evening_rooms.extend(low_by_building.get(b, []))

        def group_by_floor(room_list):
            grouped = {}
            for r in room_list:
                key = f"{r['楼栋']} {r['楼层']}"
                grouped.setdefault(key, []).append(r)
            return grouped

        high_count = len([r for r in morning_rooms + evening_rooms if r["类型"] == "高频"])
        low_count  = len([r for r in evening_rooms if r["类型"] == "低频"])
        floors = sorted(set(
            f"{r['楼栋']} {r['楼层']}" for r in morning_rooms + evening_rooms
        ))

        plan_data[date_str] = {
            "date": date_str,
            "day": day,
            "morning": {"rooms": morning_rooms, "grouped": group_by_floor(morning_rooms)},
            "evening": {"rooms": evening_rooms, "grouped": group_by_floor(evening_rooms)},
            "high": high_count,
            "low": low_count,
            "total": high_count + low_count,
            "floors": floors,
        }

    return plan_data


'''

# 找到并替换旧函数
# 查找 def _build_plan_data 到下一个 @app.post 或 @app.get
pattern = r'def _build_plan_data\(year: int, month: int, rule: InspectionRule, rooms: List\[Room\]\) -> dict:.*?(?=\n@app\.(post|get|put|delete))'
content = re.sub(pattern, new_function.strip() + '\n\n', content, flags=re.DOTALL)

# 写回文件
with open('/root/inspection-system/backend/main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("后端算法更新完成")
PYTHON_SCRIPT

# 3. 重启后端服务
echo ""
echo "[3/4] 重启后端服务..."
cd /root/inspection-system/backend
pkill -f "uvicorn main:app" || true
sleep 2
nohup python -m uvicorn main:app --host 0.0.0.0 --port 9527 > nohup.out 2>&1 &
sleep 3

# 检查后端是否启动成功
if curl -s http://127.0.0.1:9527/api/rooms > /dev/null 2>&1; then
    echo "后端服务启动成功"
else
    echo "警告：后端服务可能未正常启动，请检查 nohup.out"
fi

# 4. 提示前端更新
echo ""
echo "[4/4] 后端更新完成！"
echo ""
echo "========================================="
echo "  前端更新说明"
echo "========================================="
echo ""
echo "前端也需要更新（优化了页面加载速度）"
echo ""
echo "在本地电脑执行以下命令："
echo "  1. cd 到项目目录"
echo "  2. npm run build"
echo "  3. 将 dist 目录内容上传到服务器 /var/www/html/"
echo ""
echo "或者直接在服务器上："
echo "  cd /root/inspection-system"
echo "  npm run build"
echo "  cp -r dist/* /var/www/html/"
echo ""
echo "========================================="
echo "  更新完成！"
echo "========================================="
