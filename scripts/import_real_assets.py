# -*- coding: utf-8 -*-
"""真实台账数据导入（schema 驱动，幂等）。

读取现场 3 份 Excel，按各资料表的 FieldDef.label 映射列 -> 字段 key，
device_code 取关联键列值，幂等写入 records。

运行（后端 venv）：
  backend\\venv\\Scripts\\python.exe scripts\\import_real_assets.py
"""
import os
import sys

BACKEND = r"C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/backend"
EXCEL_BASE = r"D:/机场业务/T3GTC/02_设备清单"

sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

from database import init_db, get_db, DataTable, FieldDef, Record  # noqa: E402
from asset_routes import seed_assets                                  # noqa: E402
import openpyxl                                       # noqa: E402

# (excel 文件名, sheet 名, 表头行号(0-based), 资料表 code, 去重方式)
# 去重方式: "code" = 按 device_code 唯一; "seq" = 允许同设备多条（问题清单按序号去重）
JOBS = [
    ("GTC和停车楼电柜清单-统计汇总.xlsx", "原始数据", 0, "power_cabinets", "code"),
    ("机房信息汇总.xlsx", "机房信息汇总", 0, "room_master", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "VRV空调", 1, "ba_vrv", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "一体化空调", 1, "ba_integrated_ac", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "排风机", 1, "ba_exhaust_fan", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "市政排风", 1, "ba_municipal_exhaust", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "潜污泵", 1, "ba_submersible_pump", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "一氧化碳检测", 1, "ba_co_detection", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "管廊气体监测", 1, "ba_gallery_gas", "code"),
    ("BA系统设备清单_整理汇总.xlsx", "问题清单", 2, "ba_issue_list", "seq"),
]


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return s if s != "" else None
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def main():
    init_db()
    db = next(get_db())
    seed_assets(db)  # 确保表/字段存在
    print("seed 完成，开始导入真实台账...\n")

    grand_total = 0
    grand_skip = 0

    for fname, sheet, hrow, table_code, dedupe in JOBS:
        table = db.query(DataTable).filter(DataTable.code == table_code).first()
        if not table:
            print(f"[跳过] 资料表不存在: {table_code}")
            continue
        fields = db.query(FieldDef).filter(FieldDef.table_id == table.id).all()
        label_to_key = {f.label: f.key for f in fields}
        rel_key = next((f.key for f in fields if f.is_relation_key), None)

        path = os.path.join(EXCEL_BASE, fname)
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        wb.close()

        header = rows[hrow]
        # 找到关联键在表头中的真实列名
        rel_label = None
        for f in fields:
            if f.is_relation_key:
                rel_label = f.label
                break

        inserted = 0
        skipped = 0
        for r in rows[hrow + 1:]:
            data = {}
            for idx, h in enumerate(header):
                if h is None:
                    continue
                h = str(h).strip()
                if h == "" or h not in label_to_key:
                    continue
                v = clean(r[idx]) if idx < len(r) else None
                if v is None:
                    continue
                data[label_to_key[h]] = v
            if not data:
                continue
            device_code = str(data[rel_key]).strip() if rel_key and rel_key in data else None
            if not device_code:
                skipped += 1
                continue
            # 去重
            if dedupe == "code":
                exists = db.query(Record).filter(
                    Record.table_id == table.id, Record.device_code == device_code).first()
                if exists:
                    skipped += 1
                    continue
            else:  # seq：允许同设备多条，按序号去重
                seqv = data.get("seq")
                dup = any(
                    str(rec.data.get("seq")) == str(seqv)
                    for rec in db.query(Record).filter(Record.table_id == table.id).all()
                    if rec.data
                ) if seqv is not None else False
                if dup:
                    skipped += 1
                    continue
            rec = Record(table_id=table.id, device_code=device_code,
                         data=data, created_by="现场Excel导入")
            db.add(rec)
            inserted += 1

        db.commit()
        grand_total += inserted
        grand_skip += skipped
        print(f"[完成] {table.name}({table_code}): 导入 {inserted} 条, 跳过 {skipped} 条")

    print(f"\n========== 全部完成: 导入 {grand_total} 条, 跳过 {grand_skip} 条 ==========")


if __name__ == "__main__":
    main()
