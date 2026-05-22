import pandas as pd

# 读取 Excel 文件
file_path = 'E:/小萌新的尝试/交接班台账软件/交接班台账软件/月度巡查计划.xlsx'

# 读取所有 sheet
all_sheets = pd.read_excel(file_path, sheet_name=None)

print("=" * 80)
print("Excel 文件分析")
print("=" * 80)
print(f"\n总共有 {len(all_sheets)} 个工作表:")
for sheet_name in all_sheets.keys():
    print(f"  - {sheet_name}")

for sheet_name, df in all_sheets.items():
    print(f"\n{'=' * 80}")
    print(f"工作表: {sheet_name}")
    print(f"{'=' * 80}")
    print(f"形状: {df.shape} (行数: {df.shape[0]}, 列数: {df.shape[1]})")
    print(f"\n列名: {df.columns.tolist()}")
    print(f"\n前 20 行数据:")
    try:
        print(df.head(20).to_string())
    except UnicodeEncodeError:
        # 处理编码问题
        print(df.head(20))
    print(f"\n数据类型:")
    print(df.dtypes.to_string())
