r"""建关联（自动推导，幂等）：资产台账 → 机房主表（所在机房）。

===== 关联逻辑标记（权威规则）=====
背景：全部固定资产台账（配电柜/给排水/暖通/灯具/视频/门禁/网络/消防/其他/电梯）
      的 device_code = 12 位固定资产编号，与 fixed_assets 主档 100% 同号。
      fixed_assets.room_code 已完成机房匹配（room_match_method='fuzzy'，4358 条全部精确命中
      room_master 的机房编号），因此这是一条「台账设备 → 所在机房」的稳定推导链。

数据源 ASSET_TABLES = [资料表 code, ...]（均为固定资产台账家族）
每个台账记录 device_code → 查 fixed_assets.room_code → resolve 机房编号：
  1) 精确命中 room_master.device_code → 返回
  2) 归一化 norm 命中 → 取候选；3) 带尾号优先同尾号；4) 否则取候选首个；无候选 → None(缺口)
落库：每条 (from_code=设备编号, to_code=机房编号, relation_type="所在机房", subsystem_id=来源子系统)
      已存在相同 from/to/type 跳过(幂等)；from==to 或任一侧为空 → 跳过。

用法：
  python build_asset_room_relations.py --dry   # 只统计，不落库
  python build_asset_room_relations.py         # 落库（幂等，只补新边）
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/../backend")
from database import SessionLocal, DataTable, Record, DeviceRelation, Subsystem, FixedAsset

DRY = "--dry" in sys.argv
REL_TYPE = "所在机房"

# 固定资产台账家族（device_code 与 fixed_assets 同号）
ASSET_TABLES = [
    "power_panels", "water_equipment", "hvac_equipment", "lighting_fixtures",
    "weak_cctv", "weak_access_gate", "weak_network", "fire_equipment",
    "other_equipment", "elevator_escalator",
]

db = SessionLocal()

def t(code):
    return db.query(DataTable).filter(DataTable.code == code).first()

def norm(s):
    if not s:
        return None
    s = s.strip().upper()
    s = re.sub(r'^([A-Z]+?)(\d)', r'\1-\2', s)   # GW2F -> GW-2F
    s = re.sub(r'-\d+$', '', s)                   # 去尾部 -N
    return s

# 机房主表索引
rt = t("room_master")
rooms = db.query(Record).filter(Record.table_id == rt.id).all()
room_codes = [r.device_code for r in rooms if r.device_code]
room_codeset = set(room_codes)
room_norm = {}
for rc in room_codes:
    room_norm.setdefault(norm(rc), []).append(rc)

def resolve(room_no):
    if not room_no:
        return None
    rn = room_no.strip()
    if rn in room_codeset:
        return rn
    cands = room_norm.get(norm(rn), [])
    if not cands:
        return None
    if re.search(r'-\d+$', rn):
        suffix = rn.rsplit('-', 1)[-1]
        for c in cands:
            if c.endswith('-' + suffix):
                return c
    return sorted(cands)[0]

# 主档：device_code → room_code
fa_room = {}
for f in db.query(FixedAsset).all():
    if f.device_code and f.room_code:
        fa_room[f.device_code] = f.room_code

stats = {"new": 0, "dup": 0, "skip": 0, "noroom": 0, "gap": 0}
per_table = {}

for tcode in ASSET_TABLES:
    tb = t(tcode)
    if tb is None:
        continue
    sub = db.query(Subsystem).filter(Subsystem.id == tb.subsystem_id).first()
    sub_id = sub.id if sub else None
    recs = db.query(Record).filter(Record.table_id == tb.id).all()
    tn = {"new": 0, "dup": 0, "skip": 0, "noroom": 0, "gap": 0}
    for r in recs:
        child = r.device_code
        room_no = fa_room.get(child)
        if not child or not room_no:
            tn["noroom"] += 1
            continue
        parent = resolve(room_no)
        if not parent:
            tn["gap"] += 1
            continue
        if child == parent:
            tn["skip"] += 1
            continue
        exists = db.query(DeviceRelation).filter(
            DeviceRelation.from_code == child,
            DeviceRelation.to_code == parent,
            DeviceRelation.relation_type == REL_TYPE,
        ).first()
        if exists:
            tn["dup"] += 1
            continue
        tn["new"] += 1
        if not DRY:
            db.add(DeviceRelation(from_code=child, to_code=parent,
                                  relation_type=REL_TYPE, subsystem_id=sub_id))
    if not DRY:
        db.commit()
    per_table[tcode] = (tn, len(recs))
    for k in stats:
        stats[k] += tn[k]

print(f"[{'DRY-RUN' if DRY else 'COMMIT'}] 资产台账 → 机房（{REL_TYPE}）关联构建：")
for tcode, (tn, n) in per_table.items():
    print(f"   {tcode:<22} new={tn['new']:<5} dup={tn['dup']:<5} "
          f"无主档机房={tn['noroom']:<5} 机房缺口={tn['gap']:<4} / 共{n}")
print(f"  合计：new={stats['new']}  dup={stats['dup']}  "
      f"无可推机房(noroom)={stats['noroom']}  缺口(gap)={stats['gap']}")
if not DRY:
    print(f"  当前 device_relations 总边数={db.query(DeviceRelation).count()}")
db.close()
