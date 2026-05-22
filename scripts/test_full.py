import requests
# 检查各种路径
tests = [
    ('/uploads/', 200),
    ('/uploads/shift_images/', 200),
    ('/api/', 200),
]
for path, expected in tests:
    r = requests.get(f'http://106.54.20.90:8888{path}')
    print(f'{path}: {r.status_code} - {r.text[:100]}')
