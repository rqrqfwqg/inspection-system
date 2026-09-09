# -*- coding: utf-8 -*-
"""P1 数据治理 · devices.subsystem_id 为空回填（幂等，可重跑）

背景：devices 共 7878 条，约 5014 条（资产清单批量生成设备）subsystem_id 为空，
      导致资料树按子系统看不到这些设备。它们的 name 是固定资产名称（配电箱/空调/摄像机…），
      可用关键词分类器映射到 7 个子系统（复用根目录 _classify.py 的经验规则，此处按
      devices.name + device_code 重写，规则集中在 SUBS 关键词表）。

用法：
  python scripts/backfill_subsystem_null.py              # 只读预览统计（不落库）
  python scripts/backfill_subsystem_null.py --apply      # 落库
  python scripts/backfill_subsystem_null.py --limit 200  # 预览/执行上限条数
"""
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "backend", "app.db")

# 子系统 code（与 subsystems 表一致）
SUBSYSTEM_CODE = {
    "power": "电力系统", "fire": "消防系统", "weak": "弱电系统", "refrig": "制冷系统",
    "lighting": "照明系统", "water": "给排水系统", "hvac": "暖通系统", "other": "其他系统",
}

# 关键词表：命中顺序即优先级（从上往下，先命中先归类）
RULES = [
    # 消防
    ("fire", ["消防", "气体灭火", "灭火器", "烟感", "温感", "手报", "防火", "报警",
              "应急照明", "疏散指示", "消防栓", "喷淋", "排烟"]),
    # 给排水
    ("water", ["水泵", "潜污", "排污", "闸门", "启闭", "滤池", "水箱", "水表",
               "给排水", "污水", "雨水", "排水"]),
    # 制冷（历史 refrig 已并入 hvac —— 落库 code 用 hvac）
    ("hvac", ["冷水机组", "冷冻", "制冷主机", "冷源", "冰蓄冷"]),
    # 暖通（含空调/风机）
    ("hvac", ["空调", "新风机", "空气处理", "风机", "风柜", "VRV", "多联机",
              "热泵", "冷却塔", "送风", "排风", "新风", "除湿", "加湿", "风口",
              "阀门", "电动阀", "温控"]),
    # 弱电（含安防/网络/音视频）
    ("weak", ["交换机", "机柜", "摄像头", "摄像机", "视频", "监控", "门禁",
              "停车场", "计算机", "服务器", "存储", "网关", "终端", "显示器",
              "机房环境", "数据采集", "工控机", "道闸", "广播", "音响", "会议",
              "网络", "BA", "DDC", "控制器", "电子", "信息", "综合布线", "电话"]),
    # 电力
    ("power", ["配电箱", "配电柜", "电柜", "控制箱", "开关柜", "母线", "UPS",
               "不间断电源", "配电", "变压器", "高压", "低压", "电表", "计量",
               "插座", "照明配电"]),
    # 照明
    ("lighting", ["灯箱", "照明", "灯具", "LED", "显示屏", "灯光", "灯管", "筒灯"]),
]

# 干扰词：命中直接归 other（如 电动排烟窗推窗机构 → 消防? 归 fire 更贴近风机/排烟）
OVERRIDE_OTHER = ["篮球架", "座椅", "沙发", "电视", "饮水机", "艺术品", "标识"]


def classify(name: str, code: str = "") -> str:
    n = f"{name or ''} {code or ''}"
    for kw in OVERRIDE_OTHER:
        if kw in name or kw in code:
            return "other"
    for subsys, kws in RULES:
        for kw in kws:
            if kw in n:
                return subsys
    return "other"


def main():
    apply = "--apply" in sys.argv
    limit = None
    for a in sys.argv:
        if a.startswith("--limit="):
            limit = int(a.split("=")[1])

    con = sqlite3.connect(DB)
    cur = con.cursor()
    # 只处理 devices（非 fixed_assets 生成也可命中），名称优先 name，其次 device_code
    rows = cur.execute(
        "SELECT id, device_code, name FROM devices WHERE subsystem_id IS NULL ORDER BY id"
    ).fetchall()
    if limit:
        rows = rows[:limit]

    from collections import Counter
    dist: Counter = Counter()
    preview = []
    for did, code, name in rows:
        s = classify(name or "", code or "")
        dist[s] += 1
        preview.append((did, code, name, s))

    total = len(preview)
    print(f"== 待回填 {total} 条（subsystem_id 为空）==")
    for s in SUBSYSTEM_CODE:
        if dist.get(s):
            print(f"  {SUBSYSTEM_CODE[s]:8s} -> {dist[s]:5d}")
    print(f"  合计分类 {sum(dist.values())} 条"
          + (f"（--limit {limit}）" if limit else ""))

    if apply and preview:
        # code → id 映射
        sub_map = {r[0]: r[1] for r in cur.execute("SELECT code, id FROM subsystems")}
        cur.executemany(
            "UPDATE devices SET subsystem_id=? WHERE id=?",
            [(sub_map[s], did) for did, _, _, s in preview if s in sub_map],
        )
        con.commit()
        print(f"\n[apply] 已回填 {sum(1 for _ in preview if _[3] in sub_map)} 条")
    elif not apply:
        print("\n（预览模式，未落库；加 --apply 生效）")

    con.close()


if __name__ == "__main__":
    main()
