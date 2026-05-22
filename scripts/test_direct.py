import requests
try:
    r = requests.get('http://106.54.20.90:9527/uploads/shift_images/', timeout=3)
    print(f'Direct backend: {r.status_code}')
except Exception as e:
    print(f'Error: {e}')
