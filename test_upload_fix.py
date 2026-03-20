import requests
# 测试图片访问
r = requests.get('http://106.54.20.90:8888/uploads/shift_images/')
print(f'Status: {r.status_code}')
print(f'Content: {r.text[:500]}')
