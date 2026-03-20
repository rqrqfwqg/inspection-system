# 测试算法逻辑
high_cycle = 4  # 高频每4天一轮
low_times = 2   # 低频每月2次
total_days = 28

print("算法测试:")
for day in range(1, 29):
    high = (day - 1) % high_cycle == 0
    low_cycle = total_days // low_times
    low = low_times > 0 and (day - 1) % low_cycle == 0
    if high or low:
        print(f"{day}号: 高频={high}, 低频={low}")
