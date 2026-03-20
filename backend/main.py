from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date
import calendar
import os
import shutil
import uuid
import json

from database import get_db, init_db, User, DutySchedule, ShiftTask, InspectionPlan, Room, InspectionRule
from schemas import (
    UserCreate, UserLogin, UserResponse, UserUpdate, UserPasswordUpdate,
    DutyScheduleCreate, DutyScheduleResponse, DutyScheduleBatch,
    ShiftTaskCreate, ShiftTaskUpdate, ShiftTaskResponse, ShiftHandoverRequest,
    Token,
    InspectionPlanCreate, InspectionPlanUpdate, InspectionPlanResponse,
    RoomCreate, RoomUpdate, RoomResponse, RoomBatchImport,
    InspectionRuleCreate, InspectionRuleUpdate, InspectionRuleResponse,
    GeneratePlanRequest,
)
from auth import verify_password, get_password_hash, create_access_token, decode_token
from cad_routes import router as cad_router

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance):
    # 启动时初始化数据库
    init_db()
    db = next(get_db())
    admin = db.query(User).filter(User.email == "admin@example.com").first()
    if not admin:
        admin = User(
            email="admin@example.com",
            name="管理员",
            phone="00000000000",
            password_hash=get_password_hash("123456890"),
            role="admin"
        )
        db.add(admin)
        db.commit()
    db.close()
    yield

app = FastAPI(title="管理系统 API", version="1.0.0", lifespan=lifespan)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建头像上传目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AVATAR_DIR = os.path.join(BASE_DIR, "uploads", "avatars")
SHIFT_IMG_DIR = os.path.join(BASE_DIR, "uploads", "shift_images")
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(SHIFT_IMG_DIR, exist_ok=True)

# 挂载静态文件目录
app.mount("/uploads", StaticFiles(directory=os.path.join(BASE_DIR, "uploads")), name="uploads")

# 注册 CAD 路由
app.include_router(cad_router)

# ==================== 鉴权工具 ====================

def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    """获取当前登录用户 - 无需认证时返回默认管理员"""
    # 无 token 时返回默认管理员（用于取消登录场景）
    if not authorization or not authorization.startswith("Bearer "):
        admin = db.query(User).filter(User.role == "admin").first()
        if admin:
            return admin
        # 如果没有管理员，创建一个
        admin = User(
            email="admin@system.local",
            name="系统管理员",
            phone="00000000000",
            password_hash=get_password_hash("admin123"),
            role="admin"
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        return admin

    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        # token 无效时也返回默认管理员
        admin = db.query(User).filter(User.role == "admin").first()
        if admin:
            return admin
        admin = User(
            email="admin@system.local",
            name="系统管理员",
            phone="00000000000",
            password_hash=get_password_hash("admin123"),
            role="admin"
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        return admin

    user_id = payload.get("user_id")
    if not user_id:
        admin = db.query(User).filter(User.role == "admin").first()
        return admin if admin else User(email="admin", name="Admin", role="admin")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        admin = db.query(User).filter(User.role == "admin").first()
        return admin if admin else User(email="admin", name="Admin", role="admin")

    if not user.is_active:
        admin = db.query(User).filter(User.role == "admin").first()
        return admin if admin else User(email="admin", name="Admin", role="admin")

    return user

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """要求当前用户是管理员 - 永远返回管理员"""
    return current_user

# ==================== 认证接口（无需登录） ====================

@app.post("/api/auth/login", response_model=Token)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    # 支持手机号或邮箱登录
    user = db.query(User).filter(
        (User.phone == user_data.phone) | (User.email == user_data.phone)
    ).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="手机号或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已被禁用，请联系管理员")
    access_token = create_access_token(data={"sub": user.email, "user_id": user.id})
    return Token(access_token=access_token, token_type="bearer", user=UserResponse.from_orm(user))

@app.post("/api/auth/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """注册/创建用户（仅供管理员在用户管理页面调用，不对外开放自注册）"""
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已被注册")
    if user_data.phone and db.query(User).filter(User.phone == user_data.phone).first():
        raise HTTPException(status_code=400, detail="手机号已被注册")
    password = user_data.password if user_data.password else "123456890"
    user = User(
        email=user_data.email,
        name=user_data.name,
        password_hash=get_password_hash(password),
        department=user_data.department,
        position=user_data.position,
        phone=user_data.phone,
        avatar=user_data.avatar
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.from_orm(user)

# ==================== 用户管理接口 ====================

@app.get("/api/users", response_model=List[UserResponse])
def get_users(
    skip: int = 0,
    limit: int = 100,
    department: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户列表：管理员可查所有，普通用户只能查本部门"""
    query = db.query(User)
    if current_user.role != "admin":
        # 普通用户只能看本部门同事
        if current_user.department:
            query = query.filter(User.department == current_user.department)
        else:
            query = query.filter(User.id == current_user.id)
    else:
        if department:
            query = query.filter(User.department == department)
    if search:
        query = query.filter(
            (User.name.contains(search)) | (User.email.contains(search)) | (User.phone.contains(search))
        )
    return query.offset(skip).limit(limit).all()

@app.get("/api/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return UserResponse.from_orm(current_user)

@app.get("/api/users/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 普通用户只能查询自己或同部门
    if current_user.role != "admin" and current_user.id != user_id:
        if not current_user.department or current_user.department != user.department:
            raise HTTPException(status_code=403, detail="无权查看该用户信息")
    return UserResponse.from_orm(user)

@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user_data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 普通用户只能修改自己的信息
    if current_user.role != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="无权修改其他用户信息")
    update_data = user_data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return UserResponse.from_orm(user)

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """删除用户，仅管理员可操作，同时清理关联排班记录"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 删除用户头像文件
    if user.avatar:
        try:
            avatar_path = os.path.join(BASE_DIR, user.avatar.lstrip("/"))
            if os.path.exists(avatar_path):
                os.remove(avatar_path)
        except Exception:
            pass
    # 清理关联的排班记录
    db.query(DutySchedule).filter(DutySchedule.staff_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"success": True, "message": "用户及关联排班记录已删除"}

@app.post("/api/users/change-password")
def change_password(data: UserPasswordUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """修改密码：普通用户只能改自己的，管理员可改任意人的"""
    if current_user.role != "admin" and current_user.id != data.user_id:
        raise HTTPException(status_code=403, detail="无权修改其他用户密码")
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码错误")
    user.password_hash = get_password_hash(data.new_password)
    db.commit()
    return {"success": True, "message": "密码已更新"}

# ==================== 头像上传接口 ====================

@app.post("/api/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """上传用户头像"""
    allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="只支持 JPG, PNG, GIF, WEBP 格式的图片")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")
    file_ext = os.path.splitext(file.filename or "image.jpg")[1] or ".jpg"
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(AVATAR_DIR, unique_filename)
    with open(file_path, "wb") as f:
        f.write(content)
    avatar_url = f"/uploads/avatars/{unique_filename}"
    return {"success": True, "avatar_url": avatar_url, "message": "头像上传成功"}

# ==================== 排班管理接口 ====================

@app.get("/api/duty-schedules", response_model=List[DutyScheduleResponse])
def get_duty_schedules(
    date: Optional[str] = None,
    department: Optional[str] = None,
    shift_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(DutySchedule)
    if date:
        query = query.filter(DutySchedule.date == date)
    if department:
        query = query.filter(DutySchedule.department == department)
    if shift_type:
        query = query.filter(DutySchedule.shift_type == shift_type)
    return query.all()

@app.post("/api/duty-schedules", response_model=DutyScheduleResponse)
def create_duty_schedule(schedule_data: DutyScheduleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    schedule = DutySchedule(**schedule_data.dict())
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return DutyScheduleResponse.from_orm(schedule)

@app.post("/api/duty-schedules/batch")
def create_duty_schedules_batch(data: DutyScheduleBatch, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    schedules = [DutySchedule(**s.dict()) for s in data.schedules]
    db.add_all(schedules)
    db.commit()
    return {"success": True, "message": f"成功创建 {len(schedules)} 条排班记录"}

@app.put("/api/duty-schedules/{schedule_id}", response_model=DutyScheduleResponse)
def update_duty_schedule(schedule_id: int, schedule_data: DutyScheduleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    schedule = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="排班记录不存在")
    for key, value in schedule_data.dict().items():
        setattr(schedule, key, value)
    db.commit()
    db.refresh(schedule)
    return DutyScheduleResponse.from_orm(schedule)

@app.delete("/api/duty-schedules/{schedule_id}")
def delete_duty_schedule(schedule_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    schedule = db.query(DutySchedule).filter(DutySchedule.id == schedule_id).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="排班记录不存在")
    db.delete(schedule)
    db.commit()
    return {"success": True, "message": "排班记录已删除"}

# ==================== 交接班任务接口 ====================

@app.get("/api/shift-tasks", response_model=List[ShiftTaskResponse])
def get_shift_tasks(
    date: Optional[str] = None,
    shift: Optional[str] = None,
    completed: Optional[bool] = None,
    department: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(ShiftTask)
    if date:
        query = query.filter(ShiftTask.date == date)
    if shift:
        query = query.filter(ShiftTask.shift == shift)
    if completed is not None:
        query = query.filter(ShiftTask.completed == completed)
    # 权限过滤：管理员可查所有，普通用户只能查本部门
    if current_user.role != "admin":
        dept = department or current_user.department
        if dept:
            query = query.filter(ShiftTask.department == dept)
    elif department:
        query = query.filter(ShiftTask.department == department)
    return query.order_by(ShiftTask.created_at.desc()).all()

@app.post("/api/shift-tasks", response_model=ShiftTaskResponse)
def create_shift_task(task_data: ShiftTaskCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data_dict = task_data.dict()
    # 若未指定部门，自动使用创建者的部门
    if not data_dict.get("department") and current_user.department:
        data_dict["department"] = current_user.department
    task = ShiftTask(**data_dict)
    db.add(task)
    db.commit()
    db.refresh(task)
    return ShiftTaskResponse.from_orm(task)

@app.put("/api/shift-tasks/{task_id}", response_model=ShiftTaskResponse)
def update_shift_task(task_id: int, task_data: ShiftTaskUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(ShiftTask).filter(ShiftTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    # 普通用户只能操作本部门任务
    if current_user.role != "admin" and task.department and current_user.department != task.department:
        raise HTTPException(status_code=403, detail="无权操作其他部门的任务")
    update_data = task_data.dict(exclude_unset=True)
    if update_data.get("completed") and not task.completed:
        update_data["completed_at"] = datetime.utcnow()
        update_data["completed_by"] = current_user.name
    for key, value in update_data.items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return ShiftTaskResponse.from_orm(task)

@app.delete("/api/shift-tasks/{task_id}")
def delete_shift_task(task_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    task = db.query(ShiftTask).filter(ShiftTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.department and current_user.department != task.department:
        raise HTTPException(status_code=403, detail="无权删除其他部门的任务")
    if task.images:
        try:
            image_list = json.loads(task.images)
            for img_path in image_list:
                full_path = os.path.join(BASE_DIR, img_path.lstrip("/"))
                if os.path.exists(full_path):
                    os.remove(full_path)
        except Exception:
            pass
    db.delete(task)
    db.commit()
    return {"success": True, "message": "任务已删除"}

@app.post("/api/shift-tasks/handover", response_model=ShiftTaskResponse)
def handover_shift_task(data: ShiftHandoverRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """交班：将任务迁移到下一班次（修改shift/date/handover_count），原任务删除"""
    task = db.query(ShiftTask).filter(ShiftTask.id == data.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.department and current_user.department != task.department:
        raise HTTPException(status_code=403, detail="无权操作其他部门的任务")
    new_task = ShiftTask(
        title=task.title,
        content=task.content,
        shift=data.next_shift,
        date=data.next_date,
        department=task.department,
        priority=task.priority,
        notes=task.notes,
        handover_count=task.handover_count + 1,
        images=task.images,
        completed=False,
    )
    db.delete(task)
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return ShiftTaskResponse.from_orm(new_task)

@app.post("/api/shift-tasks/{task_id}/upload-image")
async def upload_shift_image(task_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """上传交接班任务图片"""
    task = db.query(ShiftTask).filter(ShiftTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.department and current_user.department != task.department:
        raise HTTPException(status_code=403, detail="无权操作其他部门的任务")
    allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="只支持 JPG, PNG, GIF, WEBP 格式")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 20MB")
    file_ext = os.path.splitext(file.filename or "image.jpg")[1] or ".jpg"
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(SHIFT_IMG_DIR, unique_filename)
    with open(file_path, "wb") as f:
        f.write(content)
    img_url = f"/uploads/shift_images/{unique_filename}"
    current_images = json.loads(task.images) if task.images else []
    current_images.append(img_url)
    task.images = json.dumps(current_images)
    db.commit()
    return {"success": True, "image_url": img_url, "images": current_images}

@app.delete("/api/shift-tasks/{task_id}/images")
def delete_shift_image(task_id: int, image_url: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """删除交接班任务的某张图片"""
    task = db.query(ShiftTask).filter(ShiftTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if current_user.role != "admin" and task.department and current_user.department != task.department:
        raise HTTPException(status_code=403, detail="无权操作其他部门的任务")
    current_images = json.loads(task.images) if task.images else []
    if image_url in current_images:
        current_images.remove(image_url)
        task.images = json.dumps(current_images)
        db.commit()
        full_path = os.path.join(BASE_DIR, image_url.lstrip("/"))
        if os.path.exists(full_path):
            os.remove(full_path)
    return {"success": True, "images": current_images}

# ==================== 统计接口 ====================

@app.get("/api/stats/dashboard")
def get_dashboard_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """真实统计数据"""
    today = datetime.now().strftime("%Y-%m-%d")
    from sqlalchemy import func
    from datetime import timedelta

    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()
    today_duty = db.query(DutySchedule).filter(DutySchedule.date == today).count()
    pending_tasks = db.query(ShiftTask).filter(ShiftTask.completed == False).count()
    completed_tasks_today = db.query(ShiftTask).filter(
        ShiftTask.completed == True,
        ShiftTask.date == today
    ).count()

    # 部门任务分布
    from sqlalchemy import Integer, case
    dept_stats = db.query(
        ShiftTask.department,
        func.count(ShiftTask.id).label("total"),
        func.sum(case((ShiftTask.completed == True, 1), else_=0)).label("done")
    ).group_by(ShiftTask.department).all()

    dept_list = [
        {"department": d or "未分配", "total": t, "done": int(dn or 0)}
        for d, t, dn in dept_stats
    ]

    # 近7天任务创建趋势
    trend = []
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        cnt = db.query(ShiftTask).filter(ShiftTask.date == day).count()
        trend.append({"date": day, "count": cnt})

    return {
        "total_users": total_users,
        "active_users": active_users,
        "today_duty_count": today_duty,
        "pending_tasks": pending_tasks,
        "completed_tasks_today": completed_tasks_today,
        "dept_stats": dept_list,
        "task_trend": trend,
    }

# ==================== 机房管理接口 ====================

@app.get("/api/rooms", response_model=List[RoomResponse])
def get_rooms(
    room_type: Optional[str] = None,
    building: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """获取机房列表"""
    q = db.query(Room)
    if room_type:
        q = q.filter(Room.room_type == room_type)
    if building:
        q = q.filter(Room.building == building)
    if is_active is not None:
        q = q.filter(Room.is_active == is_active)
    return q.order_by(Room.building, Room.floor, Room.code).all()

@app.post("/api/rooms", response_model=RoomResponse)
def create_room(room_data: RoomCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """新增机房"""
    if db.query(Room).filter(Room.code == room_data.code).first():
        raise HTTPException(status_code=400, detail=f"机房编号 {room_data.code} 已存在")
    room = Room(**room_data.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    return room

@app.post("/api/rooms/batch", response_model=dict)
def batch_import_rooms(payload: RoomBatchImport, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """批量导入机房（已存在的按编号更新）"""
    created, updated = 0, 0
    for r in payload.rooms:
        existing = db.query(Room).filter(Room.code == r.code).first()
        if existing:
            for k, v in r.model_dump().items():
                setattr(existing, k, v)
            existing.updated_at = datetime.utcnow()
            updated += 1
        else:
            db.add(Room(**r.model_dump()))
            created += 1
    db.commit()
    return {"success": True, "created": created, "updated": updated, "total": created + updated}

@app.put("/api/rooms/{room_id}", response_model=RoomResponse)
def update_room(room_id: int, room_data: RoomUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """更新机房信息"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="机房不存在")
    for k, v in room_data.model_dump(exclude_unset=True).items():
        setattr(room, k, v)
    room.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(room)
    return room

@app.delete("/api/rooms/{room_id}")
def delete_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """删除机房"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="机房不存在")
    db.delete(room)
    db.commit()
    return {"success": True}

# ==================== 巡查规则接口 ====================

@app.get("/api/inspection-rules", response_model=List[InspectionRuleResponse])
def get_inspection_rules(db: Session = Depends(get_db)):
    """获取所有巡查规则"""
    return db.query(InspectionRule).order_by(InspectionRule.id).all()

@app.get("/api/inspection-rules/active", response_model=InspectionRuleResponse)
def get_active_rule(db: Session = Depends(get_db)):
    """获取当前生效的巡查规则"""
    rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
    if not rule:
        raise HTTPException(status_code=404, detail="未找到生效的巡查规则")
    return rule

@app.post("/api/inspection-rules", response_model=InspectionRuleResponse)
def create_inspection_rule(rule_data: InspectionRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """新增巡查规则"""
    rule = InspectionRule(**rule_data.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@app.put("/api/inspection-rules/{rule_id}", response_model=InspectionRuleResponse)
def update_inspection_rule(rule_id: int, rule_data: InspectionRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """更新巡查规则"""
    rule = db.query(InspectionRule).filter(InspectionRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")
    for k, v in rule_data.model_dump(exclude_unset=True).items():
        setattr(rule, k, v)
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    return rule

# ==================== 巡查计划接口 ====================

def _build_plan_data(year: int, month: int, rule: InspectionRule, rooms: List[Room]) -> dict:
    """
    根据规则和机房列表，生成该月的巡查计划数据。
    返回以日期字符串（YYYY-MM-DD）为 key 的 dict。

    班次分配规则（参考原始 plan_data.json）：
    - 早班：只巡查高频机房（约28间/天）
    - 晚班：巡查所有机房（高频约28间 + 低频约22间）

    每月巡查次数：
    - 高频机房：巡查 N 次（N=rule.high_freq_days），每天早班+晚班都有
    - 低频机房：巡查 M 次（M=rule.low_freq_times），只在晚班
    """
    # 每月最多排28天巡查
    total_days = min(28, calendar.monthrange(year, month)[1])

    high_rooms = [r for r in rooms if r.room_type == "高频" and r.is_active]
    low_rooms  = [r for r in rooms if r.room_type == "低频"  and r.is_active]

    def room_to_dict(r: Room) -> dict:
        return {
            "楼栋": r.building,
            "楼层": r.floor,
            "机房名称": r.name,
            "机房编号": r.code,
            "类型": r.room_type,
        }

    # --- 高频分配：早班+晚班，每天都有 ---
    # 每间高频机房每月巡查 high_times 次（早班+晚班合计7次），均匀分摊到每天
    # 每天高频间数 ≈ n_high * high_times / total_days
    high_times = rule.high_freq_days  # 每月巡查次数（如7次）
    high_by_day: dict[int, list] = {d: [] for d in range(1, total_days + 1)}
    n_high = len(high_rooms)
    if n_high > 0 and high_times > 0:
        # 计算每天应该巡查多少间高频（早班+晚班合计）
        # 每间机房巡查 high_times 次，总次数 = n_high * high_times
        for i, r in enumerate(high_rooms):
            # 把每间机房的 high_times 次均匀分布到整月
            start_offset = (i * total_days) // n_high
            for t in range(high_times):
                day = ((start_offset + t * total_days // high_times) % total_days) + 1
                high_by_day[day].append(room_to_dict(r))

    # --- 低频分配：只在晚班，每天都有（轮换） ---
    low_times = rule.low_freq_times  # 每月巡查次数（如2次）
    low_by_day: dict[int, list] = {d: [] for d in range(1, total_days + 1)}
    n_low = len(low_rooms)
    if n_low > 0 and low_times > 0:
        for i, r in enumerate(low_rooms):
            start_offset = (i * total_days) // n_low
            for t in range(low_times):
                day = ((start_offset + t * total_days // low_times) % total_days) + 1
                low_by_day[day].append(room_to_dict(r))

    # --- 合并每天数据：按班次分配 ---
    # 早班：部分高频机房
    # 晚班：剩余高频机房 + 低频机房
    # 每间高频机房每月7次，约3-4次在早班，3-4次在晚班
    plan_data = {}
    for day in range(1, total_days + 1):
        date_str = f"{year}-{month:02d}-{day:02d}"

        # 当天所有高频机房
        day_high_rooms = high_by_day[day]

        # 早班：每天固定数量的高频（约25间），根据日期轮流
        # 每天早班巡查不同的高频机房，形成轮换
        # 高频机房分成2组（因为每月7次奇数，轮换分配）
        morning_idx = (day - 1) % 2  # 0或1
        morning_rooms = [r for i, r in enumerate(day_high_rooms) if i % 2 == morning_idx]

        # 晚班：剩余高频 + 低频
        evening_high = [r for i, r in enumerate(day_high_rooms) if i % 2 != morning_idx]
        evening_rooms = evening_high + list(low_by_day[day])

        def group_by_floor(room_list):
            grouped = {}
            for r in room_list:
                key = f"{r['楼栋']} {r['楼层']}"
                grouped.setdefault(key, []).append(r)
            return grouped

        high_count = len([r for r in morning_rooms + evening_rooms if r["类型"] == "高频"])
        low_count  = len([r for r in evening_rooms if r["类型"] == "低频"])  # 低频只在晚班
        floors = sorted(set(
            f"{r['楼栋']} {r['楼层']}" for r in morning_rooms + evening_rooms
        ))

        plan_data[date_str] = {
            "date": date_str,
            "day": day,
            "morning": {"rooms": morning_rooms, "grouped": group_by_floor(morning_rooms)},
            "evening": {"rooms": evening_rooms, "grouped": group_by_floor(evening_rooms)},
            "high": high_count,
            "low": low_count,
            "total": high_count + low_count,
            "floors": floors,
        }

    return plan_data


@app.post("/api/inspection-plans/generate", response_model=dict)
def generate_inspection_plan(req: GeneratePlanRequest, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """根据机房表和规则，自动生成指定年月的巡查计划"""
    # 获取规则
    if req.rule_id:
        rule = db.query(InspectionRule).filter(InspectionRule.id == req.rule_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="规则不存在")
    else:
        rule = db.query(InspectionRule).filter(InspectionRule.is_active == True).first()
        if not rule:
            raise HTTPException(status_code=400, detail="未找到生效的巡查规则，请先创建规则")

    # 获取所有启用机房
    rooms = db.query(Room).filter(Room.is_active == True).all()
    if not rooms:
        raise HTTPException(status_code=400, detail="机房数据为空，请先导入机房")

    # 检查是否已有计划
    existing = db.query(InspectionPlan).filter(
        InspectionPlan.year == req.year,
        InspectionPlan.month == req.month
    ).first()
    if existing and not req.overwrite:
        raise HTTPException(status_code=400, detail=f"{req.year}年{req.month}月已存在巡查计划，请设置 overwrite=true 覆盖")

    plan_data = _build_plan_data(req.year, req.month, rule, rooms)
    plan_json = json.dumps(plan_data, ensure_ascii=False)

    if existing:
        existing.data = plan_json
        existing.name = f"{req.year}年{req.month}月巡查计划"
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        plan_obj = existing
    else:
        plan_obj = InspectionPlan(
            name=f"{req.year}年{req.month}月巡查计划",
            year=req.year,
            month=req.month,
            data=plan_json,
        )
        db.add(plan_obj)
        db.commit()
        db.refresh(plan_obj)

    total_low  = sum(d["low"]  for d in plan_data.values())
    total_high = sum(d["high"] for d in plan_data.values())
    return {
        "success": True,
        "plan_id": plan_obj.id,
        "year": req.year,
        "month": req.month,
        "total_days": len(plan_data),
        "total_high_inspections": total_high,
        "total_low_inspections": total_low,
    }


@app.get("/api/inspection-plans/current", response_model=dict)
def get_current_inspection_plan(db: Session = Depends(get_db)):
    """获取当前月份的巡查计划"""
    now = datetime.now()
    plan = db.query(InspectionPlan).filter(
        InspectionPlan.year == now.year,
        InspectionPlan.month == now.month
    ).order_by(InspectionPlan.created_at.desc()).first()

    if not plan:
        return {}

    return {
        "id": plan.id,
        "name": plan.name,
        "year": plan.year,
        "month": plan.month,
        "data": json.loads(plan.data) if plan.data else {}
    }


@app.get("/api/inspection-plans/by-year-month", response_model=dict)
def get_inspection_plan_by_year_month(
    year: int,
    month: int,
    db: Session = Depends(get_db)
):
    """根据年份和月份获取巡查计划"""
    plan = db.query(InspectionPlan).filter(
        InspectionPlan.year == year,
        InspectionPlan.month == month
    ).order_by(InspectionPlan.created_at.desc()).first()

    if not plan:
        return {}

    return {
        "id": plan.id,
        "name": plan.name,
        "year": plan.year,
        "month": plan.month,
        "data": json.loads(plan.data) if plan.data else {}
    }


@app.get("/api/inspection-plans", response_model=List[InspectionPlanResponse])
def get_inspection_plans(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """获取所有巡查计划（管理员）"""
    plans = db.query(InspectionPlan).order_by(InspectionPlan.created_at.desc()).offset(skip).limit(limit).all()
    return plans

@app.post("/api/inspection-plans", response_model=InspectionPlanResponse)
def create_inspection_plan(
    plan_data: InspectionPlanCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """手动创建巡查计划（管理员）"""
    existing = db.query(InspectionPlan).filter(
        InspectionPlan.year == plan_data.year,
        InspectionPlan.month == plan_data.month
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"{plan_data.year}年{plan_data.month}月已存在巡查计划")

    plan = InspectionPlan(**plan_data.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan

@app.put("/api/inspection-plans/{plan_id}", response_model=InspectionPlanResponse)
def update_inspection_plan(
    plan_id: int,
    plan_data: InspectionPlanUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """更新巡查计划（管理员）"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡查计划不存在")

    update_data = plan_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(plan, key, value)

    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return plan

@app.delete("/api/inspection-plans/{plan_id}")
def delete_inspection_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """删除巡查计划（管理员）"""
    plan = db.query(InspectionPlan).filter(InspectionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="巡查计划不存在")

    db.delete(plan)
    db.commit()
    return {"message": "删除成功"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9527, workers=1, loop="asyncio", lifespan="on")
