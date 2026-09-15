# -*- coding: utf-8 -*-
"""把 C:/tmp/integ/pack.json 上传到线上 inspection-system：
建子系统 -> 建资料表 -> 建字段 -> 分批导入记录。

幂等：elec_* 表若已存在则删除重建（DELETE /tables/{tid} 会级联删字段与记录）。
全程走官方 HTTP API，不裸改数据库。
"""
import io, json, ssl, time, urllib.request, urllib.error, sys

BASE = "https://82.156.62.59/ops/api/assets"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

pack = json.load(io.open("C:/tmp/integ/pack.json", encoding="utf-8"))
SUBSYS = pack["subsystem"]
TABLES = pack["tables"]


def call(method, path, body=None, tries=4, timeout=180):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    last = None
    for a in range(1, tries + 1):
        req = urllib.request.Request(url, method=method, data=data, headers={
            "Content-Type": "application/json", "User-Agent": "wb-upload"})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                raw = r.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            if e.code in (400, 404, 422) and method != "GET":
                raise RuntimeError("%s %s -> %s %s" % (method, path, e.code, detail))
            last = "HTTP %s %s" % (e.code, detail)
        except Exception as e:
            last = repr(e)
        print("    retry %d/%d: %s" % (a, tries, last), flush=True)
        time.sleep(2 * a)
    raise RuntimeError("%s %s failed: %s" % (method, path, last))


# ============ 1. 子系统 ============
subs = call("GET", "/subsystems")
sid = None
for s in subs:
    if s["code"] == SUBSYS["code"]:
        sid = s["id"]
        print("[1] 子系统已存在 id=%s，复用" % sid)
        break
if sid is None:
    r = call("POST", "/subsystems", {
        "code": SUBSYS["code"], "name": SUBSYS["name"], "icon": "Zap",
        "sort_order": SUBSYS["sort_order"], "is_active": True})
    sid = r["id"]
    print("[1] 新建子系统 id=%s %s" % (sid, SUBSYS["name"]))

# ============ 2. 资料表 + 字段 ============
existing = {t["code"]: t["id"] for t in call("GET", "/tables")}
tid_map = {}
for i, t in enumerate(TABLES, 1):
    if t["code"] in existing:
        old = existing[t["code"]]
        call("DELETE", "/tables/%d" % old)
        print("[2.%d] 旧表 %s(id=%s) 已删除重建" % (i, t["code"], old))
    r = call("POST", "/tables", {
        "subsystem_id": sid, "code": t["code"], "name": t["name"],
        "description": t.get("desc", ""), "sort_order": i, "is_active": True})
    tid = r["id"]
    tid_map[t["code"]] = tid
    for j, f in enumerate(t["fields"]):
        key, label, ftype = f[0], f[1], f[2]
        call("POST", "/tables/%d/fields" % tid, {
            "table_id": tid, "key": key, "label": label, "type": ftype,
            "options": [], "is_required": False, "is_relation_key": False,
            "sort_order": j})
    print("[2.%d] %-20s id=%-4s 字段%2d" % (i, t["code"], tid, len(t["fields"])), flush=True)

# ============ 3. 分批导入记录 ============
BATCH_MAX = 400
total = 0
for i, t in enumerate(TABLES, 1):
    tid = tid_map[t["code"]]
    recs = t["records"]
    done = 0
    for k in range(0, len(recs), BATCH_MAX):
        chunk = recs[k:k + BATCH_MAX]
        body = {"records": [{"device_code": r["device_code"], "data": r["data"]} for r in chunk]}
        res = call("POST", "/tables/%d/records/bulk" % tid, body)
        done += res.get("created", 0)
        if res.get("skipped"):
            print("      WARN skipped=%s" % res["skipped"])
    total += done
    flag = "OK" if done == len(recs) else "!! 期望%d" % len(recs)
    print("[3.%d] %-20s 导入 %5d / %5d  %s" % (i, t["code"], done, len(recs), flag), flush=True)

print("\n=== 上传完成，合计 %d 条 ===" % total)

# ============ 4. 复检 ============
print("\n=== 服务端复检 ===")
ts = call("GET", "/tables")
mine = [t for t in ts if t["code"] in tid_map]
for t in sorted(mine, key=lambda x: x["id"]):
    print("  id=%-4s %-20s %-22s 记录%5s 字段%2s" %
          (t["id"], t["code"], t["name"], t.get("record_count"), t.get("field_count")))
print("  子系统条目:", len(mine), "/", len(TABLES))
