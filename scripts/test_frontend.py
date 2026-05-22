import requests
r = requests.get('http://106.54.20.90:8888/')
print('Status:', r.status_code)
if 'CETpyosI' in r.text:
    print('New frontend loaded!')
else:
    print('Old frontend version')
