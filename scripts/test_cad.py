"""
CAD 功能测试脚本
生成测试 DXF 文件并验证解析功能
"""

import ezdxf
from pathlib import Path
from cad_service import CADService


def create_test_dxf(output_path: str):
    """创建一个测试用的 DXF 文件"""
    # 创建新的 DXF 文档
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    
    # 添加图层
    doc.layers.add("建筑轮廓", color=1)
    doc.layers.add("标注", color=2)
    doc.layers.add("文字", color=3)
    
    # 添加一些实体
    # 1. 矩形（建筑轮廓）
    msp.add_lwpolyline(
        [(0, 0), (100, 0), (100, 80), (0, 80), (0, 0)],
        close=True,
        dxfattribs={'layer': '建筑轮廓'}
    )
    
    # 2. 内部线条
    msp.add_line((0, 40), (100, 40), dxfattribs={'layer': '建筑轮廓'})
    msp.add_line((50, 0), (50, 80), dxfattribs={'layer': '建筑轮廓'})
    
    # 3. 文字标注
    msp.add_text(
        "机房A",
        dxfattribs={
            'layer': '文字',
            'height': 5,
            'insert': (25, 60)
        }
    )
    msp.add_text(
        "机房B",
        dxfattribs={
            'layer': '文字',
            'height': 5,
            'insert': (75, 60)
        }
    )
    msp.add_text(
        "机房C",
        dxfattribs={
            'layer': '文字',
            'height': 5,
            'insert': (25, 20)
        }
    )
    msp.add_text(
        "机房D",
        dxfattribs={
            'layer': '文字',
            'height': 5,
            'insert': (75, 20)
        }
    )
    
    # 4. 尺寸标注
    msp.add_text(
        "100m",
        dxfattribs={
            'layer': '标注',
            'height': 3,
            'insert': (50, -10)
        }
    )
    msp.add_text(
        "80m",
        dxfattribs={
            'layer': '标注',
            'height': 3,
            'insert': (-15, 40),
            'rotation': 90
        }
    )
    
    # 保存文件
    doc.saveas(output_path)
    print(f"[OK] 测试文件已创建: {output_path}")


def test_cad_service(file_path: str):
    """测试 CAD 解析服务"""
    print("\n" + "="*50)
    print("开始测试 CAD 解析功能")
    print("="*50)
    
    service = CADService()
    
    # 1. 解析文件
    print("\n[1] 解析文件...")
    result = service.parse_file(file_path)
    print(f"   文件名: {result.filename}")
    print(f"   DXF 版本: {result.version}")
    print(f"   总实体数: {result.total_entities}")
    
    # 2. 显示实体类型统计
    print("\n[2] 实体类型统计:")
    for entity_type, count in result.entity_types.items():
        print(f"   - {entity_type}: {count} 个")
    
    # 3. 显示图层信息
    print("\n[3] 图层信息:")
    for layer in result.layers:
        print(f"   - {layer.name}: {layer.entity_count} 个实体 (颜色: {layer.color})")
    
    # 4. 显示边界框
    print("\n[4] 边界框:")
    bb = result.bounding_box
    print(f"   宽度: {bb['width']:.2f}")
    print(f"   高度: {bb['height']:.2f}")
    print(f"   范围: ({bb['min_x']:.2f}, {bb['min_y']:.2f}) - ({bb['max_x']:.2f}, {bb['max_y']:.2f})")
    
    # 5. 提取文字
    print("\n[5] 提取的文字内容:")
    texts = service.extract_text_entities(file_path)
    for text in texts:
        print(f"   - {text['text']} (图层: {text['layer']})")
    
    # 6. 导出 JSON
    print("\n[6] 导出为 JSON...")
    json_str = service.export_to_json(file_path)
    print(f"   JSON 大小: {len(json_str)} 字符")
    
    print("\n" + "="*50)
    print("[OK] 所有测试通过！")
    print("="*50)


if __name__ == "__main__":
    # 创建测试目录
    test_dir = Path("test_cad_files")
    test_dir.mkdir(exist_ok=True)
    
    # 创建测试文件
    test_file = test_dir / "test_building.dxf"
    create_test_dxf(str(test_file))
    
    # 测试解析功能
    test_cad_service(str(test_file))
    
    print("\n[提示] 您可以在浏览器中访问以下 API 端点:")
    print("   POST /api/cad/upload     - 上传 CAD 文件")
    print("   GET  /api/cad/parse/{id} - 解析 CAD 文件")
    print("   GET  /api/cad/text/{id}  - 提取文字")
    print("   GET  /api/cad/analyze    - 快速分析（上传+解析）")
