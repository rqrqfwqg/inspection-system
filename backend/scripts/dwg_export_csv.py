# -*- coding: utf-8 -*-
"""把整合数据集导出为 CSV（供离线查看/二次导入）+ 生成关联矩阵。"""
import io, json, csv, os, collections

W = "C:/Users/yan/WorkBuddy/2026-05-21-13-28-45"
OUT = W + "/T3GTC电气配电整合"
os.makedirs(OUT, exist_ok=True)

pack = json.load(io.open("C:/tmp/integ/pack.json", encoding="utf-8"))


def write_csv(path, fields, records):
    with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow([lbl for _, lbl, _ in fields])
        for r in records:
            w.writerow([r["data"].get(k, "") for k, _, _ in fields])


for t in pack["tables"]:
    p = "%s/%s_%s.csv" % (OUT, t["code"], t["name"].replace("/", "_"))
    write_csv(p, t["fields"], t["records"])
    print("  %-46s %5d 行" % (os.path.basename(p), len(t["records"])))

# ============ 关联矩阵：图纸箱编码 × 资产台账 ============
intersect = set(json.load(io.open("C:/tmp/box_intersection.json", encoding="utf-8")))
circ_tbl = next(t for t in pack["tables"] if t["code"] == "elec_circuit")
boxcirc = {r["device_code"]: r["data"] for t in pack["tables"]
           if t["code"] == "elec_box_circuit" for r in t["records"]}
riser = {r["device_code"]: r["data"] for t in pack["tables"]
         if t["code"] == "elec_riser_box" for r in t["records"]}
dev_n = collections.Counter()
for t in pack["tables"]:
    if t["code"] != "elec_floor_device":
        continue
    for r in t["records"]:
        b = r["data"].get("box_code")
        if b:
            dev_n[b] += 1

all_boxes = sorted(set(boxcirc) | set(riser) | set(dev_n))
path = OUT + "/关联矩阵_配电箱×回路×台账.csv"
with io.open(path, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["配电箱编码", "资产台账已登记", "上级抽屉柜回路", "所属变电所",
                "图纸设备数", "干线箱所属变电所", "干线箱上级回路", "可信度"])
    for b in all_boxes:
        bc = boxcirc.get(b, {})
        rs = riser.get(b, {})
        w.writerow([b, "√" if b in intersect else "", bc.get("upstream_circuits", ""),
                    rs.get("substation", ""), dev_n.get(b, 0), rs.get("substation", ""),
                    rs.get("upstream_circuits", ""), bc.get("confidence", "")])
print("\n  %-46s %5d 行" % (os.path.basename(path), len(all_boxes)))
print("  其中资产台账已登记: %d" % len([b for b in all_boxes if b in intersect]))
