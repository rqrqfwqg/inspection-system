"""分系统资料管理 · API 路由 + 种子数据

挂载前缀：/assets（最终由 main.py 的 api_router(prefix="/ops/api") 拼装为 /ops/api/assets）
核心能力：
  - 设备全局检索（输入设备编号 → 聚合该设备跨子系统全部资料 + 关联追溯）
  - 子系统 / 资料表 / 字段定义 / 记录 / 设备 / 关联 的增删查改
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text, func
from typing import Optional, List, Dict, Any
import os
import io
import uuid
import openpyxl
from datetime import datetime, timezone

from database import (
    get_db, User, Subsystem, Device, DataTable, FieldDef, Record, DeviceRelation,
    BaSystemMap, EquipmentCategory, DeviceAlias, ImportBatch,
    FixedAsset, DeviceArchive, DeviceAccessory, BaProblem, Room, DevicePhoto,
    RelationType,
)
from asset_schemas import (
    SubsystemCreate, SubsystemUpdate, SubsystemResponse,
    DeviceCreate, DeviceUpdate, DeviceResponse,
    DataTableCreate, DataTableUpdate, DataTableResponse,
    FieldDefCreate, FieldDefUpdate, FieldDefResponse,
    RecordCreate, RecordUpdate, RecordResponse,
    DeviceRelationCreate, DeviceRelationUpdate, DeviceRelationResponse,
    RelationTypeResponse,
    BulkRecordCreate, BulkRecordItem,
    SearchResult, DevicePhotoResponse,
)
# 鉴权统一收口到 dependencies（消除与 main.py 的重复实现）
from dependencies import get_current_user as _get_current_user, require_admin as _require_admin
# 数据导入引擎：把上传的 Excel 解析并落库（自包含，避免循环依赖）
from import_engine import import_workbook, detect_template, TEMPLATE_INFO

router = APIRouter(prefix="/assets", tags=["assets"])


# ========================= 关联类型字典（P1） =========================

# code 为受控主键（device_relations.relation_type 落库用 code）；
# label 为展示中文名；kind 供上游遍历/前端分组着色。
RELATION_TYPE_SEED: List[Dict[str, Any]] = [
    # --- 供配电链路（kind=power，direction=forward：from=上游供电方 → to=下游受电方）---
    {"code": "power_supply",     "label": "供电",     "kind": "power",   "direction": "forward",
     "description": "上游设备为下游设备供电（如配电柜→用电设备）", "sort_order": 10},
    {"code": "power_dist",       "label": "供配电",   "kind": "power",   "direction": "forward",
     "description": "上级配电设施向下级配电/受电设备供配电", "sort_order": 11},
    {"code": "power_take",       "label": "取电",     "kind": "power",   "direction": "forward",
     "description": "设备自上级配电点取电（供电链上游追溯）", "sort_order": 12},
    {"code": "parent_dist",      "label": "上级配电", "kind": "power",   "direction": "forward",
     "description": "指向本设备的上级配电柜/母线（上游）", "sort_order": 13},
    # --- 冷源链路（kind=cooling：from=冷源主机 → to=用冷末端）---
    {"code": "cooling_source",   "label": "冷源",     "kind": "cooling", "direction": "forward",
     "description": "冷水机组/冷源为空调末端提供冷量", "sort_order": 20},
    # --- 位置归属（kind=locate，无向）---
    {"code": "locate_in_room",   "label": "所在机房", "kind": "locate",  "direction": "none",
     "description": "设备安装于某机房/房间内（现场补录自动建立）", "sort_order": 30},
    # --- 网络链路（kind=network：网络接线关系）---
    {"code": "net_link",         "label": "网络",     "kind": "network", "direction": "none",
     "description": "设备经网络线缆/端口互联（交换机→设备）", "sort_order": 40},
    # --- 控制/信号/管路等 ---
    {"code": "ctrl_signal",      "label": "控制",     "kind": "control", "direction": "none",
     "description": "控制设备与被控设备间信号/控制关系", "sort_order": 50},
    {"code": "pipe_link",        "label": "管路连接", "kind": "pipe",    "direction": "none",
     "description": "设备间水/风/冷媒管路连接", "sort_order": 60},
    {"code": "accessory_of",     "label": "配件从属", "kind": "accessory","direction": "none",
     "description": "配件/附属设备从属于主设备", "sort_order": 70},
    {"code": "other_link",       "label": "关联",     "kind": "other",   "direction": "none",
     "description": "未归类的一般关联", "sort_order": 99},
]

# 历史文本（device_relations.relation_type 现存值）→ 受控 label 的兼容映射
LEGACY_RELATION_MAP: Dict[str, str] = {
    "供电": "power_supply", "供配电": "power_dist", "上级配电": "parent_dist",
    "取电": "power_take", "冷源": "cooling_source", "所在机房": "locate_in_room",
    "网络": "net_link", "控制": "ctrl_signal", "管路连接": "pipe_link",
    "配件从属": "accessory_of", "关联": "other_link",
}
# code → label（与 RELATION_TYPE_SEED 一致，供反查）
RELATION_CODE_LABEL: Dict[str, str] = {r["code"]: r["label"] for r in RELATION_TYPE_SEED}
RELATION_LABEL_KIND: Dict[str, str] = {r["label"]: r["kind"] for r in RELATION_TYPE_SEED}


def _seed_relation_types(db: Session):
    """幂等写入 relation_types 字典（P1）。"""
    for row in RELATION_TYPE_SEED:
        exists = db.query(RelationType).filter(RelationType.code == row["code"]).first()
        if exists:
            # 只同步可展示字段，不覆盖人工改动标记
            exists.label = row["label"]; exists.kind = row["kind"]
            exists.direction = row["direction"]
            exists.description = row["description"]; exists.sort_order = row["sort_order"]
            exists.is_active = True
        else:
            db.add(RelationType(**row))
    db.commit()


def _canonical_relation_label(raw: str) -> str:
    """任意输入（code / 受控 label / 历史文本 / 空）→ 受控 label。

    列存 label（中文展示名），保证既有 UI（RelationGraph / search.edges.type）
    零回归；code 仅作字典主键与前端 API 透传。
    """
    s = (raw or "").strip()
    if not s:
        return RELATION_CODE_LABEL["other_link"]
    if s in RELATION_CODE_LABEL.values():       # 已是合法 label
        return s
    if s in LEGACY_RELATION_MAP:                # 历史文本 → code → label
        return RELATION_CODE_LABEL.get(LEGACY_RELATION_MAP[s], RELATION_CODE_LABEL["other_link"])
    if s in RELATION_CODE_LABEL:                # 传的是 code
        return RELATION_CODE_LABEL[s]
    return RELATION_CODE_LABEL["other_link"]    # 未知 → 兜底「关联」


def _relation_type_meta(db: Session) -> Dict[str, Dict[str, Any]]:
    """{code: {label, kind, direction}} —— 前端着色/遍历判向用。"""
    out: Dict[str, Dict[str, Any]] = {}
    for r in db.query(RelationType).filter(RelationType.is_active == True).all():
        out[r.code] = {"label": r.label, "kind": r.kind, "direction": r.direction}
    return out


# ========================= 工具函数 =========================

def _subsystem_name(db: Session, sid: Optional[int]) -> Optional[str]:
    if not sid:
        return None
    s = db.query(Subsystem).filter(Subsystem.id == sid).first()
    return s.name if s else None


def _serialize_record(db: Session, rec: Record) -> Dict[str, Any]:
    dev = db.query(Device).filter(Device.device_code == rec.device_code).first()
    tbl = db.query(DataTable).filter(DataTable.id == rec.table_id).first()
    return {
        "id": rec.id,
        "table_id": rec.table_id,
        "device_code": rec.device_code,
        "data": rec.data or {},
        "created_by": rec.created_by,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
        "updated_at": rec.updated_at.isoformat() if rec.updated_at else None,
        "device_name": dev.name if dev else None,
        "table_name": tbl.name if tbl else None,
    }


def _date_to_str(d):
    return d.isoformat() if d else None


def _classify_area(building: Optional[str], location: Optional[str] = None) -> str:
    """楼栋/位置 → 区域大类（停车楼 / GTC / 市政 / 其他）。"""
    text = building or location or ""
    if "停车" in text:
        return "停车楼"
    if "GTC" in text.upper() or "交通中心" in text or "工作区" in text:
        return "GTC"
    if "市政" in text:
        return "市政"
    return building or "其他"


def _fa_to_dict(fa: "FixedAsset") -> Dict[str, Any]:
    """固定资产 → JSON 友好 dict（日期转字符串、Numeric 转 float）。"""
    return {
        "device_code": fa.device_code,
        "transfer_no": fa.transfer_no,
        "tag_no": fa.tag_no,
        "owner_unit": fa.owner_unit,
        "use_dept": fa.use_dept,
        "location": fa.location,
        "asset_name": fa.asset_name,
        "asset_code": fa.asset_code,
        "brand_model": fa.brand_model,
        "serial_no": fa.serial_no,
        "recv_date": _date_to_str(fa.recv_date),
        "warranty_end": _date_to_str(fa.warranty_end),
        "price_tax": float(fa.price_tax) if fa.price_tax is not None else None,
        "price_notax": float(fa.price_notax) if fa.price_notax is not None else None,
        "tax": float(fa.tax) if fa.tax is not None else None,
        "budget_item": fa.budget_item,
        "contract_no": fa.contract_no,
        "bim_tag": fa.bim_tag,
        "builder": fa.builder,
        "responsible": fa.responsible,
        "proj_manager": fa.proj_manager,
        "warranty_contact": fa.warranty_contact,
        "remark": fa.remark,
        "room_code": fa.room_code,
        "room_match_method": fa.room_match_method,
    }


def _da_to_dict(da: "DeviceArchive") -> Dict[str, Any]:
    """设备档案 → JSON 友好 dict。"""
    return {
        "device_code": da.device_code,
        "pre_no": da.pre_no,
        "project": da.project,
        "system_text": da.system_text,
        "location": da.location,
        "building": da.building,
        "floor": da.floor,
        "old_name": da.old_name,
        "asset_name": da.asset_name,
        "old_code": da.old_code,
        "manufacturer": da.manufacturer,
        "brand_model": da.brand_model,
        "recv_date": _date_to_str(da.recv_date),
        "qty": da.qty,
        "unit": da.unit,
        "kio": da.kio,
        "original_value": float(da.original_value) if da.original_value is not None else None,
        "residual_rate": float(da.residual_rate) if da.residual_rate is not None else None,
        "net_value": float(da.net_value) if da.net_value is not None else None,
        "status_name": da.status_name,
        "remark": da.remark,
        "room_code": da.room_code,
        "room_match_method": da.room_match_method,
    }


# ========================= 子系统 =========================

@router.get("/subsystems", response_model=List[SubsystemResponse])
def list_subsystems(db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    return db.query(Subsystem).order_by(Subsystem.sort_order, Subsystem.id).all()

@router.post("/subsystems", response_model=SubsystemResponse)
def create_subsystem(data: SubsystemCreate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    if db.query(Subsystem).filter(Subsystem.code == data.code).first():
        raise HTTPException(status_code=400, detail=f"子系统编码 {data.code} 已存在")
    obj = Subsystem(**data.model_dump())
    db.add(obj); db.commit(); db.refresh(obj)
    return obj

@router.put("/subsystems/{sid}", response_model=SubsystemResponse)
def update_subsystem(sid: int, data: SubsystemUpdate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(Subsystem).filter(Subsystem.id == sid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="子系统不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(obj)
    return obj

@router.delete("/subsystems/{sid}")
def delete_subsystem(sid: int, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(Subsystem).filter(Subsystem.id == sid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="子系统不存在")
    # 级联删除其资料表与字段、记录
    tables = db.query(DataTable).filter(DataTable.subsystem_id == sid).all()
    for t in tables:
        db.query(Record).filter(Record.table_id == t.id).delete()
        db.query(FieldDef).filter(FieldDef.table_id == t.id).delete()
    db.query(DataTable).filter(DataTable.subsystem_id == sid).delete()
    db.delete(obj)
    db.commit()
    return {"success": True, "message": "子系统及其资料表已删除"}


# ========================= 资料表 =========================

@router.get("/tables", response_model=List[DataTableResponse])
def list_tables(subsystem_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    q = db.query(DataTable)
    if subsystem_id:
        q = q.filter(DataTable.subsystem_id == subsystem_id)
    rows = q.order_by(DataTable.sort_order, DataTable.id).all()
    result = []
    for t in rows:
        d = DataTableResponse.model_validate(t)
        d.subsystem_name = _subsystem_name(db, t.subsystem_id)
        d.field_count = db.query(FieldDef).filter(FieldDef.table_id == t.id).count()
        result.append(d)
    return result

@router.get("/tables/{tid}", response_model=DataTableResponse)
def get_table(tid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    t = db.query(DataTable).filter(DataTable.id == tid).first()
    if not t:
        raise HTTPException(status_code=404, detail="资料表不存在")
    d = DataTableResponse.model_validate(t)
    d.subsystem_name = _subsystem_name(db, t.subsystem_id)
    d.field_count = db.query(FieldDef).filter(FieldDef.table_id == t.id).count()
    return d

@router.post("/tables", response_model=DataTableResponse)
def create_table(data: DataTableCreate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    if not db.query(Subsystem).filter(Subsystem.id == data.subsystem_id).first():
        raise HTTPException(status_code=400, detail="所属子系统不存在")
    if db.query(DataTable).filter(DataTable.subsystem_id == data.subsystem_id, DataTable.code == data.code).first():
        raise HTTPException(status_code=400, detail=f"该子系统下资料表编码 {data.code} 已存在")
    obj = DataTable(**data.model_dump())
    db.add(obj); db.commit(); db.refresh(obj)
    d = DataTableResponse.model_validate(obj)
    d.subsystem_name = _subsystem_name(db, obj.subsystem_id)
    return d

@router.put("/tables/{tid}", response_model=DataTableResponse)
def update_table(tid: int, data: DataTableUpdate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(DataTable).filter(DataTable.id == tid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="资料表不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(obj)
    d = DataTableResponse.model_validate(obj)
    d.subsystem_name = _subsystem_name(db, obj.subsystem_id)
    return d

@router.delete("/tables/{tid}")
def delete_table(tid: int, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(DataTable).filter(DataTable.id == tid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="资料表不存在")
    db.query(Record).filter(Record.table_id == tid).delete()
    db.query(FieldDef).filter(FieldDef.table_id == tid).delete()
    db.delete(obj)
    db.commit()
    return {"success": True, "message": "资料表及其字段、记录已删除"}


# ========================= 字段定义 =========================

@router.get("/tables/{tid}/fields", response_model=List[FieldDefResponse])
def list_fields(tid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    return db.query(FieldDef).filter(FieldDef.table_id == tid).order_by(FieldDef.sort_order, FieldDef.id).all()

@router.post("/tables/{tid}/fields", response_model=FieldDefResponse)
def create_field(tid: int, data: FieldDefCreate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    if not db.query(DataTable).filter(DataTable.id == tid).first():
        raise HTTPException(status_code=404, detail="资料表不存在")
    if db.query(FieldDef).filter(FieldDef.table_id == tid, FieldDef.key == data.key).first():
        raise HTTPException(status_code=400, detail=f"字段 {data.key} 已存在")
    obj = FieldDef(**data.model_dump())
    db.add(obj); db.commit(); db.refresh(obj)
    return obj

@router.put("/tables/{tid}/fields/{fid}", response_model=FieldDefResponse)
def update_field(tid: int, fid: int, data: FieldDefUpdate, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(FieldDef).filter(FieldDef.id == fid, FieldDef.table_id == tid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="字段不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(obj)
    return obj

@router.delete("/tables/{tid}/fields/{fid}")
def delete_field(tid: int, fid: int, db: Session = Depends(get_db), _: User = Depends(_require_admin)):
    obj = db.query(FieldDef).filter(FieldDef.id == fid, FieldDef.table_id == tid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="字段不存在")
    db.delete(obj); db.commit()
    return {"success": True, "message": "字段已删除"}


# ========================= 资料记录 =========================

@router.get("/tables/{tid}/records", response_model=List[RecordResponse])
def list_records(tid: int, device_code: Optional[str] = None, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    q = db.query(Record).filter(Record.table_id == tid)
    if device_code:
        q = q.filter(Record.device_code == device_code)
    recs = q.order_by(Record.id.desc()).all()
    return [_serialize_record(db, r) for r in recs]

@router.post("/tables/{tid}/records", response_model=RecordResponse)
def create_record(tid: int, data: RecordCreate, db: Session = Depends(get_db), current_user: User = Depends(_get_current_user)):
    tbl = db.query(DataTable).filter(DataTable.id == tid).first()
    if not tbl:
        raise HTTPException(status_code=404, detail="资料表不存在")
    device_code = data.device_code
    # 若未显式给出 device_code，则从"关联键"字段取值
    if not device_code:
        rel_field = db.query(FieldDef).filter(FieldDef.table_id == tid, FieldDef.is_relation_key == True).first()
        if rel_field and rel_field.key in data.data:
            device_code = str(data.data[rel_field.key])
    if not device_code:
        raise HTTPException(status_code=400, detail="缺少设备编号：请填写关联键字段或显式传入 device_code")
    rec = Record(table_id=tid, device_code=device_code, data=data.data, created_by=current_user.name)
    db.add(rec); db.commit(); db.refresh(rec)
    return _serialize_record(db, rec)

@router.put("/tables/{tid}/records/{rid}", response_model=RecordResponse)
def update_record(tid: int, rid: int, data: RecordUpdate, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    rec = db.query(Record).filter(Record.id == rid, Record.table_id == tid).first()
    if not rec:
        raise HTTPException(status_code=404, detail="记录不存在")
    if data.device_code is not None:
        rec.device_code = data.device_code
    if data.data is not None:
        rec.data = data.data
    rec.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(rec)
    return _serialize_record(db, rec)

@router.delete("/tables/{tid}/records/{rid}")
def delete_record(tid: int, rid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    rec = db.query(Record).filter(Record.id == rid, Record.table_id == tid).first()
    if not rec:
        raise HTTPException(status_code=404, detail="记录不存在")
    db.delete(rec); db.commit()
    return {"success": True, "message": "记录已删除"}


# ========================= 设备台账 =========================

@router.get("/devices", response_model=List[DeviceResponse])
def list_devices(q: Optional[str] = None, subsystem_id: Optional[int] = None,
                 include_inactive: bool = False,
                 building: Optional[str] = None, floor: Optional[str] = None,
                 limit: int = 200, skip: int = 0,
                 db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """设备台账列表（扫码标签 P0 增强：支持 building/floor 过滤与 limit/skip 分页，向后兼容）。

    limit 上限 1000：标签打印页一次最多取一批，避免大响应阻塞移动端。
    """
    query = db.query(Device)
    if not include_inactive:
        # 软删除（is_active=False）默认不出现在活动列表（决策 Q6：仅保留历史，不在前台展示）
        query = query.filter(Device.is_active == True)
    if subsystem_id:
        query = query.filter(Device.subsystem_id == subsystem_id)
    if building:
        query = query.filter(Device.building == building)
    if floor:
        query = query.filter(Device.floor == floor)
    if q:
        like = f"%{q}%"
        query = query.filter((Device.device_code.like(like)) | (Device.name.like(like)) | (Device.location_desc.like(like)))
    limit = max(1, min(int(limit), 1000))
    rows = query.order_by(Device.device_code).offset(max(0, int(skip))).limit(limit).all()
    result = []
    for d in rows:
        r = DeviceResponse.model_validate(d)
        r.subsystem_name = _subsystem_name(db, d.subsystem_id)
        result.append(r)
    return result

@router.post("/devices", response_model=DeviceResponse)
def create_device(data: DeviceCreate, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    if db.query(Device).filter(Device.device_code == data.device_code).first():
        raise HTTPException(status_code=400, detail=f"设备编号 {data.device_code} 已存在")
    obj = Device(**data.model_dump())
    db.add(obj); db.commit(); db.refresh(obj)
    r = DeviceResponse.model_validate(obj)
    r.subsystem_name = _subsystem_name(db, obj.subsystem_id)
    return r

@router.put("/devices/{did}", response_model=DeviceResponse)
def update_device(did: int, data: DeviceUpdate, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """更新设备（含扫码补录位置：room_id / building / floor / location_desc）。

    room_id 非空时校验机房存在，避免写入孤儿外键。
    """
    obj = db.query(Device).filter(Device.id == did).first()
    if not obj:
        raise HTTPException(status_code=404, detail="设备不存在")
    payload = data.model_dump(exclude_unset=True)
    if payload.get("room_id") is not None:
        room = db.query(Room).filter(Room.id == payload["room_id"]).first()
        if not room:
            raise HTTPException(status_code=400, detail=f"机房不存在（id={payload['room_id']}）")
        # 机房级联写回楼栋/楼层，保证 devices 位置与 rooms 一致（扫码补录 P0）
        payload.setdefault("building", room.building)
        payload.setdefault("floor", room.floor)
    for k, v in payload.items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(obj)
    r = DeviceResponse.model_validate(obj)
    r.subsystem_name = _subsystem_name(db, obj.subsystem_id)
    return r


# ========================= 设备现场照片（扫码补录 P0） =========================

# 照片目录：backend/uploads/assets/photos（同源 /ops/uploads 静态托管）
_PHOTO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "assets", "photos")
os.makedirs(_PHOTO_DIR, exist_ok=True)
_ALLOWED_IMG = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}


def _resolve_device_by_code_or_alias(db: Session, code: str) -> Optional[Device]:
    """设备编号（可带别名）→ devices 记录；alias 先反查 canonical。"""
    alias = db.query(DeviceAlias).filter(DeviceAlias.alias_code == code).first()
    if alias:
        code = alias.canonical_code
    return db.query(Device).filter(Device.device_code == code).first()


@router.post("/devices/{did}/photos", response_model=DevicePhotoResponse)
async def upload_device_photo(
    did: int,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """上传设备现场照片（multipart file，单张 ≤10MB；note 为拍摄说明）。

    文件落 backend/uploads/assets/photos/{uuid}.{ext}，返回 /ops/uploads/... URL。
    """
    dev = db.query(Device).filter(Device.id == did).first()
    if not dev:
        raise HTTPException(status_code=404, detail="设备不存在")
    if file.content_type not in _ALLOWED_IMG:
        raise HTTPException(status_code=400, detail="仅支持 JPG/PNG/GIF/WEBP 图片")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片不能超过 10MB")
    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext.lower()}"
    file_path = os.path.join(_PHOTO_DIR, fname)
    with open(file_path, "wb") as f:
        f.write(content)
    photo = DevicePhoto(
        device_code=dev.device_code,
        url=f"/ops/uploads/assets/photos/{fname}",
        note=(note or "").strip(),
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return DevicePhotoResponse.model_validate(photo)


@router.get("/devices/{did}/photos", response_model=List[DevicePhotoResponse])
def list_device_photos(did: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    dev = db.query(Device).filter(Device.id == did).first()
    if not dev:
        raise HTTPException(status_code=404, detail="设备不存在")
    rows = db.query(DevicePhoto).filter(DevicePhoto.device_code == dev.device_code)\
        .order_by(DevicePhoto.created_at.desc()).all()
    return [DevicePhotoResponse.model_validate(p) for p in rows]


@router.delete("/photos/{pid}")
def delete_device_photo(pid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    photo = db.query(DevicePhoto).filter(DevicePhoto.id == pid).first()
    if not photo:
        raise HTTPException(status_code=404, detail="照片不存在")
    # 删除文件本体（失败不阻断：孤儿文件可忽略，DB 为主）
    if photo.url:
        rel = photo.url.lstrip("/")
        full = os.path.join(os.path.dirname(os.path.abspath(__file__)), rel)
        try:
            if os.path.exists(full):
                os.remove(full)
        except Exception:
            pass
    db.delete(photo)
    db.commit()
    return {"success": True, "message": "照片已删除"}

@router.delete("/devices/{did}")
def delete_device(did: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """软删除：保留历史资料 records，仅清理关联关系，设备置 is_active=false（决策 Q6）。"""
    obj = db.query(Device).filter(Device.id == did).first()
    if not obj:
        raise HTTPException(status_code=404, detail="设备不存在")
    # 清理关联关系（两端任意一端命中本设备）
    db.query(DeviceRelation).filter(
        (DeviceRelation.from_code == obj.device_code) |
        (DeviceRelation.to_code == obj.device_code)
    ).delete()
    # records 保留；设备软删除
    obj.is_active = False
    obj.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True, "message": "设备已注销（历史资料保留）"}


# ========================= 设备关联 =========================

@router.get("/relation-types", response_model=List[RelationTypeResponse])
def list_relation_types(db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """关联类型字典（P1）：前端建边下拉/链着色数据源。"""
    return (db.query(RelationType).filter(RelationType.is_active == True)
            .order_by(RelationType.sort_order, RelationType.code).all())


@router.get("/relations", response_model=List[DeviceRelationResponse])
def list_relations(from_code: Optional[str] = None, to_code: Optional[str] = None,
                   db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    q = db.query(DeviceRelation)
    if from_code:
        q = q.filter(DeviceRelation.from_code == from_code)
    if to_code:
        q = q.filter(DeviceRelation.to_code == to_code)
    return q.order_by(DeviceRelation.id.desc()).all()


@router.post("/relations", response_model=DeviceRelationResponse)
def create_relation(data: DeviceRelationCreate, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """现场/桌面建边（P1 起受控）：两端编号经别名桥接解析 → 设备必须存在 → 防自环 → 类型归一。

    relation_type 接受 code/label/历史文本任一种，落库统一为受控 label。
    """
    from_code = (data.from_code or "").strip()
    to_code = (data.to_code or "").strip()
    if not from_code or not to_code:
        raise HTTPException(status_code=400, detail="from_code / to_code 均必填")

    f_dev = _resolve_device_by_code_or_alias(db, from_code)
    t_dev = _resolve_device_by_code_or_alias(db, to_code)
    missing = [c for c, d in ((from_code, f_dev), (to_code, t_dev)) if d is None]
    if missing:
        raise HTTPException(status_code=404,
                            detail=f"设备不存在（可先在设备台账登记）：{', '.join(missing)}")
    f_code, t_code = f_dev.device_code, t_dev.device_code
    if f_code == t_code:
        raise HTTPException(status_code=400, detail="不能建立设备到自身的关联")

    rtype = _canonical_relation_label(data.relation_type)
    dup = (db.query(DeviceRelation).filter(
        DeviceRelation.from_code == f_code, DeviceRelation.to_code == t_code,
        DeviceRelation.relation_type == rtype).first())
    if dup:
        raise HTTPException(status_code=409, detail=f"相同关联已存在（{f_code} → {t_code} · {rtype}）")

    obj = DeviceRelation(
        from_code=f_code, to_code=t_code, relation_type=rtype,
        subsystem_id=data.subsystem_id, meta=data.meta or {})
    db.add(obj); db.commit(); db.refresh(obj)
    return obj

@router.delete("/relations/{rid}")
def delete_relation(rid: int, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    obj = db.query(DeviceRelation).filter(DeviceRelation.id == rid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="关联不存在")
    db.delete(obj); db.commit()
    return {"success": True, "message": "关联已删除"}

@router.put("/relations/{rid}", response_model=DeviceRelationResponse)
def update_relation(rid: int, data: DeviceRelationUpdate, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    obj = db.query(DeviceRelation).filter(DeviceRelation.id == rid).first()
    if not obj:
        raise HTTPException(status_code=404, detail="关联不存在")
    upd = data.model_dump(exclude_unset=True)
    if "relation_type" in upd and upd["relation_type"]:
        upd["relation_type"] = _canonical_relation_label(upd["relation_type"])
    if "from_code" in upd and upd["from_code"]:
        d = _resolve_device_by_code_or_alias(db, upd["from_code"])
        if not d:
            raise HTTPException(status_code=404, detail=f"设备不存在：{upd['from_code']}")
        upd["from_code"] = d.device_code
    if "to_code" in upd and upd["to_code"]:
        d = _resolve_device_by_code_or_alias(db, upd["to_code"])
        if not d:
            raise HTTPException(status_code=404, detail=f"设备不存在：{upd['to_code']}")
        upd["to_code"] = d.device_code
    if obj.from_code == obj.to_code:
        raise HTTPException(status_code=400, detail="不能建立设备到自身的关联")
    for k, v in upd.items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


# ========================= 上游供电/冷源链遍历（P1） =========================
# 语义：relation_types.direction=forward（power/cooling）时 from=上游(供电方/冷源) → to=下游(受电方/用冷)。
# 遍历方向参数 side：
#   up   —— 沿「我 → 上游」反查（to_code==我 的边，取 from_code），找供电来源/上级配电
#   down —— 沿「我 → 下游」追踪（from_code==我 的边，取 to_code），找受电分支
#   both —— 双向
_POWER_KINDS = {"power", "cooling"}


def _chain_bfs(db: Session, start_code: str, side: str, depth: int) -> Dict[str, Any]:
    """按 kind∈{power,cooling} 受控边做有向 BFS；跳过 locate/network 等非能源链路。"""
    label_kind = RELATION_LABEL_KIND  # label → kind
    nodes: List[Dict[str, Any]] = []
    visited: Dict[str, int] = {start_code: 0}
    frontier = [start_code]
    edges: List[Dict[str, Any]] = []
    for hop in range(1, depth + 1):
        nxt: List[str] = []
        for cur in frontier:
            rels = db.query(DeviceRelation).filter(
                (DeviceRelation.from_code == cur) | (DeviceRelation.to_code == cur)).all()
            for r in rels:
                kind = label_kind.get(r.relation_type)
                if kind not in _POWER_KINDS:
                    continue  # 只沿 供电/供配电/上级配电/取电/冷源 链走
                if r.to_code == cur:            # cur 是下游 → from_code 是上游
                    other, edge_side = r.from_code, "up"
                elif r.from_code == cur:        # cur 是上游 → to_code 是下游
                    other, edge_side = r.to_code, "down"
                else:
                    continue
                if side == "up" and edge_side != "up":
                    continue
                if side == "down" and edge_side != "down":
                    continue
                if other in visited:
                    continue
                visited[other] = hop
                edges.append({"rid": r.id, "from": r.from_code, "to": r.to_code,
                              "type": r.relation_type, "side": edge_side, "depth": hop})
                nxt.append(other)
        frontier = nxt
        if not frontier:
            break
    # 补齐节点名（含起点）
    codes = list(visited.keys())
    dev_map: Dict[str, Device] = {}
    if codes:
        for d in db.query(Device).filter(Device.device_code.in_(codes)).all():
            dev_map[d.device_code] = d
    for c, dpt in visited.items():
        d = dev_map.get(c)
        nodes.append({
            "device_code": c,
            "name": d.name if d else "",
            "depth": dpt,
            "role": "start" if dpt == 0 else ("上游" if side == "up" else "下游"),
        })
    return {"start_code": start_code, "depth": depth, "nodes": nodes, "edges": edges}


@router.get("/devices/{did}/power-chain")
def device_power_chain(did: int, side: str = "up", depth: int = 2,
                       db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    """上游供电/冷源链遍历（默认向上最多 2 跳；depth 1..5）。

    沿 power/cooling 受控边（供电/供配电/上级配电/取电/冷源）回溯上游来源设备。
    手机端扫码后展示「这台电是谁给的」；桌面图谱复用同语义。
    """
    dev = db.query(Device).filter(Device.id == did).first()
    if not dev:
        raise HTTPException(status_code=404, detail="设备不存在")
    side = side if side in ("up", "down", "both") else "up"
    depth = max(1, min(5, int(depth)))
    # side=both 由两次单向 BFS 合成，避免 side 语义污染
    if side == "both":
        up = _chain_bfs(db, dev.device_code, "up", depth)
        down = _chain_bfs(db, dev.device_code, "down", depth)
        merged = {n["device_code"]: {**n, "role": "上游"} for n in up["nodes"]}
        for n in down["nodes"]:
            if n["device_code"] in merged:
                continue
            merged[n["device_code"]] = {**n, "role": "下游"}
        return {"start_code": dev.device_code, "depth": depth, "side": side,
                "nodes": list(merged.values()),
                "edges": up["edges"] + down["edges"]}
    return {"start_code": dev.device_code, "depth": depth, "side": side,
            **_chain_bfs(db, dev.device_code, side, depth)}


# ========================= 批量建记录（Excel 导入落库） =========================

@router.post("/tables/{tid}/records/bulk", response_model=Dict[str, Any])
def bulk_create_records(tid: int, payload: BulkRecordCreate,
                        db: Session = Depends(get_db), current_user: User = Depends(_get_current_user)):
    """批量创建记录（Excel 导入后端落库）。每条可带 device_code，否则从关联键字段取值。"""
    tbl = db.query(DataTable).filter(DataTable.id == tid).first()
    if not tbl:
        raise HTTPException(status_code=404, detail="资料表不存在")
    rel_field = db.query(FieldDef).filter(FieldDef.table_id == tid, FieldDef.is_relation_key == True).first()
    created = 0
    skipped = 0
    for item in payload.records:
        device_code = item.device_code
        if not device_code and rel_field and rel_field.key in item.data:
            device_code = str(item.data[rel_field.key])
        if not device_code:
            skipped += 1
            continue
        rec = Record(table_id=tid, device_code=device_code, data=item.data, created_by=current_user.name)
        db.add(rec)
        created += 1
    db.commit()
    return {"success": True, "created": created, "skipped": skipped}


# ========================= 核心：设备全局检索 =========================

@router.get("/search", response_model=SearchResult)
def search_device(code: str, depth: int = 2, db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    code = (code or "").strip()
    if not code:
        return SearchResult(found=False)

    # 别名桥接：任一编号（移交/资产代码/新设备编号/BA编号/BIM/标签号）→ canonical device_code
    alias = db.query(DeviceAlias).filter(DeviceAlias.alias_code == code).first()
    if alias:
        code = alias.canonical_code

    target = db.query(Device).filter(Device.device_code == code).first()
    found = target is not None

    # 1) 关联遍历：递归 CTE（SQLite 支持）
    # O1 优化（2026-07-12）：CTE 起点改为以查询 code 字面量为起点，
    # 不再依赖 devices 表，使「仅存在于 records（未在 devices 登记）」的真实台账设备也能被检索聚合。
    cte_sql = sa_text("""
        WITH RECURSIVE linked(code, depth) AS (
            SELECT :code AS code, 0
            UNION ALL
            SELECT
                CASE WHEN r.from_code = linked.code THEN r.to_code ELSE r.from_code END,
                linked.depth + 1
            FROM device_relations r
            INNER JOIN linked ON r.from_code = linked.code OR r.to_code = linked.code
            WHERE linked.depth < :depth
        )
        SELECT code, MIN(depth) AS depth FROM linked GROUP BY code
    """)
    linked_rows = db.execute(cte_sql, {"code": code, "depth": depth}).fetchall()
    linked_map: Dict[str, int] = {row[0]: row[1] for row in linked_rows}
    codes = list(linked_map.keys())

    # 2) 设备节点信息
    devices = db.query(Device).filter(Device.device_code.in_(codes)).all()
    dev_info: Dict[str, Device] = {d.device_code: d for d in devices}
    nodes = []
    for c in codes:
        d = dev_info.get(c)
        if d:
            sub = db.query(Subsystem).filter(Subsystem.id == d.subsystem_id).first()
            nodes.append({
                "device_code": c,
                "name": d.name,
                "subsystem_code": sub.code if sub else None,
                "subsystem_name": sub.name if sub else None,
                "depth": linked_map.get(c, 0),
            })

    # 3) 关联边（仅保留两端都在节点集合内的边，避免悬挂）
    edges = []
    code_set = set(codes)
    if codes:
        rels = db.query(DeviceRelation).filter(
            DeviceRelation.from_code.in_(codes) | DeviceRelation.to_code.in_(codes)
        ).all()
        for r in rels:
            if r.from_code not in code_set or r.to_code not in code_set:
                continue
            sub = db.query(Subsystem).filter(Subsystem.id == r.subsystem_id).first() if r.subsystem_id else None
            edges.append({
                "from": r.from_code,
                "to": r.to_code,
                "type": r.relation_type,
                "kind": RELATION_LABEL_KIND.get(r.relation_type, "other"),
                "subsystem_code": sub.code if sub else None,
            })

    # 4) 聚合记录：按 子系统 → 资料表 分组
    groups = []
    if codes:
        recs = db.query(Record).filter(Record.device_code.in_(codes)).all()
        # 预取表与子系统
        table_ids = list({r.table_id for r in recs})
        tables = db.query(DataTable).filter(DataTable.id.in_(table_ids)).all() if table_ids else []
        tbl_map = {t.id: t for t in tables}
        sub_ids = list({t.subsystem_id for t in tables})
        subs = db.query(Subsystem).filter(Subsystem.id.in_(sub_ids)).all() if sub_ids else []
        sub_map = {s.id: s for s in subs}

        # 结构：subsystem_id -> table_id -> [records]
        struct: Dict[int, Dict[int, List[Record]]] = {}
        for r in recs:
            t = tbl_map.get(r.table_id)
            if not t:
                continue
            struct.setdefault(t.subsystem_id, {}).setdefault(r.table_id, []).append(r)

        for sid, tbls in struct.items():
            sub = sub_map.get(sid)
            group_tables = []
            for tid, rlist in tbls.items():
                t = tbl_map[tid]
                group_tables.append({
                    "table_id": t.id,
                    "table_code": t.code,
                    "table_name": t.name,
                    "records": [_serialize_record(db, r) for r in rlist],
                })
            # 按资料表排序
            group_tables.sort(key=lambda x: x["table_id"])
            groups.append({
                "subsystem_code": sub.code if sub else None,
                "subsystem_name": sub.name if sub else "未归类",
                "subsystem_icon": sub.icon if sub else "",
                "tables": group_tables,
            })
        groups.sort(key=lambda g: (g["subsystem_name"] or ""))

    total_records = sum(len(t["records"]) for g in groups for t in g["tables"])

    # O1：未登记设备（仅存在于 records）也应判为 found
    found = found or total_records > 0

    target_resp = None
    if target:
        target_resp = DeviceResponse.model_validate(target)
        target_resp.subsystem_name = _subsystem_name(db, target.subsystem_id)

    # ===== 扩展聚合：fixed_asset / archive / accessories / room / problems / aliases（可视化设计 C.5）=====
    canonical_code = code
    fixed_asset_block = None
    fa = db.query(FixedAsset).filter(FixedAsset.device_code == canonical_code).first()
    if fa:
        fixed_asset_block = _fa_to_dict(fa)
    archive_block = None
    da = db.query(DeviceArchive).filter(DeviceArchive.device_code == canonical_code).first()
    if da:
        archive_block = _da_to_dict(da)
    accessories = [{"name": a.name, "brand": a.brand, "spec": a.spec, "qty": a.qty,
                   "unit": a.unit, "status_name": a.status_name}
                  for a in db.query(DeviceAccessory).filter(DeviceAccessory.parent_device_code == canonical_code).all()]
    room_block = None
    room_id = target.room_id if target else None
    if room_id is None and fa is not None:
        room_id = fa.room_id
    if room_id is None and da is not None:
        room_id = da.room_id
    if room_id:
        rm = db.query(Room).filter(Room.id == room_id).first()
        if rm:
            room_block = {"room_code": rm.code, "room_name": rm.name,
                         "building": rm.building, "floor": rm.floor}
    problems = [{"ba_device_no": p.ba_device_no, "ba_system": p.ba_system,
                 "ba_system_code": p.ba_system_code, "problem_type": p.problem_type,
                 "status": p.status, "location": p.location}
                for p in db.query(BaProblem).filter(BaProblem.device_code == canonical_code).all()]
    aliases = [{"alias_code": a.alias_code, "source": a.source}
               for a in db.query(DeviceAlias).filter(DeviceAlias.canonical_code == canonical_code).all()]

    return SearchResult(
        target=target_resp,
        found=found,
        nodes=nodes,
        edges=edges,
        groups=groups,
        total_records=total_records,
        fixed_asset=fixed_asset_block,
        archive=archive_block,
        accessories=accessories,
        room=room_block,
        problems=problems,
        aliases=aliases,
    )


# ========================= P0：资产可视化接口 =========================
# 全部挂载在 /assets 下（即 /ops/api/assets），与既有接口零冲突。

@router.get("/trees/area")
def tree_area(
    building: Optional[str] = None,
    floor: Optional[str] = None,
    room_code: Optional[str] = None,
    parent: Optional[str] = None,
    area: Optional[str] = None,
    keyword: Optional[str] = None,
    only_problems: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """区域树（building→floor→room→device）懒加载。

    节点 {key,type:building|floor|room|device,label,count,has_children,meta}；
    room 节点带 room_code 与设备计数；device 节点带 device_code/status。
    """
    # 预计算：每个 room 归属的设备集合（devices / fixed_assets / device_archives 的 room_id）
    room_devices: Dict[int, set] = {}
    for d in db.query(Device.device_code, Device.room_id).filter(Device.is_active == True, Device.room_id.isnot(None)).all():
        room_devices.setdefault(d.room_id, set()).add(d.device_code)
    for fa in db.query(FixedAsset.device_code, FixedAsset.room_id).filter(FixedAsset.is_active == True, FixedAsset.room_id.isnot(None)).all():
        room_devices.setdefault(fa.room_id, set()).add(fa.device_code)
    for da in db.query(DeviceArchive.device_code, DeviceArchive.room_id).filter(DeviceArchive.is_active_del == True, DeviceArchive.room_id.isnot(None)).all():
        room_devices.setdefault(da.room_id, set()).add(da.device_code)

    problem_devices: set = set()
    if only_problems:
        for bp in db.query(BaProblem.device_code).filter(BaProblem.device_code.isnot(None)).all():
            problem_devices.add(bp.device_code)

    dev_name = {d.device_code: d.name for d in db.query(Device.device_code, Device.name).all()}

    def dev_matches(code: str) -> bool:
        if only_problems and code not in problem_devices:
            return False
        if keyword:
            nm = dev_name.get(code, "")
            if keyword not in code and keyword not in nm:
                return False
        return True

    def room_codes(rid: int) -> List[str]:
        return [c for c in room_devices.get(rid, set()) if dev_matches(c)]

    # 直接给 room_code：返回该机房设备
    if room_code and not parent:
        room = db.query(Room).filter(Room.code == room_code).first()
        if room:
            return [{
                "key": f"d:{c}", "type": "device", "label": dev_name.get(c, c),
                "count": 0, "has_children": False,
                "meta": {"device_code": c, "status": True},
            } for c in room_codes(room.id)]
        return []

    nodes = []
    if not parent:
        q = db.query(Room).filter(Room.is_active == True)
        if area:
            q = q.filter(Room.building.like(f"%{area}%"))
        if building:
            q = q.filter(Room.building == building)
        bld_count: Dict[str, int] = {}
        bld_floors: Dict[str, int] = {}
        for r in q.all():
            cnt = len(room_codes(r.id))
            if cnt == 0:
                continue
            bld_count[r.building] = bld_count.get(r.building, 0) + cnt
            bld_floors[r.building] = bld_floors.get(r.building, 0) + 1
        for b, cnt in sorted(bld_count.items()):
            nodes.append({
                "key": f"b:{b}", "type": "building", "label": b, "count": cnt,
                "has_children": True,
                "meta": {"building": b, "floor_count": bld_floors[b], "area": _classify_area(b)},
            })
        return nodes

    if parent.startswith("b:"):
        b = parent[2:]
        q = db.query(Room).filter(Room.building == b, Room.is_active == True)
        if floor:
            q = q.filter(Room.floor == floor)
        fl_count: Dict[str, int] = {}
        for r in q.all():
            fl_count[r.floor] = fl_count.get(r.floor, 0) + len(room_codes(r.id))
        for f, cnt in sorted(fl_count.items()):
            if cnt == 0:
                continue
            nodes.append({
                "key": f"f:{b}:{f}", "type": "floor", "label": f"{b} {f}", "count": cnt,
                "has_children": True, "meta": {"building": b, "floor": f},
            })
        return nodes

    if parent.startswith("f:"):
        _, b, f = parent.split(":", 2)
        rooms = db.query(Room).filter(Room.building == b, Room.floor == f, Room.is_active == True).all()
        for r in rooms:
            cnt = len(room_codes(r.id))
            if cnt == 0:
                continue
            nodes.append({
                "key": f"r:{r.code}", "type": "room", "label": r.name, "count": cnt,
                "has_children": True,
                "meta": {"room_code": r.code, "building": r.building, "floor": r.floor, "room_type": r.room_type},
            })
        return nodes

    if parent.startswith("r:"):
        rc = parent[2:]
        room = db.query(Room).filter(Room.code == rc).first()
        if room:
            for c in room_codes(room.id):
                d = db.query(Device).filter(Device.device_code == c).first()
                nodes.append({
                    "key": f"d:{c}", "type": "device", "label": dev_name.get(c, c), "count": 0,
                    "has_children": False,
                    "meta": {"device_code": c, "status": d.is_active if d else None},
                })
        return nodes

    return nodes


@router.get("/trees/subsystem")
def tree_subsystem(
    subsystem_code: Optional[str] = None,
    parent: Optional[str] = None,
    keyword: Optional[str] = None,
    only_problems: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """子系统树（subsystem → equipment_categories → device）三级懒加载。"""
    problem_devices: set = set()
    if only_problems:
        for bp in db.query(BaProblem.device_code).filter(BaProblem.device_code.isnot(None)).all():
            problem_devices.add(bp.device_code)
    dev_name = {d.device_code: d.name for d in db.query(Device.device_code, Device.name).all()}

    def dev_filter(codes: set) -> set:
        out = set(codes)
        if only_problems:
            out &= problem_devices
        if keyword:
            out = {c for c in out if keyword in c or keyword in dev_name.get(c, "")}
        return out

    nodes = []
    if not parent:
        subs = db.query(Subsystem).order_by(Subsystem.sort_order, Subsystem.id).all()
        if subsystem_code:
            subs = [s for s in subs if s.code == subsystem_code]
        for s in subs:
            cnt = db.query(Device).filter(Device.subsystem_id == s.id, Device.is_active == True).count()
            nodes.append({
                "key": f"sub:{s.code}", "type": "subsystem", "label": s.name, "count": cnt,
                "has_children": True, "meta": {"subsystem_code": s.code, "icon": s.icon},
            })
        return nodes

    if parent.startswith("sub:"):
        code = parent[4:]
        cats = db.query(EquipmentCategory).filter(EquipmentCategory.subsystem_code == code).all()
        for c in cats:
            codes = set(dc for (dc,) in db.query(Device.device_code).filter(Device.category_id == c.id, Device.is_active == True).all())
            for (dc,) in db.query(FixedAsset.device_code).filter(FixedAsset.asset_code == c.code).all():
                codes.add(dc)
            codes = dev_filter(codes)
            if not codes:
                continue
            nodes.append({
                "key": f"cat:{c.code}", "type": "category", "label": c.name or c.code, "count": len(codes),
                "has_children": True, "meta": {"category_code": c.code, "subsystem_code": code},
            })
        # 未分类设备（属于该子系统但无 category）
        sub = db.query(Subsystem).filter(Subsystem.code == code).first()
        if sub:
            uncat = set(dc for (dc,) in db.query(Device.device_code).filter(
                Device.subsystem_id == sub.id, Device.category_id.is_(None), Device.is_active == True).all())
            uncat = dev_filter(uncat)
            if uncat:
                nodes.append({
                    "key": f"cat:_uncat_{code}", "type": "category", "label": "未分类", "count": len(uncat),
                    "has_children": True, "meta": {"category_code": None, "subsystem_code": code},
                })
        return nodes

    if parent.startswith("cat:"):
        catkey = parent[4:]
        devs = []
        if catkey.startswith("_uncat_"):
            code = catkey[len("_uncat_"):]
            sub = db.query(Subsystem).filter(Subsystem.code == code).first()
            if sub:
                devs = db.query(Device).filter(Device.subsystem_id == sub.id, Device.category_id.is_(None), Device.is_active == True).all()
        else:
            cat = db.query(EquipmentCategory).filter(EquipmentCategory.code == catkey).first()
            if cat:
                devs = db.query(Device).filter(Device.category_id == cat.id, Device.is_active == True).all()
                for fa in db.query(FixedAsset).filter(FixedAsset.asset_code == cat.code).all():
                    d = db.query(Device).filter(Device.device_code == fa.device_code, Device.is_active == True).first()
                    if d:
                        devs.append(d)
        for d in devs:
            if only_problems and d.device_code not in problem_devices:
                continue
            if keyword and keyword not in d.device_code and keyword not in d.name:
                continue
            nodes.append({
                "key": f"d:{d.device_code}", "type": "device", "label": d.name, "count": 0,
                "has_children": False, "meta": {"device_code": d.device_code, "status": d.is_active},
            })
        return nodes

    return nodes


@router.get("/ba/problems")
def ba_problems(
    device_code: Optional[str] = None,
    ba_system: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """单（批）设备 BA 问题列表 + 汇总。"""
    q = db.query(BaProblem)
    if device_code:
        q = q.filter(BaProblem.device_code == device_code)
    if ba_system:
        m = db.query(BaSystemMap).filter(
            (BaSystemMap.ba_system == ba_system) | (BaSystemMap.code == ba_system)).first()
        if m:
            q = q.filter(BaProblem.ba_system_code == m.code)
        else:
            q = q.filter(BaProblem.ba_system == ba_system)
    if status:
        q = q.filter(BaProblem.status == status)
    total = q.count()
    items = q.order_by(BaProblem.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    summary = {
        "total": total,
        "open": db.query(BaProblem).filter(BaProblem.status == "open").count(),
        "processing": db.query(BaProblem).filter(BaProblem.status == "processing").count(),
        "closed": db.query(BaProblem).filter(BaProblem.status == "closed").count(),
        "unclosed": total - db.query(BaProblem).filter(BaProblem.status == "closed").count(),
    }
    return {
        "items": [{
            "id": p.id, "ba_device_no": p.ba_device_no, "device_code": p.device_code,
            "ba_system": p.ba_system, "ba_system_code": p.ba_system_code,
            "problem_type": p.problem_type, "group_area": p.group_area,
            "location": p.location, "status": p.status,
        } for p in items],
        "total": total, "page": page, "page_size": page_size, "summary": summary,
    }


@router.get("/ba/overview")
def ba_overview(
    ba_system: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """BA 设备总览统计：[{ba_system,total,normal,problem,problem_rate}]。"""
    maps = db.query(BaSystemMap).order_by(BaSystemMap.code).all()
    if ba_system:
        maps = [m for m in maps if m.code == ba_system or m.ba_system == ba_system]
    result = []
    for m in maps:
        total = db.query(DeviceArchive).filter(
            DeviceArchive.system_text == m.ba_system, DeviceArchive.is_active_del == True).count()
        problem = db.query(BaProblem).filter(BaProblem.ba_system_code == m.code).count()
        normal = max(total - problem, 0)
        rate = round(problem / total, 4) if total else 0
        result.append({
            "ba_system": m.ba_system, "ba_system_code": m.code,
            "subsystem_code": m.subsystem_code,
            "total": total, "normal": normal, "problem": problem, "problem_rate": rate,
        })
    return result


@router.get("/stats/by-subsystem-area")
def stats_by_subsystem_area(
    subsystem_code: Optional[str] = None,
    area: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """子系统×区域交叉计数矩阵：{rows:[{subsystem,area,count,amount}]}。"""
    subs = {s.id: (s.name, s.code) for s in db.query(Subsystem).all()}
    fa_map = {fa.device_code: fa for fa in db.query(FixedAsset).all()}
    da_map = {da.device_code: da for da in db.query(DeviceArchive).all()}
    agg: Dict[tuple, Dict[str, float]] = {}
    for d in db.query(Device).filter(Device.is_active == True).all():
        sname, scode = subs.get(d.subsystem_id, ("未归类", ""))
        bld = d.building
        if not bld:
            da = da_map.get(d.device_code)
            if da and da.building:
                bld = da.building
        a = _classify_area(bld)
        if area and area not in a and area not in (bld or ""):
            continue
        if subsystem_code and scode != subsystem_code:
            continue
        amount = 0.0
        fa = fa_map.get(d.device_code)
        if fa and fa.price_tax is not None:
            amount += float(fa.price_tax)
        da = da_map.get(d.device_code)
        if da and da.net_value is not None:
            amount += float(da.net_value)
        key = (sname, a)
        agg.setdefault(key, {"count": 0, "amount": 0.0})
        agg[key]["count"] += 1
        agg[key]["amount"] += amount
    rows = [{"subsystem": s, "area": a, "count": v["count"], "amount": round(v["amount"], 2)}
            for (s, a), v in agg.items()]
    rows.sort(key=lambda x: (x["subsystem"], x["area"]))
    return {"rows": rows}


# ========================= 种子数据 =========================

def seed_assets(db: Session):
    """增量初始化（幂等）：确保 7 个子系统 + 示例资料表/字段/设备/关联/记录存在。

    已确认决策（2026-07-12）：子系统扩至 7 个（补充给排水 water / 暖通 hvac）。
    重复执行安全：各实体均按唯一键 get_or_create，不会重复写入。
    """
    # ---- 关联类型字典（P1）----
    _seed_relation_types(db)

    # ---- 子系统（7 个，幂等；历史 refriger→hvac 合并，补齐 other）----
    # 历史兼容：若库中存在旧 code "refrig"，将其引用合并到 hvac（暖通）后删除，保证 7 码齐全。
    _refrig = db.query(Subsystem).filter(Subsystem.code == "refrig").first()
    _hvac = db.query(Subsystem).filter(Subsystem.code == "hvac").first()
    if _refrig is not None:
        if _hvac is None:
            _refrig.code = "hvac"
            _refrig.name = "暖通系统"
            _refrig.icon = "Fan"
            _refrig.sort_order = 3
            db.commit(); db.refresh(_refrig)
            _hvac = _refrig
        else:
            db.execute(sa_text(
                "UPDATE devices SET subsystem_id = :hvac WHERE subsystem_id = :refrig"),
                {"hvac": _hvac.id, "refrig": _refrig.id})
            db.execute(sa_text(
                "UPDATE data_tables SET subsystem_id = :hvac WHERE subsystem_id = :refrig"),
                {"hvac": _hvac.id, "refrig": _refrig.id})
            db.execute(sa_text(
                "UPDATE device_relations SET subsystem_id = :hvac WHERE subsystem_id = :refrig"),
                {"hvac": _hvac.id, "refrig": _refrig.id})
            db.delete(_refrig)
            db.commit()
            _hvac = db.query(Subsystem).filter(Subsystem.code == "hvac").first()

    subs_def = {
        "power": ("电力系统", "Zap", 1),
        "water": ("给排水系统", "Droplets", 2),
        "hvac": ("暖通系统", "Fan", 3),
        "weak": ("弱电系统", "Cable", 4),
        "fire": ("消防系统", "Flame", 5),
        "lighting": ("照明系统", "Lightbulb", 6),
        "other": ("其他系统", "Circle", 7),
    }
    subs = {}
    for code, (name, icon, so) in subs_def.items():
        s = db.query(Subsystem).filter(Subsystem.code == code).first()
        if not s:
            s = Subsystem(code=code, name=name, icon=icon, sort_order=so)
            db.add(s); db.commit(); db.refresh(s)
        subs[code] = s

    # ---- 资料表（幂等 get-or-create）----
    def add_table(sub_code, code, name, fields):
        """fields: list of (key, label, type, options, is_relation_key, is_required)"""
        t = db.query(DataTable).filter(
            DataTable.subsystem_id == subs[sub_code].id, DataTable.code == code).first()
        if not t:
            t = DataTable(subsystem_id=subs[sub_code].id, code=code, name=name,
                          sort_order=len(db.query(DataTable).filter(
                              DataTable.subsystem_id == subs[sub_code].id).all()) + 1)
            db.add(t); db.commit(); db.refresh(t)
        existing = {f.key for f in db.query(FieldDef).filter(FieldDef.table_id == t.id).all()}
        for i, f in enumerate(fields):
            key, label, ftype, options, rel, req = f
            if key in existing:
                continue
            db.add(FieldDef(table_id=t.id, key=key, label=label, type=ftype,
                            options=options or [], is_relation_key=rel, is_required=req, sort_order=i))
        db.commit()
        return t

    # 照明系统
    t_light = add_table("lighting", "lighting_fixtures", "灯具台账", [
        ("fixture_code", "灯具编号", "device_ref", [], True, True),
        ("rated_power", "额定功率", "text", [], False, False),
        ("light_source", "光源类型", "select", ["LED", "荧光", "卤素"], False, False),
        ("install_date", "安装日期", "date", [], False, False),
        ("location", "安装位置", "text", [], False, False),
    ])
    t_light_circuit = add_table("lighting", "lighting_circuits", "照明控制回路", [
        ("circuit_code", "回路编号", "device_ref", [], True, True),
        ("panel", "所属配电箱", "text", [], False, False),
        ("control_zone", "控制区域", "text", [], False, False),
        ("load", "回路负载", "text", [], False, False),
    ])
    # 电力系统
    t_power_circuit = add_table("power", "power_circuits", "配电回路", [
        ("circuit_code", "回路编号", "device_ref", [], True, True),
        ("panel", "配电柜", "text", [], False, False),
        ("cable", "电缆型号", "text", [], False, False),
        ("current", "额定电流", "text", [], False, False),
        ("length", "电缆长度", "text", [], False, False),
    ])
    t_power_panel = add_table("power", "power_panels", "配电柜", [
        ("panel_code", "配电柜编号", "device_ref", [], True, True),
        ("capacity", "容量", "text", [], False, False),
        ("incoming", "进线方式", "text", [], False, False),
    ])
    # 制冷系统
    t_ahu = add_table("hvac", "ahu", "空调风柜", [
        ("ahu_code", "风柜编号", "device_ref", [], True, True),
        ("cooling_capacity", "制冷量", "text", [], False, False),
        ("air_volume", "送风量", "text", [], False, False),
        ("supply_distance", "送风距离", "text", [], False, False),
        ("pipe_length", "管路长度", "text", [], False, False),
    ])
    t_chiller = add_table("hvac", "chillers", "冷水机组", [
        ("chiller_code", "机组编号", "device_ref", [], True, True),
        ("capacity", "制冷量", "text", [], False, False),
    ])
    # 消防系统
    t_fire_det = add_table("fire", "fire_detectors", "火灾探测器", [
        ("detector_code", "探测器编号", "device_ref", [], True, True),
        ("det_type", "类型", "select", ["烟感", "温感", "手动报警"], False, False),
        ("zone", "防区", "text", [], False, False),
    ])
    # 弱电系统
    t_cam = add_table("weak", "cameras", "摄像头", [
        ("cam_code", "摄像头编号", "device_ref", [], True, True),
        ("resolution", "分辨率", "text", [], False, False),
        ("location", "位置", "text", [], False, False),
    ])
    # 给排水系统（新增）
    t_water = add_table("water", "water_equipment", "给排水设备", [
        ("water_code", "设备编号", "device_ref", [], True, True),
        ("equip_type", "设备类型", "select", ["给水泵", "排水泵", "阀门", "水箱", "管道"], False, False),
        ("spec", "规格参数", "text", [], False, False),
        ("location", "安装位置", "text", [], False, False),
    ])
    # 暖通系统（新增）
    t_hvac = add_table("hvac", "hvac_equipment", "暖通设备", [
        ("hvac_code", "设备编号", "device_ref", [], True, True),
        ("equip_type", "设备类型", "select", ["风机盘管", "新风机组", "空调机组", "风管"], False, False),
        ("capacity", "容量/功率", "text", [], False, False),
        ("location", "安装位置", "text", [], False, False),
    ])

    # ==================== 真实台账字段（源自现场 Excel，可被 Excel 直接导入） ====================
    # 设计要点：
    #  - FieldDef.label 必须与 Excel 表头完全一致，前端 parseExcelToRecords 按 label 匹配列。
    #  - 真实列在前（保证导入 1:1 映射）；其后补充「市场同类子系统标准台账字段」（设备名称/厂家/型号/
    #    投运日期/责任人/备注等），现场可按需补全，体现“可现场继续完善”。
    #  - 关联键（is_relation_key）取各台账的主编号列，导入时自动成为 Record.device_code。

    # 供配电系统 · 电柜清单（源自《GTC和停车楼电柜清单-统计汇总.xlsx》- 原始数据）
    add_table("power", "power_cabinets", "电柜清单", [
        ("cabinet_code", "电柜编号", "device_ref", [], True, True),
        ("building", "楼栋", "select", ["GTC", "东停车楼", "西停车楼", "南停车楼", "GTC交通中心"], False, False),
        ("distribution_room", "配电房", "text", [], False, False),
        ("branch_control", "支路控制", "text", [], False, False),
        ("area", "区域", "text", [], False, False),
        ("usage_type", "用电类型", "select",
         ["一般照明（含商业、广告）", "应急照明", "空调通风动力", "D1~D3区通风空调用电",
          "公共空间备用照明", "公共空间一般照明", "动力"], False, False),
        ("cabinet_category", "电柜大类", "select", ["其他", "动力配电箱"], False, False),
        ("capacity_kw", "电容量KW", "number", [], False, False),
        ("room_no", "房间号", "text", [], False, False),
        # —— 标准扩展字段（市场同类子系统台账常用，现场按需补全）——
        ("equip_name", "设备名称", "text", [], False, False),
        ("manufacturer", "生产厂家", "text", [], False, False),
        ("model", "型号规格", "text", [], False, False),
        ("commission_date", "投运日期", "date", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # 机房/房间主数据（源自《机房信息汇总.xlsx》，被电柜与 BA 设备引用；跨系统复用）
    add_table("power", "room_master", "机房信息汇总", [
        ("room_code", "机房编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("building", "楼栋", "select", ["GTC", "东停车楼", "西停车楼", "南停车楼"], False, False),
        ("floor", "楼层", "text", [], False, False),
        ("room_name", "机房名称", "text", [], False, False),
        # —— 标准扩展字段 ——
        ("area", "面积(㎡)", "number", [], False, False),
        ("purpose", "用途", "text", [], False, False),
        ("fire_rating", "防火等级", "text", [], False, False),
        ("responsible", "责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · VRV 空调（hvac，源自《BA系统设备清单_整理汇总.xlsx》- VRV空调）
    add_table("hvac", "ba_vrv", "VRV空调", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("install_date", "安装日期", "date", [], False, False),
        ("protocol", "通讯协议", "text", [], False, False),
        ("ddc_addr", "DDC地址", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 一体化空调（hvac，源自 一体化空调）
    add_table("hvac", "ba_integrated_ac", "一体化空调", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("room", "房间", "text", [], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("install_date", "安装日期", "date", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 排风机（hvac，源自 排风机）
    add_table("hvac", "ba_exhaust_fan", "排风机", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("floor", "层", "text", [], False, False),
        ("auto_manual", "手自动", "select", ["自动", "手动", "关机"], False, False),
        ("status", "状态", "select", ["在线", "离线", "设备不在线", "正常", "故障"], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 市政排风（hvac，源自 市政排风）
    add_table("hvac", "ba_municipal_exhaust", "市政排风", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("auto_manual", "手自动", "select", ["自动", "手动", "关机"], False, False),
        ("status", "状态", "select", ["在线", "离线", "设备不在线", "正常", "故障"], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 潜污泵（water，源自 潜污泵）
    add_table("water", "ba_submersible_pump", "潜污泵", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("floor", "层", "text", [], False, False),
        ("auto_manual", "手自动", "select", ["自动", "手动", "关机"], False, False),
        ("status", "状态", "select", ["在线", "离线", "设备不在线", "正常", "故障"], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("flow_head", "流量扬程", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 一氧化碳检测（weak，源自 一氧化碳检测）
    add_table("weak", "ba_co_detection", "一氧化碳检测", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("status", "状态", "select", ["在线", "离线", "设备不在线", "正常", "故障"], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("threshold", "报警阈值", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 管廊气体监测（weak，源自 管廊气体监测）
    add_table("weak", "ba_gallery_gas", "管廊气体监测", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("group", "组别", "text", [], False, False),
        ("floor", "层", "text", [], False, False),
        ("equip_name", "设备名称", "text", [], False, False),
        ("brand", "品牌", "text", [], False, False),
        ("model", "型号", "text", [], False, False),
        ("responsible", "维护责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # BA 系统 · 问题清单（weak，源自 问题清单；device_code 取被报修的 BA 设备编号，实现“设备→问题”聚合）
    add_table("weak", "ba_issue_list", "BA问题清单", [
        ("device_code", "设备编号", "device_ref", [], True, True),
        ("seq", "序号", "number", [], False, False),
        ("subsystem", "所属系统", "text", [], False, False),
        ("group_area", "组别/区域", "text", [], False, False),
        ("location", "位置", "text", [], False, False),
        ("issue_type", "问题类型", "select",
         ["设备不在线", "离线", "故障", "数据异常", "通讯中断", "其他"], False, False),
        ("desc", "问题描述", "text", [], False, False),
        ("status", "处理状态", "select", ["待处理", "处理中", "已闭环"], False, False),
        ("responsible", "责任人", "text", [], False, False),
        ("remark", "备注", "text", [], False, False),
    ])

    # ---- 设备（幂等 get-or-create）----
    def add_device(code, name, sub_code, **kw):
        d = db.query(Device).filter(Device.device_code == code).first()
        if d:
            return d
        d = Device(device_code=code, name=name, subsystem_id=subs[sub_code].id, **kw)
        db.add(d); db.commit(); db.refresh(d)
        return d

    add_device("L-3F-A-001", "走道筒灯", "lighting", building="GTC", floor="3F", location_desc="3F-A区走道")
    add_device("CB-L-A01", "照明回路A", "power", building="GTC", floor="3F", location_desc="3F-A区")
    add_device("PD-3F-A", "3F-A区照明配电柜", "power", building="GTC", floor="3F")
    add_device("AHU-2F-01", "空调风柜2F-01", "refrig", building="GTC", floor="2F", location_desc="2F机房")
    add_device("CB-R-01", "制冷回路01", "power", building="GTC", floor="2F")
    add_device("CH-01", "冷水机组01", "refrig", building="GTC", floor="B1")
    add_device("FM-3F-A01", "烟感探测器A01", "fire", building="GTC", floor="3F", location_desc="3F-A区")
    add_device("CAM-1F-01", "摄像头1F-01", "weak", building="GTC", floor="1F", location_desc="1F大厅")
    add_device("WP-1F-01", "给水泵1F-01", "water", building="GTC", floor="1F", location_desc="1F水泵房")
    add_device("FCU-3F-01", "风机盘管3F-01", "hvac", building="GTC", floor="3F", location_desc="3F-A区")

    # ---- 关联（幂等 get-or-create；P1 方向约定：forward 边 from=上游供电方/冷源 → to=下游受电/用冷）----
    def add_rel(f, t, typ, sub_code, meta=None):
        r = db.query(DeviceRelation).filter(
            DeviceRelation.from_code == f, DeviceRelation.to_code == t,
            DeviceRelation.relation_type == typ).first()
        if r:
            return r
        r = DeviceRelation(from_code=f, to_code=t, relation_type=typ,
                           subsystem_id=subs[sub_code].id, meta=meta or {})
        db.add(r); db.commit(); db.refresh(r)
        return r

    add_rel("CB-L-A01", "L-3F-A-001", "供电", "power")        # 照明回路A → 走道筒灯
    add_rel("PD-3F-A", "CB-L-A01", "上级配电", "power")       # 配电柜 → 照明回路A
    add_rel("CB-R-01", "AHU-2F-01", "供配电", "power")        # 制冷回路01 → 空调风柜
    add_rel("CH-01", "AHU-2F-01", "冷源", "refrig", {"pipe_length": "18m"})  # 冷水机组 → 风柜
    add_rel("PD-3F-A", "FM-3F-A01", "取电", "power")          # 配电柜 → 烟感探测器
    add_rel("CB-R-01", "WP-1F-01", "供配电", "power")         # 制冷回路01 → 给水泵
    add_rel("CH-01", "FCU-3F-01", "冷源", "refrig")           # 冷水机组 → 风机盘管

    # ---- 记录（仅当该表尚无记录时写入示例）----
    def add_record_if_empty(table, data, by):
        if db.query(Record).filter(Record.table_id == table.id).count() > 0:
            return
        db.add(Record(table_id=table.id, device_code=by, data=data, created_by="系统初始化"))
        db.commit()

    add_record_if_empty(t_light, {"fixture_code": "L-3F-A-001", "rated_power": "18W", "light_source": "LED", "install_date": "2025-03", "location": "3F-A区走道"}, "L-3F-A-001")
    add_record_if_empty(t_light_circuit, {"circuit_code": "CB-L-A01", "panel": "PD-3F-A", "control_zone": "3F-A区走道", "load": "1.2kW"}, "CB-L-A01")
    add_record_if_empty(t_power_circuit, {"circuit_code": "CB-L-A01", "panel": "PD-3F-A", "cable": "ZR-YJV-3×2.5", "current": "16A", "length": "45m"}, "CB-L-A01")
    add_record_if_empty(t_power_panel, {"panel_code": "PD-3F-A", "capacity": "100A", "incoming": "市电双路"}, "PD-3F-A")
    add_record_if_empty(t_power_circuit, {"circuit_code": "CB-R-01", "panel": "PD-3F-A", "cable": "ZR-YJV-4×25", "current": "63A", "length": "60m"}, "CB-R-01")
    add_record_if_empty(t_ahu, {"ahu_code": "AHU-2F-01", "cooling_capacity": "35kW", "air_volume": "5000m³/h", "supply_distance": "25m", "pipe_length": "18m"}, "AHU-2F-01")
    add_record_if_empty(t_chiller, {"chiller_code": "CH-01", "capacity": "500kW"}, "CH-01")
    add_record_if_empty(t_fire_det, {"detector_code": "FM-3F-A01", "det_type": "烟感", "zone": "3F-A"}, "FM-3F-A01")
    add_record_if_empty(t_cam, {"cam_code": "CAM-1F-01", "resolution": "4MP", "location": "1F大厅"}, "CAM-1F-01")
    add_record_if_empty(t_water, {"water_code": "WP-1F-01", "equip_type": "给水泵", "spec": "Q=20m³/h H=32m", "location": "1F水泵房"}, "WP-1F-01")
    add_record_if_empty(t_hvac, {"hvac_code": "FCU-3F-01", "equip_type": "风机盘管", "capacity": "3.5kW", "location": "3F-A区"}, "FCU-3F-01")
    # ---- BA 子系统映射字典（7 行，幂等；一氧化碳检测/管廊气体监测 → weak）----
    ba_map_def = [
        ("ba_vrv", "VRV空调", "hvac", "空调类"),
        ("ba_integrated_ac", "一体化空调", "hvac", "空调类"),
        ("ba_co_detect", "一氧化碳检测", "weak", "气体监测传感器"),
        ("ba_muni_exhaust", "市政排风", "hvac", "通风"),
        ("ba_sub_pump", "潜污泵", "water", "水泵类"),
        ("ba_exhaust_fan", "排风机", "hvac", "通风"),
        ("ba_tunnel_gas", "管廊气体监测", "weak", "气体监测"),
    ]
    for code, name, sub_code, remark in ba_map_def:
        m = db.query(BaSystemMap).filter(BaSystemMap.code == code).first()
        if not m:
            m = BaSystemMap(code=code, ba_system=name, subsystem_code=sub_code, remark=remark)
            db.add(m)
    db.commit()

    print("[初始化] 分系统资料管理种子数据已就绪（7 子系统 / 10 设备 / 7 关联 / 11 示范记录；"
          "另含 10 张真实台账表：电柜清单/机房信息/BA-VRV/一体化空调/排风机/市政排风/潜污泵/CO检测/管廊气体/问题清单；"
          "BA 子系统映射 7 行，幂等）")


# ========================= P1：资产可视化接口（增量） =========================
# 全部挂载在 /assets 下（即 /ops/api/assets），与 P0 接口零冲突，风格对齐 P0。

@router.get("/trees/device")
def tree_device(
    parent: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """设备层级树（主设备 → 配件子树 / 配件从属子设备，逐级懒加载）。

    节点结构对齐 P0：{key,type:device|accessory,label,count,has_children,meta}。
    - 无 parent：返回「按子系统分组」的顶层主设备入口（每个子系统一个分组节点，
        meta.is_group=true，count=该子系统下主设备数）。这样根层仅个位数节点，
        避免万级设备平铺。root 口径（见 meta.root_criterion）：
        active 设备且未作为任何 `device_relations(relation_type='配件从属')` 的
        to_code 者即主设备；配件(DeviceAccessory)恒为叶节点。
    - parent=`g:<subsystem_code>`：返回该子系统下的主设备列表（type:device, is_root=true）。
    - parent=`d:<device_code>`：返回该设备的
        (1) 配件子树（device_accessories，叶节点 type:accessory），
        (2) 经 `device_relations(relation_type='配件从属')` 关联的子设备
            （type:device，可继续递归下钻）。
    """
    dev_name = {d.device_code: d.name for d in db.query(Device.device_code, Device.name).all()}
    subs = {s.id: s for s in db.query(Subsystem).order_by(Subsystem.sort_order, Subsystem.id).all()}

    def child_device_codes(code: str) -> List[str]:
        """该设备经「配件从属」关系指向的子设备编号列表（去重保序）。"""
        seen: set = set()
        out: List[str] = []
        for (tc,) in db.query(DeviceRelation.to_code).filter(
            DeviceRelation.from_code == code,
            DeviceRelation.relation_type == "配件从属",
        ).all():
            if tc not in seen:
                seen.add(tc)
                out.append(tc)
        return out

    def device_node(code: str, relation_type: Optional[str] = None, is_root: bool = False) -> Dict[str, Any]:
        kids = child_device_codes(code)
        acc_count = db.query(DeviceAccessory).filter(
            DeviceAccessory.parent_device_code == code).count()
        has = bool(kids) or acc_count > 0
        meta: Dict[str, Any] = {
            "device_code": code,
            "has_accessory": acc_count > 0,
            "sub_device_count": len(kids),
            "is_root": is_root,
        }
        if relation_type:
            meta["relation_type"] = relation_type
        if is_root:
            meta["root_criterion"] = (
                "未作为任何「配件从属」关系的子设备(to_code)，即顶层主设备；"
                "配件(DeviceAccessory)恒为叶节点，不计入 root。"
            )
        return {
            "key": f"d:{code}", "type": "device",
            "label": dev_name.get(code, code),
            "count": acc_count, "has_children": has, "meta": meta,
        }

    def accessory_node(a: "DeviceAccessory") -> Dict[str, Any]:
        return {
            "key": f"acc:{a.id}", "type": "accessory",
            "label": a.name or f"配件#{a.id}",
            "count": 0, "has_children": False,
            "meta": {
                "accessory_id": a.id,
                "parent_device_code": a.parent_device_code,
                "name": a.name, "brand": a.brand, "spec": a.spec,
                "qty": a.qty, "unit": a.unit, "status_name": a.status_name,
            },
        }

    nodes: List[Dict[str, Any]] = []

    # 「主设备」集合：active 且未作为「配件从属」关系 to_code 的设备
    sub_codes: set = set()
    for (tc,) in db.query(DeviceRelation.to_code).filter(
        DeviceRelation.relation_type == "配件从属").all():
        sub_codes.add(tc)

    if not parent:
        count_by_sub: Dict[int, int] = {}
        for d in db.query(Device).filter(Device.is_active == True).all():
            if d.device_code in sub_codes:
                continue
            count_by_sub[d.subsystem_id] = count_by_sub.get(d.subsystem_id, 0) + 1
        for s in subs.values():
            cnt = count_by_sub.get(s.id, 0)
            if cnt == 0:
                continue
            nodes.append({
                "key": f"g:{s.code}", "type": "device", "label": s.name,
                "count": cnt, "has_children": True,
                "meta": {
                    "is_group": True, "subsystem_code": s.code,
                    "root_criterion": (
                        "按子系统分组后的主设备入口；主设备=active 且未作为任何"
                        "「配件从属」关系 to_code 的设备；点击展开该子系统主设备列表。"
                    ),
                },
            })
        return nodes

    if parent.startswith("g:"):
        code = parent[2:]
        sub = db.query(Subsystem).filter(Subsystem.code == code).first()
        if not sub:
            return []
        q = db.query(Device).filter(
            Device.subsystem_id == sub.id, Device.is_active == True)
        if sub_codes:
            q = q.filter(Device.device_code.notin_(sub_codes))
        for d in q.order_by(Device.device_code).all():
            nodes.append(device_node(d.device_code, is_root=True))
        return nodes

    if parent.startswith("d:"):
        code = parent[2:]
        for a in db.query(DeviceAccessory).filter(
            DeviceAccessory.parent_device_code == code).all():
            nodes.append(accessory_node(a))
        for cc in child_device_codes(code):
            nodes.append(device_node(cc))
        return nodes

    return nodes


@router.get("/trees/ba")
def tree_ba(
    parent: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """BA 系统树（BA 系统 → 设备，逐级懒加载）。

    节点结构对齐 P0：{key,type:ba_system|ba_device,label,count,has_children,meta}。
    - 无 parent：返回 7 个 BA 系统（来自 ba_system_map），
        meta 含 ba_system_code / subsystem_code / 设备总数 / 问题数。
    - parent=`ba:<ba_system_code>`：返回该系统下设备
        （device_archives.system_text 命中该系统中文名），
        每节点带 problem_count（来自 ba_problems），type:ba_device，
        点击在终端页面打开 DeviceDetailDrawer。
    """
    if not parent:
        nodes: List[Dict[str, Any]] = []
        for m in db.query(BaSystemMap).order_by(BaSystemMap.code).all():
            total = db.query(DeviceArchive).filter(
                DeviceArchive.system_text == m.ba_system,
                DeviceArchive.is_active_del == True).count()
            problem = db.query(BaProblem).filter(
                BaProblem.ba_system_code == m.code).count()
            nodes.append({
                "key": f"ba:{m.code}", "type": "ba_system", "label": m.ba_system,
                "count": total, "has_children": True,
                "meta": {
                    "ba_system_code": m.code,
                    "subsystem_code": m.subsystem_code,
                    "device_count": total,
                    "problem_count": problem,
                },
            })
        return nodes

    if parent.startswith("ba:"):
        code = parent[3:]
        m = db.query(BaSystemMap).filter(BaSystemMap.code == code).first()
        if not m:
            return []
        nodes = []
        for da in db.query(DeviceArchive).filter(
            DeviceArchive.system_text == m.ba_system,
            DeviceArchive.is_active_del == True,
        ).order_by(DeviceArchive.device_code).all():
            pc = db.query(BaProblem).filter(
                BaProblem.device_code == da.device_code).count()
            nodes.append({
                "key": f"ba_dev:{da.device_code}", "type": "ba_device",
                "label": da.asset_name or da.old_name or da.device_code,
                "count": pc, "has_children": False,
                "meta": {
                    "device_code": da.device_code,
                    "ba_system_code": code,
                    "problem_count": pc,
                },
            })
        return nodes

    return []


@router.get("/import-batches")
def list_import_batches(
    db: Session = Depends(get_db),
    _: User = Depends(_get_current_user),
):
    """导入批次列表（按 created_at 倒序）。表为空返回 []（不 500）。

    响应字段对齐前端约定：
        id / batch_name / source_type / file_count / row_count / status / started_at / finished_at
    说明：import_batches 模型仅存 file_name / segment_name / subsystem_hint / area_hint /
        row_count / status / created_at，故按以下口径回填：
        - batch_name   ← file_name（缺省取 segment_name）
        - source_type  ← subsystem_hint（缺省取 area_hint）
        - file_count   ← 1（设计约定：每文件 = 1 条批次）
        - started/finished_at ← created_at（导入为同步过程）
    """
    rows = db.query(ImportBatch).order_by(ImportBatch.created_at.desc()).all()
    result: List[Dict[str, Any]] = []
    for b in rows:
        started = _date_to_str(b.created_at)
        batch_name = b.file_name or b.segment_name or f"批次#{b.id}"
        result.append({
            "id": b.id,
            "batch_name": batch_name,
            "source_type": b.subsystem_hint or b.area_hint or "unknown",
            "file_count": b.file_count or 1,
            "row_count": b.row_count or 0,
            "status": b.status or "done",
            "started_at": started,
            "finished_at": started,
        })
    return result


@router.get("/import/templates")
def list_import_templates(_: User = Depends(_get_current_user)):
    """返回支持导入的模板类型与说明，供前端上传页展示。"""
    return [
        {"key": k, "desc": v}
        for k, v in TEMPLATE_INFO.items()
    ]


@router.post("/import")
async def import_assets_file(
    file: UploadFile = File(...),
    source_type: Optional[str] = Form(None),
    dry_run: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_admin),
):
    """上传 Excel 并导入（支持固定资产清单 / 设备档案 / BA系统 / 机房 四种模板，自动识别）。

    - 自动识别模板（source_type 可强制指定：fixed_assets / device_archive / ba_system / rooms）。
    - dry_run=true 仅解析计数并校验，不落库（便于上传前预演）。
    - 幂等：同文件重复导入按 device_code / 主键 upsert，不产生重复行。
    - 鉴权：需 admin（本环境 AUTH_DISABLED 下自动放行）。
    """
    filename = file.filename or "upload.xlsx"
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx / .xls 文件")
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件过大（上限 50MB）")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解析 Excel：{e}")

    imported_by = "admin"
    if current_user is not None:
        imported_by = current_user.name or current_user.email or "admin"

    try:
        # dry_run 时引擎内部 rollback；非 dry_run 由引擎逐批次提交
        result = import_workbook(
            db, wb, imported_by=imported_by, source_type=source_type,
            filename=filename, dry_run=dry_run,
        )
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"导入失败：{e}")
    finally:
        wb.close()

    result["filename"] = filename
    result["dry_run"] = dry_run
    return result
