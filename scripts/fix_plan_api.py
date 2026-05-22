#!/usr/bin/env python3
"""
修复脚本：在后端添加按年月查询巡检计划的API
"""

import os
import re

# 读取 main.py
main_py_path = "/root/inspection-system/backend/main.py"

# 检查文件是否存在
if not os.path.exists(main_py_path):
    print(f"文件不存在: {main_py_path}")
    print("请确认 main.py 的正确路径")
    exit(1)

with open(main_py_path, "r", encoding="utf-8") as f:
    content = f.read()

# 检查是否已经存在新API
if "by-year-month" in content:
    print("API 已经存在，无需修复")
    exit(0)

# 新增的API函数
new_api = '''

@app.get("/api/inspection-plans/by-year-month", response_model=dict)
def get_inspection_plan_by_year_month(
    year: int,
    month: int,
    db: Session = Depends(get_db)
):
    """根据年份和月份获取巡查计划"""
    plan = db.query(InspectionPlan).filter(
        InspectionPlan.year == year,
        InspectionPlan.month == month
    ).order_by(InspectionPlan.created_at.desc()).first()

    if not plan:
        return {}

    return {
        "id": plan.id,
        "name": plan.name,
        "year": plan.year,
        "month": plan.month,
        "data": json.loads(plan.data) if plan.data else {}
    }

'''

# 找到 get_current_inspection_plan 函数结束位置，在其后插入新API
# 查找 "return {" 后面跟着 "id": plan.id, "name": plan.name, ... 的模式
pattern = r'(@app\.get\("/api/inspection-plans/current", response_model=dict\).*?return \{\s*"id": plan\.id,\s*"name": plan\.name,\s*"year": plan\.year,\s*"month": plan\.month,\s*"data": json\.loads\(plan\.data\) if plan\.data else \{\}\s*\})'

match = re.search(pattern, content, re.DOTALL)

if match:
    # 在函数结束后插入新API
    insert_pos = match.end()
    content = content[:insert_pos] + new_api + content[insert_pos:]

    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write(content)

    print("成功添加新API: /api/inspection-plans/by-year-month")
    print("请重启后端服务: pkill -f 'python.*main.py'; cd /root/inspection-system && nohup python3 main.py > server.log 2>&1 &")
else:
    print("未找到插入位置，请手动检查")
    exit(1)
