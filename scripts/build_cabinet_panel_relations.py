r"""建关联（自动推导，幂等）：配电柜(brand_model 内嵌电柜编号) → 电柜清单(cabinet_code)。

===== 关联逻辑标记（权威规则）=====
背景：两套编号体系并存，无直接交集——
  · power_panels  「配电柜」  ：device_code = 固定资产编号（12 位数字，如 105000620819）
  · power_cabinets「电柜清单」：device_code = 系统回路码（如 G-1D1AL）
桥接字段：power_panels.brand_model 内嵌了电柜清单编号，形如 `白云电器，配电箱 G-1D1AL`。

匹配 extract(brand_model)：
  1) 按非字母数字切词得到候选 token（保留 -/ 连接，如 G-1D1APk1-1）
  2) token 本身 ∈ 电柜清单编号集合 → 精确命中
  3) 否则去尾部 -N 子号（(-\d+)+$）后 ∈ 集合 → 子号变体命中（如 G-1D1APk1-1 → G-1D1APk1）
落库：每条 (from_code=电柜编号, to_code=固定资产编号, relation_type="供配电", subsystem_id=电力)
      已存在相同 from/to/type 跳过(幂等)；from==to 或任一侧为空 → 跳过。
方向约定（forward）：from=上游供电方 → to=下游受电方；此处 from=电柜清单(回路/上游) → to=配电柜(实物/下游)。

用法：
  python build_cabinet_panel_relations.py --dry   # 只统计，不落库
  python build_cabinet_panel_relations.py         # 落库（幂等，只补新边）
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/../backend")
from database import SessionLocal, DataTable, Record, DeviceRelation, Subsystem

DRY = "--dry" in sys.argv
REL_TYPE = "供配电"          # relation_types.label（受控中文名）
CABINET_TABLE = "power_cabinets"   # 电柜清单（来源/上游）
PANEL_TABLE   = "power_panels"     # 配电柜（目标/下游）
BRIDGE_FIELD  = "brand_model"      # 桥接字段
SUBSYSTEM     = "power"

db = SessionLocal()

def t(code):
    return db.query(DataTable).filter(DataTable.code == code).first()

def tokens(s):
    return re.findall(r'[0-9A-Za-z\u4e00-\u9fff]+(?:[-/][0-9A-Za-z]+)*', s or '')

def extract(bm, codes):
    """从 brand_model 抽取命中的电柜清单编号集合（精确 + 子号变体）。"""
    hit = set()
    for tk in tokens(str(bm)):
        if tk in codes:
            hit.add(tk)
        else:
            base = re.sub(r'(-\d+)+$', '', tk)
            if base != tk and base in codes:
                hit.add(base)
    return hit

cab_tb = t(CABINET_TABLE)
pan_tb = t(PANEL_TABLE)
if cab_tb is None or pan_tb is None:
    print(f"[ERROR] 资料表缺失：{CABINET_TABLE}={cab_tb} / {PANEL_TABLE}={pan_tb}")
    db.close(); sys.exit(1)

cab_recs = db.query(Record).filter(Record.table_id == cab_tb.id).all()
pan_recs = db.query(Record).filter(Record.table_id == pan_tb.id).all()
codes = set(r.device_code for r in cab_recs if r.device_code)

sub = db.query(Subsystem).filter(Subsystem.code == SUBSYSTEM).first()
sub_id = sub.id if sub else None

stats = {"new": 0, "dup": 0, "skip": 0, "nomatch": 0}
matched_targets = set()
matched_sources = set()

for p in pan_recs:
    tgt = p.device_code
    hits = extract((p.data or {}).get(BRIDGE_FIELD, ""), codes)
    if not tgt or not hits:
        stats["nomatch"] += 1
        continue
    for src in hits:
        if not src or src == tgt:
            stats["skip"] += 1
            continue
        exists = db.query(DeviceRelation).filter(
            DeviceRelation.from_code == src,
            DeviceRelation.to_code == tgt,
            DeviceRelation.relation_type == REL_TYPE,
        ).first()
        if exists:
            stats["dup"] += 1
            matched_sources.add(src); matched_targets.add(tgt)
            continue
        stats["new"] += 1
        if not DRY:
            db.add(DeviceRelation(from_code=src, to_code=tgt,
                                  relation_type=REL_TYPE, subsystem_id=sub_id))
        matched_sources.add(src); matched_targets.add(tgt)
if not DRY:
    db.commit()

print(f"[{'DRY-RUN' if DRY else 'COMMIT'}] {CABINET_TABLE} ↔ {PANEL_TABLE}（{REL_TYPE}）关联构建：")
print(f"  新建边(new)={stats['new']}  已存在跳过(dup)={stats['dup']}  自引用/空跳过(skip)={stats['skip']}")
print(f"  未命中桥接字段的配电柜(nomatch)={stats['nomatch']}  / 总数 {len(pan_recs)}")
print(f"  覆盖：电柜清单 {len(matched_sources)}/{len(codes)}   配电柜 {len(matched_targets)}/{len(pan_recs)}")
if not DRY:
    total = db.query(DeviceRelation).count()
    print(f"  当前 device_relations 总边数={total}")
db.close()
