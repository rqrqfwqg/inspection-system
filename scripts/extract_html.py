import sys
sys.stdout.reconfigure(encoding='utf-8')
import json

with open(r'C:/Users/yan/Desktop/T3GTC/02_设备清单/月度巡查计划.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取 D 常量的前两天数据
import re
match = re.search(r'const D=({.*?});', content, re.DOTALL)
if match:
    try:
        # 尝试解析 JSON，先取前一部分测试
        d_str = match.group(1)
        # 只提取前两个天的数据
        lines = d_str.split('\n')
        print("数据结构（前 2000 字符）:")
        print(d_str[:2000])
        print("\n\n统计信息:")
        print(f"总天数: {d_str.count('\"label\":')}")
    except Exception as e:
        print(f"Error: {e}")
        print(d_str[:500])
