"""建关联（自动推导，幂等）：电柜.room_no → 机房编号；一体化空调.room → 机房编号。

===== 关联逻辑标记（权威规则，详见 docs/ASSET_MANAGEMENT_DESIGN.md C.4.1）=====
数据源 LINKS = [(来源资料表 code, 引用字段 key, 子系统 code, 关系类型), ...]
  当前仅两类：power_cabinets(room_no) + ba_integrated_ac(room) → room_master(机房编号)
归一化 norm(s)：s.strip().upper() → 字母数字间补连字符(GW2F->GW-2F) → 去尾部 -N 子序号
解析 resolve(room_no)：
  1) 精确命中机房主表 → 返回
  2) norm 命中 → 取候选；3) 带尾号者优先同尾号；4) 否则取候选首个；无候选 → None(缺口)
落库：每条 (from_code=设备编号, to_code=解析机房, relation_type, subsystem_id) 写一条边；
      已存在相同 from/to/type 跳过(幂等)；from==to 或任一侧为空 → 跳过。
---------------------------------------------------------------------------
新增类似来源：在下方 LINKS 追加一行即可，无需改其余逻辑。
缺口（resolve=None）由 scripts/export_relation_gaps.py 导出为 relation_gaps.xlsx 供现场补充。
用法：
  python build_relations.py --dry     # 只统计，不落库
  python build_relations.py           # 落库（幂等，只补新边）
"""
import sys, os, re, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/../backend")
from database import SessionLocal, DataTable, Record, DeviceRelation, Subsystem

db = SessionLocal()
DRY = "--dry" in sys.argv

def t(code):
    return db.query(DataTable).filter(DataTable.code == code).first()

def norm(s):
    if not s:
        return None
    s = s.strip().upper()
    s = re.sub(r'^([A-Z]+?)(\d)', r'\1-\2', s)   # GW2F -> GW-2F
    s = re.sub(r'-\d+$', '', s)                   # 去尾部 -N
    return s

# 机房索引
rt = t("room_master")
rooms = db.query(Record).filter(Record.table_id == rt.id).all()
room_codes = [r.device_code for r in rooms if r.device_code]
room_norm = {}   # norm_key -> [(room_code, has_suffix)]
for rc in room_codes:
    nk = norm(rc)
    room_norm.setdefault(nk, []).append(rc)

def resolve(room_no):
    if not room_no:
        return None
    rn = room_no.strip()
    if rn in room_codes:
        return rn
    nk = norm(rn)
    cands = room_norm.get(nk, [])
    if not cands:
        return None
    # 优先与 room_no 同尾号者（如 GW1F-PDF-102-1 配 GW1F-PDF-102-1）
    if re.search(r'-\d+$', rn):
        suffix = rn.rsplit('-', 1)[-1]
        for c in cands:
            if c.endswith('-' + suffix):
                return c
    return sorted(cands)[0]

def link(table_code, field, rel_type, subsystem_code, stats):
    tb = t(table_code)
    sub = db.query(Subsystem).filter(Subsystem.code == subsystem_code).first()
    sub_id = sub.id if sub else None
    recs = db.query(Record).filter(Record.table_id == tb.id).all()
    for r in recs:
        child = r.device_code
        parent = resolve(r.data.get(field))
        if not child or not parent or child == parent:
            stats["skip"] += 1
            continue
        exists = db.query(DeviceRelation).filter(
            DeviceRelation.from_code == child,
            DeviceRelation.to_code == parent,
            DeviceRelation.relation_type == rel_type,
        ).first()
        if exists:
            stats["dup"] += 1
            continue
        stats["new"] += 1
        if not DRY:
            db.add(DeviceRelation(from_code=child, to_code=parent,
                                  relation_type=rel_type, subsystem_id=sub_id))
    if not DRY:
        db.commit()

stats = {"new": 0, "dup": 0, "skip": 0}
link("power_cabinets", "room_no", "所在机房", "power", stats)
link("ba_integrated_ac", "room", "所在机房", "hvac", stats)

print(f"[{'DRY-RUN' if DRY else 'COMMIT'}] 电柜+一体化空调 → 机房 关联构建：")
print(f"  新建边(new)={stats['new']}  已存在跳过(dup)={stats['dup']}  无匹配跳过(skip)={stats['skip']}")
if not DRY:
    total = db.query(DeviceRelation).count()
    print(f"  当前 device_relations 总边数={total}")
db.close()
