"""分系统资料管理 · API 路由 + 种子数据

挂载前缀：/api/assets
核心能力：
  - 设备全局检索（输入设备编号 → 聚合该设备跨子系统全部资料 + 关联追溯）
  - 子系统 / 资料表 / 字段定义 / 记录 / 设备 / 关联 的增删查改
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text, func
from typing import Optional, List, Dict, Any
import os
from datetime import datetime, timezone

from database import (
    get_db, Subsystem, Device, DataTable, FieldDef, Record, DeviceRelation,
)
from asset_schemas import (
    SubsystemCreate, SubsystemUpdate, SubsystemResponse,
    DeviceCreate, DeviceUpdate, DeviceResponse,
    DataTableCreate, DataTableUpdate, DataTableResponse,
    FieldDefCreate, FieldDefUpdate, FieldDefResponse,
    RecordCreate, RecordUpdate, RecordResponse,
    DeviceRelationCreate, DeviceRelationUpdate, DeviceRelationResponse,
    BulkRecordCreate, BulkRecordItem,
    SearchResult,
)
from auth import decode_token
from database import User

router = APIRouter(prefix="/api/assets", tags=["assets"])

# ========================= 鉴权（与 main.py 保持一致） =========================
DEV_MODE = os.getenv("DEV_MODE", "false").lower() in ("true", "1")

from fastapi import Header

def _get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    if DEV_MODE:
        admin = db.query(User).filter(User.role == "admin").first()
        if admin:
            return admin
        admin = User(email="admin@system.local", name="开发管理员", phone="00000000000",
                     password_hash="x", role="admin")
        db.add(admin); db.commit(); db.refresh(admin)
        return admin
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    payload = decode_token(authorization[7:])
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")
    user_id = payload.get("user_id")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已被禁用，请联系管理员")
    return user

def _require_admin(current_user: User = Depends(_get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user


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
                 db: Session = Depends(get_db), _: User = Depends(_get_current_user)):
    query = db.query(Device)
    if not include_inactive:
        # 软删除（is_active=False）默认不出现在活动列表（决策 Q6：仅保留历史，不在前台展示）
        query = query.filter(Device.is_active == True)
    if subsystem_id:
        query = query.filter(Device.subsystem_id == subsystem_id)
    if q:
        like = f"%{q}%"
        query = query.filter((Device.device_code.like(like)) | (Device.name.like(like)) | (Device.location_desc.like(like)))
    rows = query.order_by(Device.device_code).limit(200).all()
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
    obj = db.query(Device).filter(Device.id == did).first()
    if not obj:
        raise HTTPException(status_code=404, detail="设备不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    obj.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(obj)
    r = DeviceResponse.model_validate(obj)
    r.subsystem_name = _subsystem_name(db, obj.subsystem_id)
    return r

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
    obj = DeviceRelation(**data.model_dump())
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
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    db.commit(); db.refresh(obj)
    return obj


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

    return SearchResult(
        target=target_resp,
        found=found,
        nodes=nodes,
        edges=edges,
        groups=groups,
        total_records=total_records,
    )


# ========================= 种子数据 =========================

def seed_assets(db: Session):
    """增量初始化（幂等）：确保 7 个子系统 + 示例资料表/字段/设备/关联/记录存在。

    已确认决策（2026-07-12）：子系统扩至 7 个（补充给排水 water / 暖通 hvac）。
    重复执行安全：各实体均按唯一键 get_or_create，不会重复写入。
    """
    # ---- 子系统（7 个，幂等）----
    subs_def = {
        "power": ("电力系统", "Zap", 1),
        "fire": ("消防系统", "Flame", 2),
        "weak": ("弱电系统", "Cable", 3),
        "refrig": ("制冷系统", "Snowflake", 4),
        "lighting": ("照明系统", "Lightbulb", 5),
        "water": ("给排水系统", "Droplets", 6),
        "hvac": ("暖通系统", "Fan", 7),
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
    t_ahu = add_table("refrig", "ahu", "空调风柜", [
        ("ahu_code", "风柜编号", "device_ref", [], True, True),
        ("cooling_capacity", "制冷量", "text", [], False, False),
        ("air_volume", "送风量", "text", [], False, False),
        ("supply_distance", "送风距离", "text", [], False, False),
        ("pipe_length", "管路长度", "text", [], False, False),
    ])
    t_chiller = add_table("refrig", "chillers", "冷水机组", [
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

    # ---- 关联（幂等 get-or-create）----
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

    add_rel("L-3F-A-001", "CB-L-A01", "供电", "power")
    add_rel("CB-L-A01", "PD-3F-A", "上级配电", "power")
    add_rel("AHU-2F-01", "CB-R-01", "供配电", "power")
    add_rel("AHU-2F-01", "CH-01", "冷源", "refrig", {"pipe_length": "18m"})
    add_rel("FM-3F-A01", "PD-3F-A", "取电", "power")
    add_rel("WP-1F-01", "CB-R-01", "供配电", "power")
    add_rel("FCU-3F-01", "CH-01", "冷源", "refrig")

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
    print("[初始化] 分系统资料管理种子数据已就绪（7 子系统 / 10 设备 / 7 关联 / 11 示范记录；"
          "另含 10 张真实台账表：电柜清单/机房信息/BA-VRV/一体化空调/排风机/市政排风/潜污泵/CO检测/管廊气体/问题清单，幂等）")
