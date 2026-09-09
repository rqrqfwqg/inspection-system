# -*- coding: utf-8 -*-
"""P1 数据治理 · 历史关联类型归一（幂等，可重跑）

现状：device_relations.relation_type 存中文自由文本（上级配电/供电/供配电/取电/冷源/所在机房…），
      relation 无 kind 语义，无法支撑「上游供电链遍历」。
目标：
  1) relation_types 字典已由后端 seed（启动幂等）写入 —— 本脚本只做存量归一，不建字典。
  2) 把历史 relation_type 文本逐条映射到受控 label（rule 见下方 MAP，与
     backend/asset_routes.py 的 LEGACY_RELATION_MAP 同源，本地保留一份防耦合）。
  3) 方向归一：P1 约定 forward 边 from=上游(供电方/冷源) → to=下游(受电/用冷)。
     seed 示范数据在早期版本方向相反（load→source），此处按已知示范对翻转；
     真实人工边不动（方向不确定，宁缺勿滥，交给现场建边逐步校准）。

用法：
  python scripts/normalize_relations.py            # 只读预览 diff
  python scripts/normalize_relations.py --apply    # 落库
"""
import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "backend", "app.db")

# 历史文本 → 受控 label（受控 label 与 RELATION_TYPE_SEED.label 对齐）
MAP = {
    "供电": "供电", "供配电": "供配电", "上级配电": "上级配电", "取电": "取电",
    "冷源": "冷源", "所在机房": "所在机房", "网络": "网络", "控制": "控制",
    "管路连接": "管路连接", "配件从属": "配件从属", "关联": "关联",
    # 已知杂项兜底
    "供/配电": "供配电", "取配电": "取电", "上级供电": "供电",
    "上级电源": "供电", "电源": "供电", "配电": "供配电",
    "所属机房": "所在机房", "位于": "所在机房", "安装于": "所在机房",
}
VALID_LABELS = set(MAP.values())

# seed 示范边方向翻转（早期版本 load→source；P1 约定 source→load）
# (旧from, 旧to, type) → (新from, 新to)
FLIP = {
    ("L-3F-A-001", "CB-L-A01", "供电"): ("CB-L-A01", "L-3F-A-001"),
    ("CB-L-A01", "PD-3F-A", "上级配电"): ("PD-3F-A", "CB-L-A01"),
    ("AHU-2F-01", "CB-R-01", "供配电"): ("CB-R-01", "AHU-2F-01"),
    ("AHU-2F-01", "CH-01", "冷源"): ("CH-01", "AHU-2F-01"),
    ("FM-3F-A01", "PD-3F-A", "取电"): ("PD-3F-A", "FM-3F-A01"),
    ("WP-1F-01", "CB-R-01", "供配电"): ("CB-R-01", "WP-1F-01"),
    ("FCU-3F-01", "CH-01", "冷源"): ("CH-01", "FCU-3F-01"),
}


def main():
    apply = "--apply" in sys.argv
    con = sqlite3.connect(DB)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT id, from_code, to_code, relation_type FROM device_relations ORDER BY id"
    ).fetchall()
    label_changes = []
    unknown = []
    flip_changes = []
    for rid, f, t, rt in rows:
        cur_rt = (rt or "").strip()
        if cur_rt not in VALID_LABELS:
            if cur_rt in MAP:
                label_changes.append((rid, f, t, cur_rt, MAP[cur_rt]))
            else:
                unknown.append((rid, f, t, cur_rt))
        # 方向翻转（仅命中已知示范对，且同类型无反向边冲突）
        new_pair = FLIP.get((f, t, cur_rt) if cur_rt in VALID_LABELS else (f, t, MAP.get(cur_rt, cur_rt)))
        if new_pair:
            nf, nt = new_pair
            dup = cur.execute(
                "SELECT id FROM device_relations WHERE from_code=? AND to_code=? AND relation_type=?",
                (nf, nt, MAP.get(cur_rt, cur_rt))).fetchone()
            if not dup:
                flip_changes.append((rid, f, t, nf, nt, cur_rt))

    print(f"== 关联总数 {len(rows)} ==")
    if label_changes:
        print(f"[文本归一] {len(label_changes)} 条：")
        for rid, f, t, old, new in label_changes:
            print(f"  #{rid} {f} -> {t} : '{old}' => '{new}'")
    else:
        print("[文本归一] 无待归一文本（已全部为受控 label）")
    if flip_changes:
        print(f"[方向翻转] {len(flip_changes)} 条示范边：")
        for rid, f, t, nf, nt, rt in flip_changes:
            print(f"  #{rid} {f} -> {t} : {rt}  =>  {nf} -> {nt}")
    else:
        print("[方向翻转] 无待翻转（或目标方向已存在）")
    if unknown:
        print(f"\n无法识别（将保留原样，建议人工确认后补 MAP）{len(unknown)} 条：")
        for rid, f, t, rt in unknown:
            print(f"  #{rid} {f} -> {t} : '{rt}'")

    if apply:
        if label_changes:
            cur.executemany(
                "UPDATE device_relations SET relation_type=? WHERE id=?",
                [(new, rid) for rid, _, _, _, new in label_changes])
        for rid, f, t, nf, nt, rt in flip_changes:
            cur.execute("UPDATE device_relations SET from_code=?, to_code=? WHERE id=?",
                        (nf, nt, rid))
        con.commit()
        print(f"\n[apply] 文本归一 {len(label_changes)} 条 / 方向翻转 {len(flip_changes)} 条")
    con.close()


if __name__ == "__main__":
    main()
