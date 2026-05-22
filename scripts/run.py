"""后端启动脚本，自动选择可用端口"""
import uvicorn
import socket

def find_free_port(preferred=5000, fallback=5001):
    for port in [preferred, fallback, 5002, 5003, 8000, 8080]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return 8888

if __name__ == "__main__":
    port = find_free_port()
    print(f"\n[OK] Backend running at http://127.0.0.1:{port}")
    if port != 5000:
        print(f"[WARN] Port 5000 busy, using {port}")
        print(f"   Update src/services/api.ts line 1: const API_BASE_URL = 'http://127.0.0.1:{port}/api'")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
