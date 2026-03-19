"""
CAD 文件处理 API 路由
提供 CAD 文件上传、解析、数据提取等功能
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from typing import List, Optional
from pydantic import BaseModel
import os
import tempfile
import shutil
from pathlib import Path

from cad_service import CADService, parse_cad, extract_cad_text, cad_to_json


router = APIRouter(prefix="/api/cad", tags=["CAD文件处理"])

# 创建上传目录
UPLOAD_DIR = Path("uploads/cad")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ============ 数据模型 ============

class CADUploadResponse(BaseModel):
    """CAD 文件上传响应"""
    success: bool
    message: str
    file_id: Optional[str] = None
    filename: Optional[str] = None
    file_size: Optional[int] = None


class CADAnalysisResponse(BaseModel):
    """CAD 分析响应"""
    success: bool
    filename: str
    version: str
    total_entities: int
    entity_types: dict
    bounding_box: dict
    layers: List[dict]


class CADTextResponse(BaseModel):
    """CAD 文字提取响应"""
    success: bool
    filename: str
    text_count: int
    texts: List[dict]


class CADDimensionResponse(BaseModel):
    """CAD 尺寸标注响应"""
    success: bool
    filename: str
    dimension_count: int
    dimensions: List[dict]


# ============ API 路由 ============

@router.post("/upload", response_model=CADUploadResponse)
async def upload_cad_file(file: UploadFile = File(...)):
    """
    上传 CAD 文件 (DXF 格式)
    
    - **file**: CAD 文件 (.dxf)
    
    返回文件 ID，用于后续解析操作
    """
    # 检查文件格式
    if not file.filename.lower().endswith('.dxf'):
        raise HTTPException(status_code=400, detail="仅支持 DXF 格式文件")
    
    # 生成唯一文件名
    file_id = f"{os.urandom(8).hex()}_{file.filename}"
    file_path = UPLOAD_DIR / file_id
    
    try:
        # 保存文件
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        file_size = os.path.getsize(file_path)
        
        return CADUploadResponse(
            success=True,
            message="文件上传成功",
            file_id=file_id,
            filename=file.filename,
            file_size=file_size
        )
        
    except Exception as e:
        if file_path.exists():
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")


@router.get("/parse/{file_id}", response_model=CADAnalysisResponse)
async def parse_cad_file(file_id: str):
    """
    解析 CAD 文件
    
    - **file_id**: 上传文件时返回的文件 ID
    
    返回完整的 CAD 文件分析结果，包括：
    - 图层信息
    - 实体列表
    - 边界框
    - 实体类型统计
    """
    file_path = UPLOAD_DIR / file_id
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        service = CADService()
        result = service.parse_file(str(file_path))
        
        return CADAnalysisResponse(
            success=True,
            filename=result.filename,
            version=result.version,
            total_entities=result.total_entities,
            entity_types=result.entity_types,
            bounding_box=result.bounding_box,
            layers=[{
                'name': layer.name,
                'color': layer.color,
                'linetype': layer.linetype,
                'is_visible': layer.is_visible,
                'entity_count': layer.entity_count
            } for layer in result.layers]
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析失败: {str(e)}")


@router.get("/text/{file_id}", response_model=CADTextResponse)
async def extract_text(file_id: str):
    """
    提取 CAD 文件中的文字
    
    - **file_id**: 文件 ID
    
    返回所有 TEXT 和 MTEXT 实体的内容和位置
    """
    file_path = UPLOAD_DIR / file_id
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        service = CADService()
        texts = service.extract_text_entities(str(file_path))
        
        return CADTextResponse(
            success=True,
            filename=file_id,
            text_count=len(texts),
            texts=texts
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提取失败: {str(e)}")


@router.get("/dimensions/{file_id}", response_model=CADDimensionResponse)
async def extract_dimensions(file_id: str):
    """
    提取 CAD 文件中的尺寸标注
    
    - **file_id**: 文件 ID
    
    返回所有 DIMENSION 实体的信息
    """
    file_path = UPLOAD_DIR / file_id
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        service = CADService()
        dimensions = service.extract_dimensions(str(file_path))
        
        return CADDimensionResponse(
            success=True,
            filename=file_id,
            dimension_count=len(dimensions),
            dimensions=dimensions
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提取失败: {str(e)}")


@router.get("/export/json/{file_id}")
async def export_to_json(file_id: str, download: bool = False):
    """
    将 CAD 文件导出为 JSON 格式
    
    - **file_id**: 文件 ID
    - **download**: 是否下载文件 (默认直接返回 JSON)
    
    返回完整的 CAD 数据 JSON
    """
    file_path = UPLOAD_DIR / file_id
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        service = CADService()
        
        if download:
            # 生成下载文件
            output_path = UPLOAD_DIR / f"{file_id}.json"
            service.export_to_json(str(file_path), str(output_path))
            
            return FileResponse(
                path=output_path,
                filename=f"{file_id}.json",
                media_type="application/json"
            )
        else:
            # 直接返回 JSON 字符串
            json_str = service.export_to_json(str(file_path))
            return JSONResponse(content=json.loads(json_str))
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.get("/files")
async def list_uploaded_files():
    """
    列出所有已上传的 CAD 文件
    """
    files = []
    for file_path in UPLOAD_DIR.iterdir():
        if file_path.is_file() and not file_path.suffix == '.json':
            files.append({
                'file_id': file_path.name,
                'filename': file_path.name.split('_', 1)[1] if '_' in file_path.name else file_path.name,
                'size': os.path.getsize(file_path),
                'upload_time': os.path.getctime(file_path)
            })
    
    return {
        'success': True,
        'count': len(files),
        'files': files
    }


@router.delete("/files/{file_id}")
async def delete_file(file_id: str):
    """
    删除上传的 CAD 文件
    """
    file_path = UPLOAD_DIR / file_id
    json_path = UPLOAD_DIR / f"{file_id}.json"
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    
    try:
        os.remove(file_path)
        if json_path.exists():
            os.remove(json_path)
        
        return {'success': True, 'message': '文件已删除'}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.post("/analyze")
async def quick_analyze(file: UploadFile = File(...)):
    """
    快速分析 CAD 文件（上传并立即解析）
    
    一步完成上传和解析，适合小文件快速查看
    """
    if not file.filename.lower().endswith('.dxf'):
        raise HTTPException(status_code=400, detail="仅支持 DXF 格式文件")
    
    # 使用临时文件
    with tempfile.NamedTemporaryFile(delete=False, suffix='.dxf') as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    
    try:
        service = CADService()
        result = service.parse_file(tmp_path)
        
        return {
            'success': True,
            'filename': result.filename,
            'version': result.version,
            'total_entities': result.total_entities,
            'entity_types': result.entity_types,
            'bounding_box': result.bounding_box,
            'layer_count': len(result.layers),
            'layers': [{
                'name': layer.name,
                'color': layer.color,
                'entity_count': layer.entity_count
            } for layer in result.layers[:10]]  # 只返回前10个图层
        }
        
    finally:
        os.unlink(tmp_path)
