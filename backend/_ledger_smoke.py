# -*- coding: utf-8 -*-
"""资产总台账接口冒烟（只读，跑在本机库上）。"""
import os
import sys
import json

os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

c = TestClient(app)
P = "/ops/api/assets"
passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  [PASS] {name} {extra}")
    else:
        failed += 1
        print(f"  [FAIL] {name} {extra}")


print("=" * 70)
print("0) 全集合规模（devices ∪ 台账 ∪ 固定资产）")
S0 = c.get(f"{P}/asset-ledger/summary").json()
TOTAL = S0["total"]
print(f"     全集合 total={TOTAL}  已登记={S0['registered']}  仅台账未登记={S0['ledger_only']}")
check("registered + ledger_only == total",
      S0["registered"] + S0["ledger_only"] == TOTAL,
      f"{S0['registered']}+{S0['ledger_only']} vs {TOTAL}")
check("ledger_only > 0（原页面漏掉的设备）", S0["ledger_only"] > 0, f"= {S0['ledger_only']}")
check("total > 已登记数（确实做了并集）", TOTAL > S0["registered"],
      f"{TOTAL} > {S0['registered']}")

print("=" * 70)
print("1) 列表基础")
r = c.get(f"{P}/asset-ledger", params={"page": 1, "page_size": 5})
check("HTTP 200", r.status_code == 200, f"code={r.status_code}")
d = r.json()
print(f"     total={d.get('total')} pages={d.get('pages')} items={len(d.get('items', []))}")
check("total == 全集合规模", d.get("total") == TOTAL, f"实际 {d.get('total')} 期望 {TOTAL}")
check("当页 5 条", len(d.get("items", [])) == 5)
it = (d.get("items") or [{}])[0]
KEYS = ("device_code", "name", "asset_name", "brand_model", "location", "area", "use_dept",
        "price_tax", "warranty_end", "warranty_state", "subsystem_name", "record_count", "has_asset")
print("     首行:", json.dumps({k: it.get(k) for k in KEYS}, ensure_ascii=False))
check("含子系统名", bool(it.get("subsystem_name")), f"= {it.get('subsystem_name')}")
check("区域已计算", bool(it.get("area")), f"= {it.get('area')}")
check("facets 有区域", len(d.get("facets", {}).get("areas", [])) > 0,
      f"{len(d.get('facets', {}).get('areas', []))} 个")
print("     区域 facet:", d.get("facets", {}).get("areas"))

print("=" * 70)
print("2) 分页正确性（第2页不与第1页重复）")
d2 = c.get(f"{P}/asset-ledger", params={"page": 2, "page_size": 5}).json()
codes1 = {x["device_code"] for x in d["items"]}
codes2 = {x["device_code"] for x in d2["items"]}
check("两页无交集", not (codes1 & codes2), f"交集={codes1 & codes2}")

print("=" * 70)
print("3) 筛选：有固定资产 / 无固定资产 / 仅BIM / 保修")
a = c.get(f"{P}/asset-ledger", params={"state": "with_asset", "page_size": 1}).json()
b = c.get(f"{P}/asset-ledger", params={"state": "without_asset", "page_size": 1}).json()
m = c.get(f"{P}/asset-ledger", params={"state": "bim", "page_size": 1}).json()
exp = c.get(f"{P}/asset-ledger", params={"state": "warranty_expired", "page_size": 1}).json()
check("有固定资产 = 7237", a.get("total") == 7237, f"实际 {a.get('total')}")
check("有+无 = 总数", (a.get("total") or 0) + (b.get("total") or 0) == TOTAL,
      f"{a.get('total')}+{b.get('total')} vs {TOTAL}")
check("仅BIM > 0", (m.get("total") or 0) > 0, f"= {m.get('total')}")
check("保修已过期 > 0", (exp.get("total") or 0) > 0, f"= {exp.get('total')}")

print("=" * 70)
print("4) 筛选：关键字 / 区域 / 子系统")
q1 = c.get(f"{P}/asset-ledger", params={"q": "配电箱", "page_size": 3}).json()
check("关键字『配电箱』有命中", (q1.get("total") or 0) > 0, f"= {q1.get('total')} 条")
if q1.get("items"):
    print("     样例:", json.dumps({k: q1["items"][0].get(k) for k in
          ("device_code", "asset_name", "brand_model", "location")}, ensure_ascii=False))
subs = c.get(f"{P}/subsystems").json()
sid = subs[0]["id"] if subs else None
s1 = c.get(f"{P}/asset-ledger", params={"subsystem_id": sid, "page_size": 1}).json()
check(f"子系统筛选(id={sid})", (s1.get("total") or 0) > 0, f"= {s1.get('total')} 条")
AREA_TOTAL = 0
for ar in (d.get("facets", {}).get("areas") or [])[:3]:
    a1 = c.get(f"{P}/asset-ledger", params={"area": ar, "page_size": 1}).json()
    AREA_TOTAL += a1.get("total") or 0
    print(f"     区域 {ar}: {a1.get('total')} 条")
check("区域筛选可用", AREA_TOTAL > 0)
sum_area = c.get(f"{P}/asset-ledger/summary").json().get("by_area") or []
check("区域计数之和 == 总数",
      sum(x["count"] for x in sum_area) == TOTAL,
      f"Σ={sum(x['count'] for x in sum_area)} vs {TOTAL}")
lo = c.get(f"{P}/asset-ledger", params={"state": "ledger_only", "page_size": 3}).json()
check("仅台账未登记筛选可用", (lo.get("total") or 0) > 0, f"= {lo.get('total')} 条")
if lo.get("items"):
    x = lo["items"][0]
    print("     样例:", json.dumps({k: x.get(k) for k in
          ("device_code", "name", "location", "area", "subsystem_name", "record_count")},
          ensure_ascii=False))
    check("未登记设备也确实带内容（名称或位置）",
          bool(x.get("name")) and x.get("name") != x.get("device_code") or bool(x.get("location")),
          f"name={x.get('name')} loc={x.get('location')}")

print("=" * 70)
print("5) 排序（空值必须排最后）")
asc = c.get(f"{P}/asset-ledger", params={"sort": "price_tax", "order": "asc", "page_size": 5}).json()
desc = c.get(f"{P}/asset-ledger", params={"sort": "price_tax", "order": "desc", "page_size": 5}).json()
pv_asc = [x["price_tax"] for x in asc["items"]]
pv_desc = [x["price_tax"] for x in desc["items"]]
print(f"     升序前5: {pv_asc}")
print(f"     降序前5: {pv_desc}")
check("升序非空且有序", pv_asc and pv_asc == sorted(pv_asc), f"{pv_asc}")
check("降序非空且有序", pv_desc and pv_desc == sorted(pv_desc, reverse=True), f"{pv_desc}")
check("降序首行非 null（金额最大在前）", pv_desc and pv_desc[0] is not None, f"= {pv_desc[0] if pv_desc else None}")
wasc = c.get(f"{P}/asset-ledger", params={"sort": "warranty_end", "order": "asc", "page_size": 3}).json()
check("按保修到期升序", [x["warranty_end"] for x in wasc["items"]][0] is not None,
      f"{[x['warranty_end'] for x in wasc['items']]}")

print("=" * 70)
print("6) 汇总")
sm = c.get(f"{P}/asset-ledger/summary").json()
print(json.dumps({k: sm.get(k) for k in
      ("total", "with_asset", "without_asset", "with_bim", "no_location",
       "amount_total", "amount_avg", "warranty_soon", "warranty_expired")},
      ensure_ascii=False, indent=1))
check("汇总 total == 全集合规模", sm.get("total") == TOTAL, f"= {sm.get('total')}")
check("含税总额 ≈ 8.85 亿", 8.5e8 < (sm.get("amount_total") or 0) < 9.2e8,
      f"= {sm.get('amount_total')}")
print("     区域分布:", json.dumps(
    [{"name": x["name"], "count": x["count"]} for x in (sm.get("by_area") or [])[:8]],
    ensure_ascii=False))
print("     子系统分布:", json.dumps(
    [{"name": x["name"], "count": x["count"]} for x in (sm.get("by_subsystem") or [])[:8]],
    ensure_ascii=False))
print("     使用单位 top3:", json.dumps(
    [{"name": x["name"], "count": x["count"]} for x in (sm.get("by_use_dept") or [])[:3]],
    ensure_ascii=False))
check("by_area 非空", len(sm.get("by_area") or []) > 0)
check("by_subsystem 非空", len(sm.get("by_subsystem") or []) > 0)
check("使用单位已压平换行", all("\n" not in (x["name"] or "") for x in (sm.get("by_use_dept") or [])))

print("=" * 70)
print("7) 详情（有固定资产的设备）")
page = c.get(f"{P}/asset-ledger", params={"state": "with_asset", "page_size": 50}).json()
code = page["items"][0]["device_code"]
dt = c.get(f"{P}/asset-ledger/detail", params={"code": code}).json()
check("详情 found", dt.get("found") is True, f"code={code} source={dt.get('source')}")
check("带固定资产", dt.get("fixed_asset") is not None, f"code={code}")
if dt.get("fixed_asset"):
    fa = dt["fixed_asset"]
    print("     固定资产:", json.dumps({k: fa.get(k) for k in
          ("device_code", "asset_name", "brand_model", "location", "use_dept",
           "price_tax", "warranty_end", "contract_no")}, ensure_ascii=False))
print(f"     设备: {json.dumps(dt.get('device'), ensure_ascii=False)}")
print(f"     台账记录 {dt.get('record_count')} 条, 关联 {len(dt.get('relations') or [])} 条, 区域={dt.get('area')}")
check("详情 404 兜底：不存在编号", c.get(f"{P}/asset-ledger/detail",
      params={"code": "___NO_SUCH_CODE___"}).json().get("found") is False)

print("=" * 70)
print("8) 跨表台账记录 + 关联链路")
scan = c.get(f"{P}/asset-ledger",
             params={"state": "has_records", "page_size": 500, "sort": "record_count",
                     "order": "desc"}).json()
print(f"     有台账记录的设备总数 = {scan.get('total')}")
rich = [x for x in scan["items"] if x.get("record_count")]
rel = [x for x in scan["items"] if x.get("relation_count")]
print(f"     扫描 500 条：有台账记录 {len(rich)} 条，有关联 {len(rel)} 条")
if rich:
    c2 = c.get(f"{P}/asset-ledger/detail", params={"code": rich[0]["device_code"]}).json()
    check("台账记录可展开", (c2.get("record_count") or 0) > 0,
          f"code={rich[0]['device_code']} → {c2.get('record_count')} 条")
    if c2.get("records"):
        r0 = c2["records"][0]
        print(f"     首条台账: 表={r0.get('table_name')} 子系统={r0.get('subsystem_name')}")
        check("台账记录带表名", bool(r0.get("table_name")))
else:
    print("     (本批无带记录的设备，跳过)")
if rel:
    c3 = c.get(f"{P}/asset-ledger/detail", params={"code": rel[0]["device_code"]}).json()
    check("关联可展开", len(c3.get("relations") or []) > 0,
          f"code={rel[0]['device_code']} → {len(c3.get('relations') or [])} 条")
    for x in (c3.get("relations") or [])[:3]:
        print(f"     {x['direction']} {x['relation_type']}({x.get('kind')}) → {x['other_code']}")
else:
    print("     (本批无有关联的设备，跳过)")

print("=" * 70)
print("9) 大分页与边界")
big = c.get(f"{P}/asset-ledger", params={"page_size": 500, "page": 16}).json()
check("末页可访问", big.get("total") == TOTAL and len(big.get("items", [])) > 0,
      f"第16页 {len(big.get('items', []))} 条")
oob = c.get(f"{P}/asset-ledger", params={"page": 9999, "page_size": 50}).json()
check("越界页返回空而非报错", oob.get("items") == [], f"{oob.get('items')}")
over = c.get(f"{P}/asset-ledger", params={"page_size": 99999}).json()
check("page_size 被限幅 ≤500", over.get("page_size") == 500, f"= {over.get('page_size')}")

print("=" * 70)
print(f"===== 结果: PASS={passed}  FAIL={failed} =====")
sys.exit(1 if failed else 0)
