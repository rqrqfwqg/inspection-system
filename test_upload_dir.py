import requests
# 测试上传目录
urls = [
    'http://106.54.20.90:8888/uploads/',
    'http://106.54.20.90:8888/uploads/shift_images/',
]
for url in urls:
    try:
        r = requests.get(url, timeout=5)
        print(f'{url}: {r.status_code}')
        if r.status_code == 200:
            print(f'  Content: {r.text[:200]}')
    except Exception as e:
        print(f'{url}: Error - {e}')
