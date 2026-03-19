import sys
import json

# 读取原始 HTML 中的数据
html_path = r'C:/Users/yan/Desktop/T3GTC/02_设备清单/月度巡查计划.html'

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 D 对象
import re
match = re.search(r'const D=({.*?});', content, re.DOTALL)
if not match:
    print("未找到数据对象")
    sys.exit(1)

# 直接输出原始 JSON 字符串
raw_json = match.group(1)

# 构造计划数据
output = {
    "name": "2026年3月巡查计划",
    "year": 2026,
    "month": 3,
    "data": raw_json
}

# 输出
print(json.dumps(output, ensure_ascii=False, indent=2))
