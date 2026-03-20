import requests
# 测试后端静态文件服务
urls = [
    'http://106.54.20.90:9527/uploads/',
    'http://106.54.20.90:9527/uploads/shift_images/',
]
for url in urls:
    try:
        r = requests.get(url, timeout=5)
        print(f'{url}: {r.status_code}')
    except Exception as e:
        print(f'{url}: Error - {e}')
