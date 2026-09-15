# -*- coding: utf-8 -*-
"""回填「电柜清单」(table_id=11) 的图纸关联字段。

数据源：C:/tmp/integ/pack.json 的 elec_circuit 表（265 条回路台账）
目标：按 branch_control_primary / branch_control_backup 匹配回路，写入
      上级回路信息 / 上级电缆规格 / 上级变电所 / 所属系统图 / 回路核对状态。
全程走 HTTP API（先建字段，再 PUT 更新记录），不裸改数据库。
"""
import io, json, ssl, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = "https://82.156.62.59/ops/api/assets"
TID = 11
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

pack = json.load(io.open("C:/tmp/integ/pack.json", encoding="utf-8"))
circ_tbl = next(t for t in pack["tables"] if t["code"] == "elec_circuit")
CMAP = {r["device_code"]: r["data"] for r in circ_tbl["records"]}
print("回路台账映射:", len(CMAP), "条")


def call(method, path, body=None, tries=4, timeout=180, quiet=False):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    last = None
    for a in range(1, tries + 1):
        req = urllib.request.Request(url, method=method, data=data, headers={
            "Content-Type": "application/json", "User-Agent": "wb-backfill"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (400, 404, 422):
                raise RuntimeError("%s %s -> %s %s" % (method, path, e.code, detail))
            last = "HTTP %s %s" % (e.code, detail)
        except Exception as e:
            last = repr(e)
        if not quiet:
            print("    retry %d/%d: %s" % (a, tries, last), flush=True)
        time.sleep(2 * a)
    raise RuntimeError("%s %s failed: %s" % (method, path, last))


# ============ 1. 建字段 ============
NEW_FIELDS = [
    ("upstream_circuit_info", "上级抽屉柜回路", "text"),
    ("upstream_cable", "上级电缆规格", "text"),
    ("upstream_substation", "上级变电所", "text"),
    ("upstream_diagram", "所属系统图", "text"),
    ("circuit_verify", "回路核对状态", "text"),
]
have = {f["key"] for f in call("GET", "/tables/%d/fields" % TID)}
base_sort = len(have)
for i, (k, label, t) in enumerate(NEW_FIELDS):
    if k in have:
        print("[1] 字段 %s 已存在，跳过" % k)
        continue
    call("POST", "/tables/%d/fields" % TID, {
        "table_id": TID, "key": k, "label": label, "type": t, "options": [],
        "is_required": False, "is_relation_key": False, "sort_order": base_sort + i})
    print("[1] 新建字段 %-22s %s" % (k, label))


# ============ 2. 计算回填值 ============
def build(data):
    p = (data.get("branch_control_primary") or "").strip()
    b = (data.get("branch_control_backup") or "").strip()
    pc, bc = CMAP.get(p), CMAP.get(b)

    parts = []
    if pc:
        parts.append("主用 %s" % p)
    if bc:
        parts.append("备用 %s" % b)

    cables = []
    for code, c in ((p, pc), (b, bc)):
        if c and c.get("cable_section"):
            s = "%s: %s" % (code, c["cable_section"])
            if s not in cables:
                cables.append(s)

    subs = sorted({c["substation"] for c in (pc, bc) if c and c.get("substation")})
    dias = []
    for c in (pc, bc):
        if c and c.get("sys_diagram") and c["sys_diagram"] not in dias:
            dias.append(c["sys_diagram"])
    ver = sorted({c["verify_result"] for c in (pc, bc) if c and c.get("verify_result")})

    return {
        "upstream_circuit_info": " / ".join(parts),
        "upstream_cable": "；".join(cables),
        "upstream_substation": "、".join(subs),
        "upstream_diagram": "；".join(dias),
        "circuit_verify": "、".join(ver),
    }, bool(pc or bc)


recs = call("GET", "/tables/%d/records" % TID, timeout=120)
print("[2] 取到电柜清单 %d 条" % len(recs))

todo = []
for r in recs:
    val, hit = build(r["data"] or {})
    old = {k: (r["data"] or {}).get(k, "") for k in val}
    if old == val:
        continue
    newdata = dict(r["data"] or {})
    newdata.update(val)
    todo.append((r["id"], newdata, hit))

print("[2] 需更新 %d 条（其中回路匹配成功 %d 条）" % (len(todo), sum(1 for x in todo if x[2])))

# ============ 3. 并发 PUT ============
ok = 0
err = []


def upd(item):
    rid, nd, _ = item
    try:
        call("PUT", "/tables/%d/records/%d" % (TID, rid), {"data": nd}, quiet=True)
        return True
    except Exception as e:
        err.append((rid, repr(e)[:150]))
        return False


with ThreadPoolExecutor(max_workers=8) as ex:
    for i, res in enumerate(ex.map(upd, todo), 1):
        if res:
            ok += 1
        if i % 100 == 0:
            print("    更新 %d/%d" % (i, len(todo)), flush=True)

print("[3] 更新成功 %d / %d，失败 %d" % (ok, len(todo), len(err)))
for e in err[:5]:
    print("    ERR:", e)

# ============ 4. 复检 ============
chk = call("GET", "/tables/%d/records" % TID, timeout=120)
n_hit = n_cable = n_sub = n_ver = 0
for r in chk:
    d = r["data"] or {}
    if d.get("upstream_circuit_info"):
        n_hit += 1
    if d.get("upstream_cable"):
        n_cable += 1
    if d.get("upstream_substation"):
        n_sub += 1
    if d.get("circuit_verify"):
        n_ver += 1
print("\n=== 服务端复检（共 %d 条电柜） ===" % len(chk))
print("  有「上级抽屉柜回路」: %d" % n_hit)
print("  有「上级电缆规格」  : %d" % n_cable)
print("  有「上级变电所」    : %d" % n_sub)
print("  有「回路核对状态」  : %d" % n_ver)
