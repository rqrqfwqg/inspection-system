from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, timezone
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
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


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
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


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
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


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
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class InspectionRule(Base):
    """巡查规则表（控制高频/低频的生成策略）"""
    __tablename__ = "inspection_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)         # 规则名称，如"标准巡查规则"
    high_freq_days = Column(Integer, default=4)   # 高频：每 N 天巡查一轮（全部高频机房）
    low_freq_times = Column(Integer, default=2)   # 低频：每月巡查 M 次，均摊到每天
    is_active = Column(Boolean, default=True)     # 是否为当前生效规则
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class InspectionPlan(Base):
    """巡查计划数据表（按年月存储，由规则+机房自动生成）"""
    __tablename__ = "inspection_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # 计划名称，如"2024年1月巡查计划"
    year = Column(Integer)   # 年份
    month = Column(Integer)  # 月份
    data = Column(Text, nullable=False)  # JSON字符串，存储完整的巡查计划数据
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


# =====================================================================
# 分系统资料管理模块（资产管理）
# =====================================================================

class Subsystem(Base):
    """子系统字典：电力/消防/弱电/制冷/照明（可维护）"""
    __tablename__ = "subsystems"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)  # power/fire/weak/refrig/lighting
    name = Column(String, nullable=False)
    icon = Column(String, default="")          # 图标标识（lucide 名称）
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class Device(Base):
    """设备主表 / 全局设备台账（检索主键 = device_code）"""
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    device_code = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    subsystem_id = Column(Integer, ForeignKey("subsystems.id"), nullable=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)  # 所在机房（复用 rooms）
    building = Column(String, default="")
    floor = Column(String, default="")
    location_desc = Column(String, default="")          # 位置描述
    parent_device_id = Column(Integer, nullable=True)   # 设备层级（如回路→配电柜）
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class DataTable(Base):
    """资料表元数据：每个子系统下的一张或多张资料表"""
    __tablename__ = "data_tables"

    id = Column(Integer, primary_key=True, index=True)
    subsystem_id = Column(Integer, ForeignKey("subsystems.id"), nullable=False)
    code = Column(String, nullable=False)   # 表标识，如 lighting_fixtures
    name = Column(String, nullable=False)   # 中文名，如"灯具台账"
    description = Column(String, default="")
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class FieldDef(Base):
    """字段定义（动态字段）：每张资料表的列由它定义，非硬编码"""
    __tablename__ = "field_defs"

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("data_tables.id"), nullable=False)
    key = Column(String, nullable=False)     # 字段标识，如 rated_power
    label = Column(String, nullable=False)   # 显示名，如"额定功率"
    type = Column(String, default="text")    # text/number/date/select/device_ref
    options = Column(JSON, default=list)      # select 的可选项列表
    is_required = Column(Boolean, default=False)
    is_relation_key = Column(Boolean, default=False)  # 关联键：值为 device_code，记录据此挂载到设备
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class Record(Base):
    """资料记录：字段值存 JSON（{key: value}）"""
    __tablename__ = "records"

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("data_tables.id"), nullable=False)
    device_code = Column(String, index=True, default="")  # 冗余索引列，加速聚合（由关联键填充）
    data = Column(JSON, default=dict)        # 动态字段值
    created_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))


class DeviceRelation(Base):
    """设备关联关系图：设备间的物理/逻辑链路"""
    __tablename__ = "device_relations"

    id = Column(Integer, primary_key=True, index=True)
    from_code = Column(String, index=True, nullable=False)  # 起点 device_code
    to_code = Column(String, index=True, nullable=False)    # 终点 device_code
    relation_type = Column(String, default="关联")  # 供电/控制/管路连接/送风/信号
    subsystem_id = Column(Integer, ForeignKey("subsystems.id"), nullable=True)
    meta = Column(JSON, default=dict)          # 附加属性，如距离/长度/线径
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
