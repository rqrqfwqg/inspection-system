"""location / 机房号 → rooms 归一化回填脚本（E-P0-3）。

为 fixed_assets / device_archives 回填 room_id / room_code / room_match_method。
规则（2026-09-10 修复：只认确定性匹配，禁止兜底）：
  ① location/机房号直接命中 rooms.room_code（即 room_code）→ fk_exact
  ② 楼栋 + 楼层 + 机房名 且 rooms 中「唯一」命中 → fuzzy
  ③ 楼栋 + 机房名 且 rooms 中「唯一」命中 → fuzzy
  ④ 其余（多解 / 无机房名 / 无楼栋）→ none（room_id=NULL）
注：旧版在楼层无法判定时 `return cands[0]` 兜底到「该楼栋第一个机房」，
    导致 4358 条错误归属（其中 GTC 负二楼空调机房被塞 2409 条）——已移除。
注意：P12=东停车楼同栋异名；房间列（如 GE1F-KTJF-205）= rooms.room_code。

幂等：默认只处理 room_match_method IS NULL 的行；--force 重算全部。
用法：
  venv/Scripts/python.exe scripts/normalize_location_room.py
  venv/Scripts/python.exe scripts/normalize_location_room.py --limit 200   # 采样
  venv/Scripts/python.exe scripts/normalize_location_room.py --force
  venv/Scripts/python.exe scripts/normalize_location_room.py --force --dry  # 预览不落库
"""
import os
import sys
import re
import argparse
from typing import Optional

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from database import SessionLocal, Room, FixedAsset, DeviceArchive

# 楼栋关键词 → 标准楼栋名
BUILDING_KW = [
    ("东停车楼", "东停车楼"),
    ("西停车楼", "西停车楼"),
    ("P12", "东停车楼"),
    ("GTC", "GTC"),
    ("交通中心", "GTC"),
    ("工作区", "GTC"),
    ("南停车楼", "南停车楼"),
]

def extract_building(text: str) -> Optional[str]:
    for kw, std in BUILDING_KW:
        if kw in text:
            return std
    return None


def extract_floor(text: str) -> Optional[str]:
    """归一化到 rooms.floor 词表：一楼/二楼/三楼/夹层/负一楼/负二楼。"""
    if re.search(r"负\s*二\s*层|[Bb]\s*2\s*F?|[Bb]2", text):
        return "负二楼"
    if re.search(r"负\s*一\s*层|[Bb]\s*1\s*F?|[Bb]1", text):
        return "负一楼"
    if re.search(r"夹\s*层", text):
        return "夹层"
    if re.search(r"首\s*层|一\s*层|1\s*[Ff]", text):
        return "一楼"
    if re.search(r"二\s*层|2\s*[Ff]", text):
        return "二楼"
    if re.search(r"三\s*层|3\s*[Ff]", text):
        return "三楼"
    return None


def resolve_room(rooms_by_code, room_codes_sorted, name_index, name_index_bf,
                 names_sorted, text: str):
    """返回 (room_id, room_code, method) 或 (None,None,'none')。

    只认确定性匹配：机房编号精确 / 楼栋+楼层+房名唯一 / 楼栋+房名唯一。
    任何多解、缺失一律 none —— 不做任何兜底。
    """
    # ① fk_exact：最长匹配的 room_code 子串
    for code in room_codes_sorted:  # 已按长度降序
        if len(code) >= 4 and code in text:
            r = rooms_by_code[code]
            return r.id, code, "fk_exact"

    # ② 楼栋必填
    b = extract_building(text)
    if not b:
        return None, None, "none"

    # ③ 找最长的机房名（rooms.name 子串）
    name_hit = None
    for name in names_sorted:  # 已按长度降序
        if len(name) >= 2 and name in text:
            name_hit = name
            break
    if not name_hit:
        return None, None, "none"

    # ④ 楼栋 + 楼层 + 房名 唯一命中
    f = extract_floor(text)
    if f:
        cands = name_index_bf.get((b, f, name_hit), [])
        if len(cands) == 1:
            return cands[0].id, cands[0].code, "fuzzy"

    # ⑤ 楼栋 + 房名 唯一命中（若文本给出楼层，则不得与候选楼层冲突）
    cands = name_index.get((b, name_hit), [])
    if len(cands) == 1:
        if f and cands[0].floor and cands[0].floor != f:
            return None, None, "none"
        return cands[0].id, cands[0].code, "fuzzy"

    return None, None, "none"


def process_table(db, model, limit: int, force: bool, dry: bool = False):
    q = db.query(model).filter(model.is_active == True if model is FixedAsset else model.is_active_del == True)
    if not force:
        q = q.filter(model.room_match_method.is_(None))
    if limit:
        q = q.limit(limit)
    rows = q.all()

    # 预加载 rooms
    rooms = db.query(Room).filter(Room.is_active == True).all()
    rooms_by_code = {r.code: r for r in rooms}
    room_codes_sorted = sorted([r.code for r in rooms if r.code], key=len, reverse=True)
    # (building, name) -> [rooms]  与 (building, floor, name) -> [rooms]
    name_index = {}
    name_index_bf = {}
    for r in rooms:
        if r.building and r.name:
            name_index.setdefault((r.building, r.name), []).append(r)
            name_index_bf.setdefault((r.building, r.floor, r.name), []).append(r)
    names_sorted = sorted({r.name for r in rooms if r.name}, key=len, reverse=True)

    stats = {"fk_exact": 0, "fuzzy": 0, "none": 0}
    none_rows = []
    for row in rows:
        text = " ".join(str(x) for x in [getattr(row, "location", ""), getattr(row, "building", ""),
                                         getattr(row, "floor", ""), getattr(row, "location_desc", "")] if x)
        extra = getattr(row, "extra", None) or {}
        if isinstance(extra, dict):
            for v in extra.values():
                if isinstance(v, str):
                    text = text + " " + v
        rid, rcode, method = resolve_room(rooms_by_code, room_codes_sorted,
                                          name_index, name_index_bf, names_sorted, text)
        row.room_id = rid
        row.room_code = rcode
        row.room_match_method = method
        stats[method] += 1
        if method == "none":
            none_rows.append({"device_code": row.device_code, "location": getattr(row, "location", "")})

    if dry:
        db.rollback()
    else:
        db.commit()
    return stats, none_rows, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true", help="只预览不落库")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        print("=== FixedAsset 归一化 ===" + ("（DRY-RUN，不落库）" if args.dry else ""))
        s1, n1, c1 = process_table(db, FixedAsset, args.limit, args.force, args.dry)
        print(f"  处理 {c1} 行：fk_exact={s1['fk_exact']} fuzzy={s1['fuzzy']} none={s1['none']}")
        if n1[:10]:
            print(f"  none 样例（前 10）：")
            for r in n1[:10]:
                print(f"    {r['device_code']} | {r['location'][:40]}")

        print("=== DeviceArchive 归一化 ===")
        s2, n2, c2 = process_table(db, DeviceArchive, args.limit, args.force, args.dry)
        print(f"  处理 {c2} 行：fk_exact={s2['fk_exact']} fuzzy={s2['fuzzy']} none={s2['none']}")
        if n2[:10]:
            print(f"  none 样例（前 10）：")
            for r in n2[:10]:
                print(f"    {r['device_code']} | {r['location'][:40]}")
    finally:
        db.close()
    print("归一化完成。")


if __name__ == "__main__":
    main()
