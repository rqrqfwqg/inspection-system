from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os

# 数据库文件路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    name = Column(String)
    password_hash = Column(String)
    department = Column(String)
    position = Column(String)
    phone = Column(String)
    avatar = Column(String, nullable=True)
    role = Column(String, default="user")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DutySchedule(Base):
    __tablename__ = "duty_schedules"
    
    id = Column(Integer, primary_key=True, index=True)
    staff_id = Column(Integer, ForeignKey("users.id"))
    staff_name = Column(String)
    department = Column(String)
    position = Column(String)
    shift_type = Column(String)
    date = Column(String)
    start_time = Column(String)
    end_time = Column(String)
    status = Column(String, default="scheduled")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ShiftTask(Base):
    __tablename__ = "shift_tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    content = Column(Text, nullable=True)
    shift = Column(String)
    date = Column(String)
    department = Column(String, nullable=True)  # 所属部门
    completed = Column(Boolean, default=False)
    completed_at = Column(DateTime, nullable=True)
    completed_by = Column(String, nullable=True)
    priority = Column(String, default="normal")
    notes = Column(Text, nullable=True)
    handover_count = Column(Integer, default=0)
    images = Column(Text, nullable=True)  # JSON字符串，存储图片路径列表
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Room(Base):
    """机房信息表（独立维护，不随计划变动）"""
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    building = Column(String, nullable=False)   # 楼栋：GTC / 东停车楼 / 西停车楼
    floor = Column(String, nullable=False)       # 楼层：负二楼 / 1F 等
    name = Column(String, nullable=False)        # 机房名称
    code = Column(String, unique=True, nullable=False, index=True)  # 机房编号（唯一）
    room_type = Column(String, nullable=False)   # 类型：高频 / 低频
    shift = Column(String, default="morning")    # 默认班次：morning / evening / both
    is_active = Column(Boolean, default=True)    # 是否启用
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InspectionRule(Base):
    """巡查规则表（控制高频/低频的生成策略）"""
    __tablename__ = "inspection_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)         # 规则名称，如"标准巡查规则"
    high_freq_days = Column(Integer, default=4)   # 高频：每 N 天巡查一轮（全部高频机房）
    low_freq_times = Column(Integer, default=2)   # 低频：每月巡查 M 次，均摊到每天
    is_active = Column(Boolean, default=True)     # 是否为当前生效规则
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InspectionPlan(Base):
    """巡查计划数据表（按年月存储，由规则+机房自动生成）"""
    __tablename__ = "inspection_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # 计划名称，如"2024年1月巡查计划"
    year = Column(Integer)   # 年份
    month = Column(Integer)  # 月份
    data = Column(Text, nullable=False)  # JSON字符串，存储完整的巡查计划数据
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
