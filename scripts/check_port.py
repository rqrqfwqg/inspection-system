import socket
for port in [5000, 8000, 8001, 8080, 9000, 9527, 7777, 6789, 3001, 3333]:
    s = socket.socket()
    try:
        s.bind(('0.0.0.0', port))
        s.close()
        print(f"{port} FREE")
    except OSError:
        print(f"{port} BUSY")
