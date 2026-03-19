import socket
s = socket.socket()
s.bind(('0.0.0.0', 8000))
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
# Try to identify what's using 8000
import subprocess
r = subprocess.run(['netstat', '-aonb'], capture_output=True, text=True, errors='ignore')
for line in r.stdout.split('\n'):
    if '8000' in line:
        print(repr(line))
s.close()
