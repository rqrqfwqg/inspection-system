import requests
# 测试各个可能的路径
urls = [
    'http://106.54.20.90:8888/',
    'http://106.54.20.90:8888/index.html',
    'http://106.54.20.90/dist/',
    'http://106.54.20.90:9527/',
]
for url in urls:
    try:
        r = requests.get(url, timeout=5)
        print(f'{url}: {r.status_code}')
        if r.status_code == 200 and 'CETpyosI' in r.text:
            print('  -> New frontend!')
    except Exception as e:
        print(f'{url}: Error - {e}')
