"""P0 后端冒烟测试：验证 6 个新增/扩展接口返回结构与数据。"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from fastapi.testclient import TestClient
import main

BASE = "/ops/api/assets"

def show(name, resp, keys=None):
    ok = resp.status_code == 200
    print(f"[{'OK' if ok else 'FAIL'}] {name} -> {resp.status_code}")
    if not ok:
        print("   body:", resp.text[:300])
        return None
    data = resp.json()
    if keys:
        print("   ", {k: (data[k] if k in data else '?') for k in keys})
    return data

with TestClient(main.app) as c:
    show("health", c.get("/ops/api/health"))
    subs = show("subsystems", c.get(f"{BASE}/subsystems"), ["__len__"])
    if subs:
        codes = [s["code"] for s in subs]
        print("   子系统 codes:", codes, "-> 7码齐全:", set(["power","water","hvac","weak","fire","lighting","other"]).issubset(set(codes)))

    area0 = show("trees/area (root)", c.get(f"{BASE}/trees/area"), ["__len__"])
    if area0:
        print("   楼栋节点示例:", area0[0] if area0 else None)
        # drill into first building
        b = area0[0]["key"].split(":",1)[1]
        fl = show(f"trees/area b:{b}", c.get(f"{BASE}/trees/area", params={"parent": f"b:{b}"}), ["__len__"])
        if fl:
            print("   楼层节点示例:", fl[0])
            fk = fl[0]["key"]
            rms = show(f"trees/area {fk}", c.get(f"{BASE}/trees/area", params={"parent": fk}), ["__len__"])
            if rms:
                print("   房间节点示例:", rms[0])
                rk = rms[0]["key"]
                devs = show(f"trees/area {rk}", c.get(f"{BASE}/trees/area", params={"parent": rk}), ["__len__"])
                if devs:
                    print("   设备节点示例:", devs[0])

    sub0 = show("trees/subsystem (root)", c.get(f"{BASE}/trees/subsystem"), ["__len__"])
    if sub0:
        print("   子系统树节点示例:", sub0[0])
        sk = sub0[0]["key"]
        cats = show(f"trees/subsystem {sk}", c.get(f"{BASE}/trees/subsystem", params={"parent": sk}), ["__len__"])
        if cats:
            print("   分类节点示例:", cats[0])

    # search by 移交编号（固定资产）
    s = show("search?code=105000624583", c.get(f"{BASE}/search", params={"code": "105000624583"}))
    if s:
        print("   found:", s.get("found"), "| fixed_asset:", bool(s.get("fixed_asset")),
              "| accessories:", len(s.get("accessories",[])), "| problems:", len(s.get("problems",[])),
              "| aliases:", len(s.get("aliases",[])))

    # search by BA device code (alias bridge)
    s2 = show("search?code=KT-L1-B216-DL(N)-16", c.get(f"{BASE}/search", params={"code": "KT-L1-B216-DL(N)-16"}))
    if s2:
        print("   found:", s2.get("found"), "| archive:", bool(s2.get("archive")), "| room:", s2.get("room"))

    bp = show("ba/problems", c.get(f"{BASE}/ba/problems"), ["__len__"])
    if bp:
        print("   total:", bp.get("total"), "summary:", bp.get("summary"))

    bov = show("ba/overview", c.get(f"{BASE}/ba/overview"), ["__len__"])
    if bov:
        for r in bov:
            print(f"   {r['ba_system']:10s} total={r['total']:4d} problem={r['problem']:3d} rate={r['problem_rate']}")

    st = show("stats/by-subsystem-area", c.get(f"{BASE}/stats/by-subsystem-area"), ["__len__"])
    if st:
        print("   矩阵行数:", len(st.get("rows", [])), "| 示例:", st.get("rows", [])[:3])
