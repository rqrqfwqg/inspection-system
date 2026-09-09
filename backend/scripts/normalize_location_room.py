"""location / 机房号 → rooms 归一化回填脚本（E-P0-3）。

为 fixed_assets / device_archives 回填 room_id / room_code / room_match_method。
规则（用户已确认「精准」）：
  ① location/机房号直接命中 rooms.room_code（即 room_code）→ fk_exact
  ② 否则按 楼栋/楼层 关键词模糊匹配 rooms → fuzzy
  ③ 都失败 → none 并计入清单
注意：P12=东停车楼同栋异名；房间列（如 GE1F-KTJF-205）= rooms.room_code。

幂等：默认只处理 room_match_method IS NULL 的行；--force 重算全部。
用法：
  venv/Scripts/python.exe scripts/normalize_location_room.py
  venv/Scripts/python.exe scripts/normalize_location_room.py --limit 200   # 采样
  venv/Scripts/python.exe scripts/normalize_location_room.py --force
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

# 楼层提取正则（按优先级）
FLOOR_PATTERNS = [
    r"负\s*[一二三四五六七八九十\d]+\s*层",
    r"[Bb]\s*\d+",
    r"\d+\s*[Ff]",
    r"RF",
]


def extract_building(text: str) -> Optional[str]:
    for kw, std in BUILDING_KW:
        if kw in text:
            return std
    return None


def extract_floor(text: str) -> Optional[str]:
    for pat in FLOOR_PATTERNS:
        m = re.search(pat, text)
        if m:
            return m.group(0).replace(" ", "")
    return None


def floor_match(room_floor: str, extracted: str) -> bool:
    """宽松楼层匹配：双向子串。"""
    if not extracted or not room_floor:
        return False
    return extracted in room_floor or room_floor in extracted


def resolve_room(rooms_by_code, room_codes_sorted, building_index, text: str):
    """返回 (room_id, room_code, method) 或 (None,None,'none')。"""
    # ① fk_exact：最长匹配的 room_code 子串
    for code in room_codes_sorted:  # 已按长度降序
        if len(code) >= 4 and code in text:
            r = rooms_by_code[code]
            return r.id, code, "fk_exact"

    # ② fuzzy：楼栋 +（可选）楼层
    b = extract_building(text)
    f = extract_floor(text)
    if b and b in building_index:
        cands = building_index[b]
        if f:
            matched = [r for r in cands if floor_match(r.floor, f)]
            if matched:
                r = matched[0]
                return r.id, r.code, "fuzzy"
        # 仅楼栋命中（楼层无法精确判定时仍给一个近似，标记 fuzzy）
        r = cands[0]
        return r.id, r.code, "fuzzy"

    return None, None, "none"


def process_table(db, model, limit: int, force: bool):
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
    building_index = {}
    for r in rooms:
        building_index.setdefault(r.building, []).append(r)

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
        rid, rcode, method = resolve_room(rooms_by_code, room_codes_sorted, building_index, text)
        row.room_id = rid
        row.room_code = rcode
        row.room_match_method = method
        stats[method] += 1
        if method == "none":
            none_rows.append({"device_code": row.device_code, "location": getattr(row, "location", "")})

    db.commit()
    return stats, none_rows, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        print("=== FixedAsset 归一化 ===")
        s1, n1, c1 = process_table(db, FixedAsset, args.limit, args.force)
        print(f"  处理 {c1} 行：fk_exact={s1['fk_exact']} fuzzy={s1['fuzzy']} none={s1['none']}")
        if n1[:10]:
            print(f"  none 样例（前 10）：")
            for r in n1[:10]:
                print(f"    {r['device_code']} | {r['location'][:40]}")

        print("=== DeviceArchive 归一化 ===")
        s2, n2, c2 = process_table(db, DeviceArchive, args.limit, args.force)
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
