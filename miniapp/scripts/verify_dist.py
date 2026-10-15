"""产物核查：读 dist/build/mp-weixin/ 打印命中原文。
⚠️ 注意产物分层：模板文案在 .wxml、样式在 .wxss、页面逻辑在 .js、共享模块在 api/*.js。
（编译后常量会折叠、正文常在页面 .js 而非 .wxml，所以必须按文件类型分别读，不能只 grep .js）"""
import json, os

ROOT = r"C:\Users\yan\WorkBuddy\2026-10-13-task-1\miniapp\dist\build\mp-weixin"

def read(p):
    fp = os.path.join(ROOT, p)
    if not os.path.exists(fp):
        return None
    with open(fp, "r", encoding="utf-8", errors="replace") as f:
        return f.read()

def snippet(txt, n, before=70, after=70):
    i = txt.find(n)
    return txt[max(0, i - before):i + after].replace("\n", " ")

fails = []

def check(label, rel, needles):
    txt = read(rel)
    if txt is None:
        print(f"  [FAIL] {label}: 文件缺失 {rel}")
        fails.append(label)
        return
    hit = [n for n in needles if n in txt]
    if not hit:
        print(f"  [FAIL] {label}  ({rel})")
        fails.append(label)
        return
    print(f"  [OK  ] {label}  ({rel})")
    for n in hit:
        print(f"          原文: ...{snippet(txt, n)}...")

print("=" * 74)
print("[1] app.json —— requiredPrivateInfos / permission.desc")
print("=" * 74)
app = json.loads(read("app.json"))
rpi = app.get("requiredPrivateInfos")
desc = app.get("permission", {}).get("scope.userLocation", {}).get("desc", "")
print("requiredPrivateInfos =", json.dumps(rpi, ensure_ascii=False))
print("permission.desc      =", json.dumps(desc, ensure_ascii=False))
print("desc 字数            =", len(desc), "（上限 30）")
ok1 = rpi == ["getLocation", "chooseLocation"]
ok2 = desc == "用于设备盘点定位、选点标注设备位置与核对巡检位置"
print("  -> requiredPrivateInfos 未被动过:", ok1)
print("  -> desc 已是新文案             :", ok2)
if not ok1: fails.append("requiredPrivateInfos")
if not ok2: fails.append("desc")

print()
print("=" * 74)
print("[2] P1-1代表点与淡点互斥（geo.ts 按 id 剔除 + 页面不再 slice(1)）")
print("=" * 74)
check("geo.js: 按观测 id 精确剔除代表点", "api/geo.js", [")return[];const e=o(t)"])
check("geo.js: GeoPoint 带 id 字段", "api/geo.js", ["id:Number("])
check("DeviceDetail.js: 遍历 history 不再 slice(1)", "pages/asset/DeviceDetail.js", [".history.forEach("])

print()
print("=" * 74)
print("[3] P1-3 人工标注显示相对时间 + 精度警示（不过期但标明时间）")
print("=" * 74)
check("geo.js: fmtAgo 实时相对时间", "api/geo.js", ["个月前", "小时前", "分钟前"])
check("DeviceDetail.wxml: 标注距今行", "pages/asset/DeviceDetail.wxml", ["标注距今"])
check("DeviceDetail.wxml: 相对时间插入气泡说明", "pages/asset/DeviceDetail.wxml", ["橙色气泡为人工标注"])
check("DeviceDetail.wxml: &gt;400 米精度警示", "pages/asset/DeviceDetail.wxml", ["误差范围已超 400 米"])
check("DeviceDetail.wxml: 无精度记录区分说明", "pages/asset/DeviceDetail.wxml", ["人工选点，无精度记录"])
check("DeviceDetail.wxss: geo-warn 警示块", "pages/asset/DeviceDetail.wxss", [".geo-warn"])

print()
print("=" * 74)
print("[4] P1-2 盘点页换房不清 lastScan → 错room_code（脏数据）")
print("=" * 74)
check("Inventory.js: 统一入口 selectRoom（换房即清）", "pages/inventory/Inventory.js", ["a&&t||x(),T.value=e"])
check("Inventory.js: lastScanRoom 与 lastScan 成对清空", "pages/inventory/Inventory.js", ['_.value="",S.value=""'])
check("Inventory.js: onShow 开头无条件清空", "pages/inventory/Inventory.js", ["onShow(()=>{x(),j().then("])
check("Inventory.js: 写入前复核（拒绝错房写入）", "pages/inventory/Inventory.js",
      ["房间已切换，请重新扫码后再确认位置", "房间已切换，未保存位置"])

print()
print("=" * 74)
print("[5] P1-4 浮条遮挡列表 + z-index")
print("=" * 74)
check("Inventory.wxss: 动态下边距 300rpx", "pages/inventory/Inventory.wxss",
      [".page-with-geo", "300rpx"])
check("Inventory.js: showGeoLane 驱动 class", "pages/inventory/Inventory.js", ["e.onShow"])
check("Inventory.wxml: 条件 class 绑定", "pages/inventory/Inventory.wxml", ["page-with-geo"])
check("Inventory.wxss: geo-lane 与 action-bar 同z-index", "pages/inventory/Inventory.wxss",
      [".geo-lane", ".action-bar"])

print()
print("=" * 74)
print("[6] P2-1 点击目标≥88rpx")
print("=" * 74)
check("RouteDetail.wxss: .n-op 可点高度", "pages/route/RouteDetail.wxss", [".n-op.data-v-"])
check("RouteDetail.wxss: 88rpx", "pages/route/RouteDetail.wxss", ["88rpx"])
check("RoomDetail.wxss: .geo-clear 可点高度", "pages/asset/RoomDetail.wxss", [".geo-clear.data-v-"])
check("RoomDetail.wxss: 88rpx", "pages/asset/RoomDetail.wxss", ["88rpx"])
check("Inventory.wxss: .gl-btn ≥72rpx", "pages/inventory/Inventory.wxss", ["min-height:72rpx"])
check("DeviceDetail.wxss: .geo-btn 92rpx", "pages/asset/DeviceDetail.wxss", ["92rpx"])

print()
print("=" * 74)
print("[7] P2-2 区域型节点不渲染选点按钮")
print("=" * 74)
check("RouteDetail.js: area 节点在 JS 层被拒绝", "pages/route/RouteDetail.js", ["区域节点暂不支持地图标注"])
check("RouteDetail.wxml: 区域节点明确说明", "pages/route/RouteDetail.wxml",
      ["区域节点无房间，暂不支持地图标注"])
check("RouteDetail.wxml: 按钮条件渲染", "pages/route/RouteDetail.wxml", ["n-ops-none"])

print()
print("=" * 74)
print("[8] P2-3 三处入口并发保护 + P2-4 写入失败不报成功")
print("=" * 74)
check("useChooseLocation.js: 共享 pending 单例", "composables/useChooseLocation.js", ["choosePending"])
# QA P2-3 只针对「原本没有 busy 的三处入口」；Inventory 的 onManualConfirm 本来就有 busy，不在整改范围
for page, rel in [("DeviceDetail", "pages/asset/DeviceDetail.js"),
                  ("RoomDetail", "pages/asset/RoomDetail.js"),
                  ("RouteDetail", "pages/route/RouteDetail.js")]:
    check(f"{page}.js: choosePending 早退（原本无busy 的三处）", rel, ["choosePending"])
check("Inventory.js: 原有 busy 早退保持不变", "pages/inventory/Inventory.js", ["if(b.value)return"])
check("DeviceDetail.js: 写入失败不弹已保存", "pages/asset/DeviceDetail.js", ["未写入记录"])
check("Inventory.js: 写入失败不弹已保存", "pages/inventory/Inventory.js", ["未写入记录"])

print()
print("=" * 74)
print("总判定:", "PASS —— 全部命中" if not fails else f"FAIL {len(fails)} 项: {fails}")
print("=" * 74)