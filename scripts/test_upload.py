"""测试头像上传功能"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

import requests
import os

BASE_URL = "http://127.0.0.1:5000/api"

# 创建一个简单的测试图片（1x1 红色像素 PNG）
def create_test_image():
    # 最小的有效PNG文件（1x1红色像素）
    import base64
    png_data = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
    )
    test_path = os.path.join(os.path.dirname(__file__), 'test_avatar.png')
    with open(test_path, 'wb') as f:
        f.write(png_data)
    return test_path

def test_avatar_upload():
    print("\n=== 测试头像上传 ===\n")
    
    # 创建测试图片
    image_path = create_test_image()
    print(f"创建测试图片: {image_path}")
    
    # 上传图片
    try:
        with open(image_path, 'rb') as f:
            files = {'file': ('test_avatar.png', f, 'image/png')}
            response = requests.post(f"{BASE_URL}/upload/avatar", files=files)
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("\n上传成功!")
            print(f"头像URL: {data['avatar_url']}")
            
            # 验证文件是否存在
            avatar_path = os.path.join(os.path.dirname(__file__), 'uploads', 'avatars', os.path.basename(data['avatar_url']))
            if os.path.exists(avatar_path):
                print(f"文件已保存: {avatar_path}")
            else:
                print(f"警告: 文件未找到: {avatar_path}")
        else:
            print(f"\n上传失败!")
            print(response.text)
            
        # 清理测试文件
        os.remove(image_path)
        
    except Exception as e:
        print(f"\n错误: {str(e)}")
        if os.path.exists(image_path):
            os.remove(image_path)

if __name__ == "__main__":
    test_avatar_upload()
