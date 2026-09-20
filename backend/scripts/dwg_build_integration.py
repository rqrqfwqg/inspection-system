# -*- coding: utf-8 -*-
"""把 T3GTC 图纸分析的全部产物整合成一套以「回路编号 / 配电箱编码」为主键的关联数据集。

输出：C:/tmp/integ/pack.json  —— {tables:[{code,name,fields:[...],records:[{device_code,data}]}]}
"""
import io, json, os, re, csv, collections

W = "C:/Users/yan/WorkBuddy/2026-05-21-13-28-45"
OUT = "C:/tmp/integ"
os.makedirs(OUT, exist_ok=True)


def load_json(p):
    raw = io.open(p, encoding="utf-8").read()
    try:
        return json.loads(raw)
    except Exception:
        # TAT 输出尾部会附加 "# 返回 N 行" 等文本 → 截取首尾括号之间的 JSON
        i, j = raw.find("["), raw.rfind("]")
        if i < 0 or j <= i:
            raise
        return json.loads(raw[i:j + 1])


def rows(path, enc="utf-8-sig"):
    with io.open(path, encoding=enc, newline="") as f:
        return list(csv.DictReader(f))


def s(v):
    """转字符串并去空白"""
    if v is None:
        return ""
    return str(v).strip()


# ======================= 读入原始数据 =======================
sysd = load_json("C:/tmp/sys/sys_data.json")
xc = load_json("C:/tmp/sys/xcheck3.json")
circ2 = load_json("C:/tmp/circuits2.json")
led_p = load_json("C:/tmp/led_p_0.json")[0]["f"]      # "1N1-1>EP-1AD1AL,EP-1D1AL;..."
led_b = load_json("C:/tmp/led_b.json")[0]["f"]
online_boxes = set(load_json("C:/tmp/online_box_codes.json"))

# 台账：回路编号 -> 电柜编号集合
led_cab = collections.defaultdict(set)
for txt in (led_p, led_b):
    for part in s(txt).split(";"):
        if ">" not in part:
            continue
        code, cabs = part.split(">", 1)
        for c in cabs.split(","):
            if s(c):
                led_cab[s(code)].add(s(c))

# 平面图：回路编号 -> 出现楼层集合（只取 10 个正式楼层，排除 .bak/旧版条目）
OFFICIAL_FLOORS = {
    "交通中心-首层", "交通中心-二层", "交通中心-13.5m", "交通中心-地下一层", "交通中心-地下二层",
    "停车楼-首层夹层", "停车楼-首层", "停车楼-二层", "停车楼-地下一层", "停车楼-地下二层",
}
circ2 = [b for b in circ2 if s(b.get("tag")) in OFFICIAL_FLOORS]
flat_floor = collections.defaultdict(set)
for blk in circ2:
    tag = s(blk.get("tag"))
    for c in blk.get("circs", []):
        for t in c.get("tokens", []):
            flat_floor[s(t)].add(tag)

# 系统图：回路编号 -> 数据（取字段最全的一条）
sys_by_code = {}
for c in sysd["circuits"]:
    code = s(c.get("circuit"))
    if not code:
        continue
    prev = sys_by_code.get(code)
    if prev is None or len([1 for k in ("section", "model", "source") if s(c.get(k))]) > \
            len([1 for k in ("section", "model", "source") if s(prev.get(k))]):
        sys_by_code[code] = c

# 主备配对
dual_of = {}
for p in sysd["dual_pairs"]:
    m, b = s(p.get("main")), s(p.get("backup"))
    if m and b:
        dual_of[m] = b
        dual_of[b] = m

# 回路编号全集
all_codes = sorted(set(xc["sys"]) | set(xc["flat"]) | set(xc["led"]))
print("回路编号全集:", len(all_codes))

# ======================= 表 1：变电所 =======================
SUB_ORDER = ["G-B 交通中心", "EP-B 东停车楼", "SP-B 南停车楼", "WP-B 西停车楼"]
sub_stat = {}
for v in SUB_ORDER:
    sub_stat[v] = {
        "trafo": [t for t in sysd["trafos"] if s(t.get("var")) == v],
        "panel": [p for p in sysd["panels"] if s(p.get("var")) == v],
        "circ": [c for c in sysd["circuits"] if s(c.get("var")) == v],
        "riser": [r for r in sysd["risers"] if s(r.get("var")) == v],
    }
    boxset = set()
    for r in sub_stat[v]["riser"]:
        boxset.update(s(b) for b in r.get("boxes", []) if s(b))
    sub_stat[v]["boxes"] = boxset

# 干线箱按变电所归属
riser_box_owner = {}
for r in sysd["risers"]:
    for b in r.get("boxes", []):
        b = s(b)
        if b and b not in riser_box_owner:
            riser_box_owner[b] = s(r.get("var"))

t_substation = {
    "code": "elec_substation",
    "name": "变电所",
    "desc": "T3 GTC 四个变电所及容量汇总（源：变电所系统图）",
    "fields": [
        ("substation_code", "变电所编号", "text"),
        ("name", "变电所名称", "text"),
        ("transformer_count", "变压器台数", "number"),
        ("capacity_kva", "总装机容量(kVA)", "number"),
        ("panel_groups", "低压配电屏组数", "number"),
        ("panel_count", "低压配电屏面数", "number"),
        ("riser_box_count", "竖向干线配电箱数", "number"),
        ("circuit_count", "配电回路数", "number"),
        ("dual_count", "双电源点位组数", "number"),
    ],
    "records": [],
}
for v in SUB_ORDER:
    st = sub_stat[v]
    code = v.split()[0]
    cap = sum(int(s(t.get("kva")) or 0) for t in st["trafo"])
    panels = sum(int(s(p.get("n")) or 0) for p in st["panel"])
    du = len([p for p in sysd["dual_pairs"] if s(p.get("var")) == v])
    t_substation["records"].append({
        "device_code": code,
        "data": {
            "substation_code": code,
            "name": v.split(" ", 1)[-1] if " " in v else v,
            "transformer_count": len(st["trafo"]),
            "capacity_kva": cap,
            "panel_groups": len(st["panel"]),
            "panel_count": panels,
            "riser_box_count": len(st["boxes"]),
            "circuit_count": len(st["circ"]),
            "dual_count": du,
        },
    })

# ======================= 表 2：变压器 =======================
t_trafo = {
    "code": "elec_transformer",
    "name": "变电所-变压器",
    "desc": "12 台变压器明细（源：变电所系统图）",
    "fields": [("trafo_code", "变压器编号", "text"), ("substation", "所属变电所", "text"),
               ("capacity_kva", "容量(kVA)", "number"), ("note", "备注", "text")],
    "records": [],
}
for t in sysd["trafos"]:
    code = s(t.get("code"))
    if not code:
        continue
    t_trafo["records"].append({"device_code": code, "data": {
        "trafo_code": code, "substation": s(t.get("var")),
        "capacity_kva": int(t.get("cap_kVA") or 0), "note": s(t.get("note"))}})

# ======================= 表 3：低压配电屏 =======================
t_panel = {
    "code": "elec_lv_panel",
    "name": "变电所-低压配电屏",
    "desc": "低压配电屏组（起止屏 / 面数）（源：变电所系统图）",
    "fields": [("panel_group", "屏组", "text"), ("substation", "所属变电所", "text"),
               ("panel_from", "起始屏", "text"), ("panel_to", "终止屏", "text"),
               ("panel_count", "屏数", "number")],
    "records": [],
}
SUB_ABBR = {"G-B 交通中心": "G-B", "EP-B 东停车楼": "EP-B",
            "SP-B 南停车楼": "SP-B", "WP-B 西停车楼": "WP-B"}
# 同一屏组在系统图中被多次识别 → 按 (变电所,起始屏,终止屏) 去重
_pseen = {}
for p in sysd["panels"]:
    a, b = s(p.get("panel")), s(p.get("to"))
    if not (a or b):
        continue
    var = s(p.get("var"))
    _pseen[(var, a, b)] = int(p.get("count") or 0)
for (var, a, b), cnt in _pseen.items():
    t_panel["records"].append({"device_code": "%s-%s" % (SUB_ABBR.get(var, var), a or b), "data": {
        "panel_group": "%s~%s" % (a, b), "substation": var,
        "panel_from": a, "panel_to": b, "panel_count": cnt}})

# ======================= 表 4：配电回路台账（核心） =======================
t_circ = {
    "code": "elec_circuit",
    "name": "配电回路台账",
    "desc": "以回路编号为主键，整合变电所系统图 + 楼层平面图 + 电柜台账三方数据（★关联核心表）",
    "fields": [
        ("circuit_code", "回路编号", "text"),
        ("substation", "所属变电所", "text"),
        ("role", "供电角色", "select"),
        ("dual_counterpart", "双电源对侧回路", "text"),
        ("cable_model", "电缆型号", "text"),
        ("cable_section", "电缆截面", "text"),
        ("voltage", "电压等级", "text"),
        ("laying", "敷设方式", "text"),
        ("pn_kw", "设备容量Pn(kW)", "number"),
        ("pc_kw", "计算容量Pc(kW)", "number"),
        ("cos_phi", "功率因数", "number"),
        ("ic_a", "计算电流(A)", "number"),
        ("power_source", "电源来源", "text"),
        ("sys_diagram", "所属系统图", "text"),
        ("in_sys_diagram", "系统图收录", "text"),
        ("in_floor_plan", "平面图收录", "text"),
        ("in_ledger", "电柜台账收录", "text"),
        ("floor_labels", "平面图出现楼层", "text"),
        ("ledger_cabinets", "对应电柜编号", "text"),
        ("verify_result", "三方核对结论", "text"),
    ],
    "records": [],
}
only_flat = set(xc["only_flat"])
ledger_missing = set(xc["ledger_missing"])
only_led = set(xc["only_led"])
for code in all_codes:
    c = sys_by_code.get(code) or {}
    ins, inf, inl = code in set(xc["sys"]), code in set(xc["flat"]), code in set(xc["led"])
    if ins and inf and inl:
        verdict = "三方一致"
    elif ins and inl:
        verdict = "系统图×台账一致（平面图未标）"
    elif inf and inl:
        verdict = "平面图×台账一致（系统图未含）"
    elif inl:
        verdict = "仅台账有（疑似笔误）"
    elif inf:
        verdict = "仅图纸有（台账缺项候选）"
    else:
        verdict = "仅系统图有"
    t_circ["records"].append({"device_code": code, "data": {
        "circuit_code": code,
        "substation": s(c.get("var")),
        "role": s(c.get("role")),
        "dual_counterpart": dual_of.get(code, ""),
        "cable_model": s(c.get("model")),
        "cable_section": s(c.get("section")),
        "voltage": s(c.get("kv")),
        "laying": s(c.get("laying")),
        "pn_kw": c.get("pn_kW") or "",
        "pc_kw": c.get("pc_kW") or "",
        "cos_phi": c.get("cos") or "",
        "ic_a": c.get("ic_A") or "",
        "power_source": s(c.get("source")),
        "sys_diagram": s(c.get("subsys")),
        "in_sys_diagram": "√" if ins else "",
        "in_floor_plan": "√" if inf else "",
        "in_ledger": "√" if inl else "",
        "floor_labels": "、".join(sorted(flat_floor.get(code, []))),
        "ledger_cabinets": "、".join(sorted(led_cab.get(code, []))),
        "verify_result": verdict,
    }})

# ======================= 表 5：双电源主备点位 =======================
seen_dual = set()
t_dual = {
    "code": "elec_dual_point",
    "name": "双电源主备点位",
    "desc": "主供/备供回路配对（源：变电所系统图，图上直接标注「主供」「备供」）",
    "fields": [("main_circuit", "主供回路", "text"), ("backup_circuit", "备供回路", "text"),
               ("substation", "所属变电所", "text"), ("cable_section", "电缆截面", "text"),
               ("pn_kw", "设备容量Pn(kW)", "number"), ("pc_kw", "计算容量Pc(kW)", "number"),
               ("power_source", "电源来源", "text"), ("sys_diagram", "所属系统图", "text")],
    "records": [],
}
for p in sysd["dual_pairs"]:
    m, b = s(p.get("main")), s(p.get("backup"))
    if not m or not b:
        continue
    key = (m, b)
    if key in seen_dual:
        continue
    seen_dual.add(key)
    mc = sys_by_code.get(m) or {}
    t_dual["records"].append({"device_code": m, "data": {
        "main_circuit": m, "backup_circuit": b, "substation": s(p.get("var")),
        "cable_section": s(mc.get("section")), "pn_kw": mc.get("pn_kW") or "",
        "pc_kw": mc.get("pc_kW") or "", "power_source": s(mc.get("source")),
        "sys_diagram": s(mc.get("subsys"))}})

# ======================= 表 6：竖向干线配电箱 =======================
t_riser = {
    "code": "elec_riser_box",
    "name": "竖向干线配电箱",
    "desc": "各变电所竖向配电干线上的配电箱（源：竖向配电干线系统图）",
    "fields": [("box_code", "干线箱编码", "text"), ("substation", "所属变电所", "text"),
               ("riser_zones", "所属强电井/分区", "text"), ("load_types", "负荷类型", "text"),
               ("capacities", "安装容量", "text"), ("upstream_circuits", "上级回路编号", "text"),
               ("in_ledger", "资产台账已登记", "text"), ("devices_on_floor", "图纸设备数", "text")],
    "records": [],
}
# 干线箱 -> 强电井/分区、负荷、容量
box_zone = collections.defaultdict(set)
box_load = collections.defaultdict(set)
box_cap = collections.defaultdict(set)
for r in sysd["risers"]:
    zones = " / ".join(s(x) for x in r.get("labels", []) if s(x))
    for i, b in enumerate(r.get("boxes", [])):
        b = s(b)
        if not b:
            continue
        if zones:
            box_zone[b].add(zones)
        loads = r.get("loads", [])
        if loads:
            box_load[b].update(s(x) for x in loads if s(x))
        caps = r.get("caps", [])
        if caps:
            box_cap[b].update(s(x) for x in caps if s(x))
# 箱 -> 上级回路（来自平面图关系表）
box2circ = collections.defaultdict(set)
for r in rows(W + "/T3GTC配电箱_抽屉柜回路关系.csv"):
    b = s(r.get("所属箱编码"))
    if b:
        for c in s(r.get("上级抽屉柜回路(展开)")).split(";"):
            if s(c):
                box2circ[b].add(s(c))
# 箱 -> 图纸设备数
box_dev_n = collections.Counter()
for r in rows("C:/tmp/real/all_equipment.csv"):
    b = s(r.get("所属箱编码"))
    if b:
        box_dev_n[b] += 1
all_riser_boxes = sorted(riser_box_owner.keys())
for b in all_riser_boxes:
    t_riser["records"].append({"device_code": b, "data": {
        "box_code": b, "substation": riser_box_owner.get(b, ""),
        "riser_zones": " ；".join(sorted(box_zone.get(b, []))[:3]),
        "load_types": "、".join(sorted(box_load.get(b, []))[:8]),
        "capacities": " / ".join(sorted(box_cap.get(b, []))[:8]),
        "upstream_circuits": "、".join(sorted(box2circ.get(b, []))),
        "in_ledger": "√" if b in online_boxes else "",
        "devices_on_floor": box_dev_n.get(b, 0)}})

# ======================= 表 7：竖向干线负荷 =======================
t_load = {
    "code": "elec_riser_load",
    "name": "竖向干线负荷",
    "desc": "竖向干线各列（强电井/分区）的负荷类型与安装容量（源：竖向配电干线系统图）",
    "fields": [("substation", "所属变电所", "text"), ("column_x", "图面列坐标", "text"),
               ("zone_label", "强电井/分区", "text"), ("load_types", "负荷类型", "text"),
               ("capacity_text", "安装容量", "text")],
    "records": [],
}
for i, r in enumerate(sysd["risers"]):
    t_load["records"].append({"device_code": "RISER-%02d" % (i + 1), "data": {
        "substation": s(r.get("var")), "column_x": ("%.0f" % r["x"]) if r.get("x") else "",
        "zone_label": " / ".join(s(x) for x in r.get("labels", []) if s(x)),
        "load_types": " / ".join(s(x) for x in r.get("loads", []) if s(x)),
        "capacity_text": " / ".join(s(x) for x in r.get("caps", []) if s(x))}})

# ======================= 表 8：配电箱 → 上级抽屉柜回路 =======================
t_boxcirc = {
    "code": "elec_box_circuit",
    "name": "配电箱→上级抽屉柜回路",
    "desc": "平面图上配电箱旁标注的上级变电房抽屉柜回路编号（源：楼层动力配电平面图）",
    "fields": [("box_code", "配电箱编码", "text"), ("building", "楼栋", "text"),
               ("floor", "所在楼层", "text"), ("upstream_circuits", "上级抽屉柜回路", "text"),
               ("original_note", "图上原注", "text"), ("distance", "图面距离", "number"),
               ("confidence", "可信度", "select"),
               ("circuit_substation", "回路所属变电所", "text"),
               ("in_ledger", "资产台账已登记", "text"),
               ("ledger_devices", "台账已登记设备", "text")],
    "records": [],
}
for r in rows(W + "/T3GTC配电箱_抽屉柜回路关系.csv"):
    b = s(r.get("所属箱编码"))
    if not b:
        continue
    circs = [s(x) for x in s(r.get("上级抽屉柜回路(展开)")).split(";") if s(x)]
    subs = sorted({s((sys_by_code.get(c) or {}).get("var")) for c in circs} - {""})
    t_boxcirc["records"].append({"device_code": b, "data": {
        "box_code": b, "building": s(r.get("楼栋")), "floor": s(r.get("所在楼层")),
        "upstream_circuits": "、".join(circs), "original_note": s(r.get("图上原注")),
        "distance": int(float(s(r.get("最近距离")) or 0)), "confidence": s(r.get("可信度")),
        "circuit_substation": "、".join(subs), "in_ledger": "√" if b in online_boxes else "",
        "ledger_devices": "√" if b in online_boxes else ""}})

# ======================= 表 9：楼层配电设备 =======================
t_dev = {
    "code": "elec_floor_device",
    "name": "楼层配电设备",
    "desc": "10 个楼层平面图提取的现场设备（含所属箱编码，可据此关联回路与台账）（源：动力配电平面图）",
    "fields": [("floor", "楼层", "text"), ("building", "楼栋", "text"),
               ("device_type", "设备类型", "select"), ("box_code", "所属箱编码", "text"),
               ("x", "图面X坐标", "number"), ("y", "图面Y坐标", "number"),
               ("nearby_room", "就近机房", "text"), ("upstream_circuits", "上级回路编号", "text"),
               ("in_ledger", "资产台账已登记", "text")],
    "records": [],
}
FLOOR_BUILDING = {
    "交通中心-首层": "交通中心", "交通中心-二层": "交通中心", "交通中心-13.5m": "交通中心",
    "交通中心-地下一层": "交通中心", "交通中心-地下二层": "交通中心",
    "停车楼-首层夹层": "停车楼", "停车楼-首层": "停车楼", "停车楼-二层": "停车楼",
    "停车楼-地下一层": "停车楼", "停车楼-地下二层": "停车楼",
}
FLOOR_ABBR = {"交通中心-首层": "TC1F", "交通中心-二层": "TC2F", "交通中心-13.5m": "TC135",
              "交通中心-地下一层": "TCB1", "交通中心-地下二层": "TCB2",
              "停车楼-首层夹层": "PK1A", "停车楼-首层": "PK1F", "停车楼-二层": "PK2F",
              "停车楼-地下一层": "PKB1", "停车楼-地下二层": "PKB2"}
seq = collections.Counter()
for r in rows("C:/tmp/real/all_equipment.csv"):
    fl = s(r.get("楼层"))
    b = s(r.get("所属箱编码"))
    seq[fl] += 1
    dev_code = b if b else "ELEC-%s-%04d" % (FLOOR_ABBR.get(fl, "XX"), seq[fl])
    cur = "、".join(sorted(box2circ.get(b, [])))
    t_dev["records"].append({"device_code": dev_code, "data": {
        "floor": fl, "building": FLOOR_BUILDING.get(fl, ""), "device_type": s(r.get("设备类型")),
        "box_code": b, "x": r.get("x") or "", "y": r.get("y") or "",
        "nearby_room": s(r.get("就近房间")), "upstream_circuits": cur,
        "in_ledger": "√" if b in online_boxes else ""}})

# ======================= 表 10：回路标注明细 =======================
t_label = {
    "code": "elec_circuit_label",
    "name": "回路标注明细",
    "desc": "楼层平面图上逐条回路标注（图上原文 + 展开后的回路编号 + 就近配电箱）（源：动力配电平面图）",
    "fields": [("floor", "楼层", "text"), ("building", "楼栋", "text"),
               ("label_text", "图上标注", "text"), ("circuits", "展开回路编号", "text"),
               ("nearby_box", "就近配电箱", "text"), ("distance", "图面距离", "number")],
    "records": [],
}
n = 0
for blk in circ2:
    tag = s(blk.get("tag"))
    for c in blk.get("circs", []):
        n += 1
        toks = [s(t) for t in c.get("tokens", []) if s(t)]
        t_label["records"].append({"device_code": "LBL-%s-%04d" % (FLOOR_ABBR.get(tag, "XX"), n), "data": {
            "floor": tag, "building": FLOOR_BUILDING.get(tag, ""), "label_text": s(c.get("text")),
            "circuits": "、".join(toks), "nearby_box": s(c.get("box_code")),
            "distance": int(c.get("dist") or 0)}})

# ======================= 组装输出 =======================
TABLES = [t_substation, t_trafo, t_panel, t_circ, t_dual, t_riser, t_load, t_boxcirc, t_dev, t_label]

# 字段去重校验
for t in TABLES:
    keys = [f[0] for f in t["fields"]]
    assert len(keys) == len(set(keys)), (t["code"], keys)
    # 记录里只保留已定义字段
    ks = set(keys)
    for r in t["records"]:
        for k in list(r["data"].keys()):
            if k not in ks:
                del r["data"][k]

pack = {"subsystem": {"code": "elec_dwg", "name": "电气配电（图纸提取）", "sort_order": 10},
        "tables": TABLES}
json.dump(pack, io.open(OUT + "/pack.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("\n=== 整合数据集 ===")
tot = 0
for t in TABLES:
    codes = [r["device_code"] for r in t["records"]]
    dup = len(codes) - len(set(codes))
    tot += len(t["records"])
    print("  %-20s %-22s 字段%2d 记录%5d 唯一键%5d 重复键%4d" %
          (t["code"], t["name"], len(t["fields"]), len(t["records"]), len(set(codes)), dup))
print("  合计记录:", tot)
print("  pack.json:", os.path.getsize(OUT + "/pack.json"), "bytes")

# 关联统计
print("\n=== 关联覆盖 ===")
print("  回路编号全集:", len(all_codes), "（三方一致 %d）" % len(xc["all3"]))
print("  图纸箱编码:", len(json.load(io.open("C:/tmp/my_box_codes.json", encoding="utf-8"))),
      " 与资产台账交集:", len(json.load(io.open("C:/tmp/box_intersection.json", encoding="utf-8"))))
print("  电柜台账编号映射:", len(led_cab), "个编号 -> 电柜")
