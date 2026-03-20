import requests
r = requests.get('http://106.54.20.90:8888/api/inspection-plans/by-year-month', params={'year': 2026, 'month': 4})
print(f'Status: {r.status_code}')
print(f'Response: {r.text[:500]}')
