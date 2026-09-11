from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean, ForeignKey, JSON, Numeric, Date
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
    # ===== 资产模块扩展列（ALTER 一次性迁移；全部可空，不破坏旧数据）=====
    transfer_no = Column(String, index=True, default="")        # 固定资产移交编号
    asset_code = Column(String, index=True, default="")         # 资产代码
    category_id = Column(Integer, ForeignKey("equipment_categories.id"), nullable=True)  # 设备分类
    bim_tag = Column(String, default="")                        # BIM 标签
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)     # 导入批次
    old_code = Column(String, default="")                       # 设备档案改名前编号
    old_name = Column(String, default="")                      # 设备档案改名前名称
    system_text = Column(String, default="")                   # 设备档案「系统」原文
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

class RelationType(Base):
    """关联类型字典（P1 新增）：统一 relation_type 文本为受控字典。

    relation_type 列存 code（英文主键）；label 为展示中文名（供电/取电/所在机房…）。
    kind 分类：power=供配电链路（用于上游供电遍历） / cooling=冷源 /
               locate=位置归属 / control / signal / pipe / network / other。
    direction 约定（P1）：power/cooling 类 from_code=上游（供电方/冷源），
                          to_code=下游（受电方/用冷方）。历史数据见
                         scripts/normalize_relations.py 归一。
    """
    __tablename__ = "relation_types"

    code = Column(String, primary_key=True)              # power_supply / locate_in_room ...
    label = Column(String, nullable=False, unique=True, index=True)  # 中文展示名
    kind = Column(String, default="other", index=True)   # power/cooling/locate/control/signal/pipe/network/other
    direction = Column(String, default="none")           # forward(from=上游→to=下游) / none / bidirectional
    description = Column(Text, default="")
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

class DeviceRelation(Base):
    """设备关联关系图：设备间的物理/逻辑链路"""
    __tablename__ = "device_relations"

    id = Column(Integer, primary_key=True, index=True)
    from_code = Column(String, index=True, nullable=False)  # 起点 device_code
    to_code = Column(String, index=True, nullable=False)    # 终点 device_code
    # relation_type 存 relation_types.label（受控中文名，如 供电/所在机房）。
    # P1 起 create 接口经 LEGACY_RELATION_MAP 归一，不再落裸文本。
    relation_type = Column(String, default="关联")
    subsystem_id = Column(Integer, ForeignKey("subsystems.id"), nullable=True)
    meta = Column(JSON, default=dict)          # 附加属性，如回路/线径/端口/VLAN/距离
    created_at = Column(DateTime, default=datetime.now(timezone.utc))

# =====================================================================
# 资产模块新增模型（T3GTC 固定资产 / 设备档案 / BA 问题 / 字典 / 批次）
# 依据：数据库设计.md v2 + 可视化与关联设计.md B 节
# =====================================================================

class BaSystemMap(Base):
    """BA 子系统 → 7 工程子系统 映射字典（小表，admin 可改）。

    code 即 BA 子系统编码（ba_vrv 等），ba_system 为展示中文名，
    subsystem_code 必须 ∈ subsystems.code（7 个工程子系统之一）。
    """
    __tablename__ = "ba_system_map"

    code = Column(String, primary_key=True)                       # ba_vrv / ba_integrated_ac / ...
    ba_system = Column(String, nullable=False)                    # VRV空调 / 一体化空调 / ...
    subsystem_code = Column(String, ForeignKey("subsystems.code"), nullable=False)
    remark = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class EquipmentCategory(Base):
    """设备类型字典（资产名录），供 fixed_assets / devices 归类。"""
    __tablename__ = "equipment_categories"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)   # 资产代码
    name = Column(String, nullable=False)
    subsystem_code = Column(String, ForeignKey("subsystems.code"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class DeviceAlias(Base):
    """设备编号别名 → 规范 device_code 桥接表。

    任一编号（移交编号 / 资产代码 / 新设备编号 / BA 编号 / BIM 标签 / 标签号）
    均可经 alias_code 反查 canonical_code，实现跨模板统一检索。
    """
    __tablename__ = "device_aliases"

    id = Column(Integer, primary_key=True, index=True)
    canonical_code = Column(String, index=True, nullable=False)   # 规范 device_code
    alias_code = Column(String, unique=True, index=True, nullable=False)  # 别名（唯一）
    source = Column(String, default="")        # archive_old / fixed_transfer / fixed_asset / fixed_bim / fixed_tag / ba_device
    remark = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.now(timezone.utc))

class ImportBatch(Base):
    """导入批次溯源：每文件 = 1 条批次。"""
    __tablename__ = "import_batches"

    id = Column(Integer, primary_key=True, index=True)
    file_name = Column(String, default="")
    segment_name = Column(String, default="")     # 分段名（如分公司/楼栋）
    subsystem_hint = Column(String, default="")   # 子系统提示
    area_hint = Column(String, default="")        # 区域提示
    row_count = Column(Integer, default=0)
    file_count = Column(Integer, default=1)        # 每批次源文件数（设计约定 1 文件 = 1 批次）
    status = Column(String, default="done")       # done / partial / failed
    imported_by = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now(timezone.utc))

class FixedAsset(Base):
    """固定资产总账（固定资产清单模板 row4 落此）。

    device_code = 移交编号，同时作为 devices 的检索主键（1:1）。
    """
    __tablename__ = "fixed_assets"

    id = Column(Integer, primary_key=True, index=True)
    device_code = Column(String, unique=True, index=True, nullable=False)  # = 移交编号 → devices.device_code
    transfer_no = Column(String, index=True, default="")        # 移交编号
    tag_no = Column(String, default="")                        # 标签号
    owner_unit = Column(String, default="")                    # 权属单位
    use_dept = Column(String, default="")                      # 使用单位
    location = Column(String, default="")                      # 所在地点
    asset_name = Column(String, default="")                    # 资产名称
    asset_code = Column(String, ForeignKey("equipment_categories.code"), nullable=True, index=True)  # 资产代码（分类）
    brand_model = Column(String, default="")                   # 品牌型号
    serial_no = Column(String, default="")                     # 序列号
    recv_date = Column(Date, nullable=True)                    # 接收日期
    warranty_end = Column(Date, nullable=True)                 # 保修到期
    price_tax = Column(Numeric(14, 2), nullable=True)         # 含税价
    price_notax = Column(Numeric(14, 2), nullable=True)       # 不含税价
    tax = Column(Numeric(14, 2), nullable=True)               # 税额
    budget_item = Column(String, default="")                  # 预算科目
    contract_no = Column(String, default="")                  # 合同编号
    bim_tag = Column(String, default="")                      # BIM 标签
    builder = Column(String, default="")                      # 建造单位
    responsible = Column(String, default="")                  # 责任人
    proj_manager = Column(String, default="")                 # 项目经理
    warranty_contact = Column(String, default="")             # 保修联系人
    remark = Column(Text, default="")                         # 备注
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    # ===== 区域挂靠扩展（可视化与关联设计 B.3）=====
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    room_code = Column(String, index=True, nullable=True)
    room_match_method = Column(String, nullable=True)         # fk_exact / fuzzy / none
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class DeviceArchive(Base):
    """设备档案主表（设备档案模板 row2 落此），与 fixed_assets 平行挂 devices。"""
    __tablename__ = "device_archives"

    id = Column(Integer, primary_key=True, index=True)
    device_code = Column(String, unique=True, index=True, nullable=False)  # = H 新设备编号 → devices.device_code
    pre_no = Column(String, default="")                        # A 预号
    project = Column(String, default="T3GTC项目")               # B 项目
    system_text = Column(String, index=True, default="")        # C 系统（原样）
    subsystem_id = Column(Integer, ForeignKey("subsystems.id"), nullable=True)
    location = Column(String, default="")                      # D 设备区域
    building = Column(String, default="")
    floor = Column(String, default="")
    location_desc = Column(String, default="")
    old_name = Column(String, default="")                      # E 原设备名称
    asset_name = Column(String, default="")                    # F 新设备名称
    old_code = Column(String, default="")                      # G 原设备编号
    manufacturer = Column(String, default="")                  # J 设备厂家
    brand_model = Column(String, default="")                  # M 品牌 + N 规格型号
    recv_date = Column(Date, nullable=True)                    # K 设备启用日期
    qty = Column(Integer, default=1)                          # O 数量
    unit = Column(String, default="台")                         # P 单位
    kio = Column(String, default="")                          # R KIO（语义待定，原样存）
    original_value = Column(Numeric(14, 2), nullable=True)    # S 原值（含税）
    residual_rate = Column(Numeric(5, 4), nullable=True)      # T 残值率 0~1
    net_value = Column(Numeric(14, 2), nullable=True)         # U 净值
    status_name = Column(String, default="")                  # V 状态名称
    is_active = Column(Boolean, default=True)
    remark = Column(Text, default="")                         # W 备注
    template = Column(String, default="device_archive_v1")    # 模板标识
    extra = Column(JSON, default=dict)                        # 灵活兜底：未来模板列进这里
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)
    is_active_del = Column(Boolean, default=True)             # 软删除（同 devices）
    # ===== 区域挂靠扩展（可视化与关联设计 B.3）=====
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=True)
    room_code = Column(String, index=True, nullable=True)
    room_match_method = Column(String, nullable=True)         # fk_exact / fuzzy / none
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class DeviceAccessory(Base):
    """配件独立表：主设备行之后的「配件行」落入此表，与设备关联。"""
    __tablename__ = "device_accessories"

    id = Column(Integer, primary_key=True, index=True)
    parent_device_code = Column(String, ForeignKey("devices.device_code"), index=True, nullable=False)
    archive_id = Column(Integer, ForeignKey("device_archives.id"), nullable=True)
    name = Column(String, default="")                         # L 相关配件信息
    brand = Column(String, default="")                        # M 品牌
    spec = Column(String, default="")                         # N 规格型号
    qty = Column(Integer, default=1)                         # O 数量
    unit = Column(String, default="")                         # P 单位
    recv_date = Column(Date, nullable=True)                   # Q 设备启用日期
    status_name = Column(String, default="")                 # V 状态名称
    note = Column(Text, default="")
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))

class BaProblem(Base):
    """BA 问题清单落库（可视化与关联设计 B.2）。"""
    __tablename__ = "ba_problems"

    id = Column(Integer, primary_key=True, index=True)
    ba_device_no = Column(String, index=True, default="")     # BA 原始设备编号（保真）
    device_code = Column(String, ForeignKey("devices.device_code"), nullable=True, index=True)  # 经别名桥接的 canonical
    ba_system = Column(String, index=True, default="")        # BA 子系统名（VRV空调…）
    ba_system_code = Column(String, ForeignKey("ba_system_map.code"), nullable=True, index=True)  # → ba_system_map.code
    problem_type = Column(String, default="")                 # 问题类型
    group_area = Column(String, default="")                   # 组别区域
    location = Column(String, default="")                     # 位置（含房间列）
    status = Column(String, default="open")                  # open / processing / closed
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))

class DevicePhoto(Base):
    """设备现场照片（扫码补录 P0：手机拍照/相册上传，URL 落此表，按设备聚合展示）。

    与动态 records 解耦——现场核验照片具有高频查看与审计诉求，独立成表最干净；
    文件本体存 backend/uploads/assets/photos/，url 为 /ops/uploads/... 可公开访问。
    """
    __tablename__ = "device_photos"

    id = Column(Integer, primary_key=True, index=True)
    device_code = Column(String, index=True, nullable=False)  # canonical device_code
    url = Column(String, default="")                          # /ops/uploads/assets/photos/xxx.jpg
    note = Column(String, default="")                         # 拍摄说明（如“柜内铭牌”“背面接线”）
    created_by = Column(String, default="")                   # 上传人（免鉴权模式记设备名/工号）
    created_at = Column(DateTime, default=datetime.now(timezone.utc))
