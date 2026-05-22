import requests
r = requests.get('http://106.54.20.90:8888/api/shift-tasks?limit=1')
print(f'Status: {r.status_code}')
if r.status_code == 200:
    tasks = r.json()
    if tasks:
        task = tasks[0]
        print(f'Task images: {task.get("images")}')
    else:
        print('No tasks')
