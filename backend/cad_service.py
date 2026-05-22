"""
CAD 文件解析服务
支持 DXF 文件读取，可提取图层、实体、坐标、尺寸等信息
"""

import ezdxf
from ezdxf import bbox
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import json
import os
import tempfile
from pathlib import Path


@dataclass
class CADEntity:
    """CAD 实体信息"""
    entity_type: str          # 实体类型：LINE, CIRCLE, TEXT, DIMENSION 等
    layer: str               # 所在图层
    handle: str              # 实体句柄
    coordinates: List[float] # 坐标数据
    text: Optional[str] = None  # 文字内容（如果是文字实体）
    radius: Optional[float] = None  # 半径（如果是圆/弧）
    color: Optional[int] = None     # 颜色代码


@dataclass
class CADLayer:
    """CAD 图层信息"""
    name: str
    color: int
    linetype: str
    is_visible: bool
    entity_count: int


@dataclass
class CADAnalysisResult:
    """CAD 文件分析结果"""
    filename: str
    version: str
    layers: List[CADLayer]
    entities: List[CADEntity]
    bounding_box: Dict[str, float]  # 边界框
    total_entities: int
    entity_types: Dict[str, int]    # 各类型实体数量统计


class CADService:
    """CAD 文件解析服务"""
    
    def __init__(self):
        self.supported_formats = ['.dxf']
    
    def parse_file(self, file_path: str) -> CADAnalysisResult:
        """
        解析 CAD 文件
        
        Args:
            file_path: CAD 文件路径
            
        Returns:
            CADAnalysisResult: 解析结果
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")
        
        if file_path.suffix.lower() not in self.supported_formats:
            raise ValueError(f"不支持的文件格式: {file_path.suffix}，目前仅支持: {self.supported_formats}")
        
        # 读取 DXF 文件
        doc = ezdxf.readfile(str(file_path))
        msp = doc.modelspace()
        
        # 分析图层
        layers = self._analyze_layers(doc, msp)
        
        # 分析实体
        entities = self._analyze_entities(msp)
        
        # 计算边界框
        bounding_box = self._calculate_bounding_box(msp)
        
        # 统计实体类型
        entity_types = {}
        for entity in entities:
            entity_types[entity.entity_type] = entity_types.get(entity.entity_type, 0) + 1
        
        return CADAnalysisResult(
            filename=file_path.name,
            version=doc.dxfversion,
            layers=layers,
            entities=entities,
            bounding_box=bounding_box,
            total_entities=len(entities),
            entity_types=entity_types
        )
    
    def _analyze_layers(self, doc, msp) -> List[CADLayer]:
        """分析图层信息"""
        layers = []
        layer_table = doc.layers
        
        for layer in layer_table:
            # 统计该图层的实体数量
            entity_count = len(msp.query(f'*[layer=="{layer.dxf.name}"]'))
            
            layers.append(CADLayer(
                name=layer.dxf.name,
                color=layer.dxf.color,
                linetype=layer.dxf.linetype,
                is_visible=not layer.is_off(),
                entity_count=entity_count
            ))
        
        return layers
    
    def _analyze_entities(self, msp) -> List[CADEntity]:
        """分析所有实体"""
        entities = []
        
        for entity in msp:
            entity_info = self._extract_entity_info(entity)
            if entity_info:
                entities.append(entity_info)
        
        return entities
    
    def _extract_entity_info(self, entity) -> Optional[CADEntity]:
        """提取单个实体的信息"""
        entity_type = entity.dxftype()
        
        try:
            # 基础信息
            layer = entity.dxf.layer
            handle = entity.dxf.handle
            color = getattr(entity.dxf, 'color', None)
            
            # 根据实体类型提取坐标
            coordinates = []
            text = None
            radius = None
            
            if entity_type == 'LINE':
                start = entity.dxf.start
                end = entity.dxf.end
                coordinates = [start.x, start.y, start.z, end.x, end.y, end.z]
                
            elif entity_type == 'CIRCLE':
                center = entity.dxf.center
                radius = entity.dxf.radius
                coordinates = [center.x, center.y, center.z]
                
            elif entity_type == 'ARC':
                center = entity.dxf.center
                radius = entity.dxf.radius
                start_angle = entity.dxf.start_angle
                end_angle = entity.dxf.end_angle
                coordinates = [center.x, center.y, center.z, start_angle, end_angle]
                
            elif entity_type == 'TEXT' or entity_type == 'MTEXT':
                insert = entity.dxf.insert
                coordinates = [insert.x, insert.y, insert.z]
                text = entity.plain_text() if entity_type == 'MTEXT' else entity.dxf.text
                
            elif entity_type == 'LWPOLYLINE' or entity_type == 'POLYLINE':
                if entity_type == 'LWPOLYLINE':
                    points = list(entity.vertices_in_wcs())
                else:
                    points = [v.dxf.location for v in entity.vertices]
                coordinates = []
                for point in points:
                    coordinates.extend([point.x, point.y, point.z if hasattr(point, 'z') else 0])
                    
            elif entity_type == 'POINT':
                location = entity.dxf.location
                coordinates = [location.x, location.y, location.z]
                
            elif entity_type == 'DIMENSION':
                # 尺寸标注
                text = entity.dxf.text if hasattr(entity.dxf, 'text') else None
                base = entity.dxf.defpoint
                coordinates = [base.x, base.y, base.z]
                
            else:
                # 其他类型，尝试获取插入点或位置
                if hasattr(entity.dxf, 'insert'):
                    insert = entity.dxf.insert
                    coordinates = [insert.x, insert.y, insert.z]
                elif hasattr(entity.dxf, 'location'):
                    location = entity.dxf.location
                    coordinates = [location.x, location.y, location.z]
                else:
                    coordinates = []
            
            return CADEntity(
                entity_type=entity_type,
                layer=layer,
                handle=handle,
                coordinates=coordinates,
                text=text,
                radius=radius,
                color=color
            )
            
        except Exception as e:
            print(f"解析实体 {entity_type} 失败: {e}")
            return None
    
    def _calculate_bounding_box(self, msp) -> Dict[str, float]:
        """计算边界框"""
        try:
            extents = bbox.extents(msp)
            return {
                'min_x': extents.extmin.x,
                'min_y': extents.extmin.y,
                'min_z': extents.extmin.z,
                'max_x': extents.extmax.x,
                'max_y': extents.extmax.y,
                'max_z': extents.extmax.z,
                'width': extents.extmax.x - extents.extmin.x,
                'height': extents.extmax.y - extents.extmin.y,
                'depth': extents.extmax.z - extents.extmin.z
            }
        except:
            return {
                'min_x': 0, 'min_y': 0, 'min_z': 0,
                'max_x': 0, 'max_y': 0, 'max_z': 0,
                'width': 0, 'height': 0, 'depth': 0
            }
    
    def extract_text_entities(self, file_path: str) -> List[Dict[str, Any]]:
        """
        提取所有文字实体（用于提取标注信息）
        
        Returns:
            List[Dict]: 文字实体列表，包含位置和内容
        """
        result = self.parse_file(file_path)
        text_entities = []
        
        for entity in result.entities:
            if entity.entity_type in ['TEXT', 'MTEXT'] and entity.text:
                text_entities.append({
                    'text': entity.text,
                    'layer': entity.layer,
                    'coordinates': entity.coordinates,
                    'handle': entity.handle
                })
        
        return text_entities
    
    def extract_dimensions(self, file_path: str) -> List[Dict[str, Any]]:
        """
        提取所有尺寸标注
        
        Returns:
            List[Dict]: 尺寸标注列表
        """
        result = self.parse_file(file_path)
        dimensions = []
        
        for entity in result.entities:
            if entity.entity_type == 'DIMENSION':
                dimensions.append({
                    'text': entity.text,
                    'layer': entity.layer,
                    'coordinates': entity.coordinates,
                    'handle': entity.handle
                })
        
        return dimensions
    
    def export_to_json(self, file_path: str, output_path: str = None) -> str:
        """
        将 CAD 文件解析结果导出为 JSON
        
        Args:
            file_path: CAD 文件路径
            output_path: 输出 JSON 文件路径（可选）
            
        Returns:
            str: JSON 字符串或输出文件路径
        """
        result = self.parse_file(file_path)
        
        # 转换为字典
        data = {
            'filename': result.filename,
            'version': result.version,
            'total_entities': result.total_entities,
            'entity_types': result.entity_types,
            'bounding_box': result.bounding_box,
            'layers': [asdict(layer) for layer in result.layers],
            'entities': [asdict(entity) for entity in result.entities]
        }
        
        json_str = json.dumps(data, ensure_ascii=False, indent=2)
        
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(json_str)
            return output_path
        
        return json_str


# 便捷函数
def parse_cad(file_path: str) -> CADAnalysisResult:
    """快速解析 CAD 文件"""
    service = CADService()
    return service.parse_file(file_path)


def extract_cad_text(file_path: str) -> List[Dict[str, Any]]:
    """快速提取 CAD 文字"""
    service = CADService()
    return service.extract_text_entities(file_path)


def cad_to_json(file_path: str) -> str:
    """将 CAD 转换为 JSON"""
    service = CADService()
    return service.export_to_json(file_path)
