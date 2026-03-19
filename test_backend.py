import subprocess
import time
import requests
import sys
import os

# 启动后端
print("启动后端...")
proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "9527"],
    cwd=os.path.join(os.path.dirname(__file__), "backend"),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

# 等待启动
time.sleep(5)

try:
    # 测试API
    resp = requests.get("http://127.0.0.1:9527/api/inspection-rules/active", timeout=5)
    print(f"API响应: {resp.status_code}")
    print(resp.text)
except Exception as e:
    print(f"测试失败: {e}")
finally:
    proc.terminate()
    proc.wait()
