import base64

# 编码JS文件
with open('dist/assets/index-C-x4TXu_.js', 'rb') as f:
    js_data = base64.b64encode(f.read()).decode()
    open('js_b64.txt', 'w').write(js_data)
    print(f"JS文件编码完成，长度: {len(js_data)}")

# 编码CSS文件
with open('dist/assets/index--JuBlyct.css', 'rb') as f:
    css_data = base64.b64encode(f.read()).decode()
    open('css_b64.txt', 'w').write(css_data)
    print(f"CSS文件编码完成，长度: {len(css_data)}")
