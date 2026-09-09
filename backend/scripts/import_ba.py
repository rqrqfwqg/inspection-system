"""导入 BA 系统设备清单（8 sheet：设备总览统计 / 问题清单 / 7 类设备明细）。

- 7 类设备明细 → Device + DeviceArchive（device_code=BA设备编号，system_text=BA子系统）+ DeviceAlias
- 问题清单 → BaProblem（ba_device_no 经 DeviceAlias 桥接回填 device_code）
- 设备总览统计：仅打印用于核对（总数由 /ba/overview 实时聚合）

每个 sheet = 1 条 ImportBatch。幂等 upsert（按 device_code / 主键）。
用法：
  venv/Scripts/python.exe scripts/import_ba.py
  venv/Scripts/python.exe scripts/import_ba.py --limit 2   # 仅前 2 个明细 sheet（验证）
"""
import os
import sys
import argparse

import openpyxl

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from database import (
    engine, Device, DeviceArchive, DeviceAlias, BaProblem, BaSystemMap, ImportBatch, Subsystem,
)
from sqlalchemy.orm import sessionmaker

# autoflush=True：跨 sheet 同设备 upsert 时能看到已 add 但未 commit 的记录
Session = sessionmaker(bind=engine, autoflush=True)

# 复用 asset_routes 中的种子函数，确保 ba_system_map / subsystems 等参照数据已就绪。
# 否则在 App 未启动的脚本上下文中，问题清单的 ba_system 文本无法映射为 ba_system_code。
from asset_routes import seed_assets  # noqa: E402


def get_or_create_batch(db, fname, segment, imported_by):
    b = db.query(ImportBatch).filter(
        ImportBatch.file_name == fname, ImportBatch.segment_name == segment,
        ImportBatch.imported_by == imported_by).first()
    if b:
        return b
    b = ImportBatch(file_name=fname, segment_name=segment, imported_by=imported_by)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b

DEFAULT_FILE = r"C:/Users/yan/xwechat_files/yan518623234813_611c/msg/file/2026-08/BA系统设备清单_整理汇总.xlsx"

# 明细 sheet 名 → BA 子系统名（用于查询 ba_system_map）
DETAIL_SHEETS = [
    "VRV空调", "一体化空调", "一氧化碳检测", "市政排风",
    "潜污泵", "排风机", "管廊气体监测",
]


def to_str(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else str(v)
    return str(v).strip()


def add_alias(db, canonical: str, alias: str, source: str):
    if not alias or alias == canonical:
        return
    if db.query(DeviceAlias).filter(DeviceAlias.alias_code == alias).first():
        return
    db.add(DeviceAlias(canonical_code=canonical, alias_code=alias, source=source))


def bridge_device_code(db, ba_device_no: str):
    """ba_device_no → canonical device_code（先直查 devices，再经 aliases 桥接）。"""
    if not ba_device_no:
        return None
    if db.query(Device).filter(Device.device_code == ba_device_no).first():
        return ba_device_no
    a = db.query(DeviceAlias).filter(DeviceAlias.alias_code == ba_device_no).first()
    return a.canonical_code if a else None


def import_detail_sheet(db, wb, sheet_name: str):
    ws = wb[sheet_name]
    header = [ws.cell(row=2, column=c).value for c in range(1, ws.max_column + 1)]
    maprow = db.query(BaSystemMap).filter(BaSystemMap.ba_system == sheet_name).first()
    sub_code = maprow.subsystem_code if maprow else "other"
    sub = db.query(Subsystem).filter(Subsystem.code == sub_code).first()
    sub_id = sub.id if sub else None

    batch = get_or_create_batch(db, os.path.basename(DEFAULT_FILE), sheet_name, "import_ba")
    batch.subsystem_hint = sub_code
    batch.area_hint = ""
    batch.status = "done"
    batch.row_count = 0
    batch.file_count = 1

    cnt = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        if not row or all(v is None for v in row):
            continue
        rec = {header[i]: (row[i] if i < len(row) else None) for i in range(len(header))}
        dev_code = to_str(rec.get("设备编号"))
        if not dev_code:
            continue
        group = to_str(rec.get("组别")) or to_str(rec.get("组别/区域"))
        room = to_str(rec.get("房间"))
        loc = group
        if room:
            loc = (loc + " " + room).strip()

        d = db.query(Device).filter(Device.device_code == dev_code).first()
        if not d:
            d = Device(device_code=dev_code, name=dev_code, subsystem_id=sub_id,
                       system_text=sheet_name, source_batch_id=batch.id)
            db.add(d)
        else:
            d.subsystem_id = sub_id
            d.system_text = sheet_name
            d.source_batch_id = batch.id

        da = db.query(DeviceArchive).filter(DeviceArchive.device_code == dev_code).first()
        if not da:
            da = DeviceArchive(
                device_code=dev_code, system_text=sheet_name, subsystem_id=sub_id,
                location=loc, project="T3GTC项目", template="ba_device_v1", status_name="",
                is_active_del=True, source_batch_id=batch.id, extra=rec, is_active=True, qty=1, unit="台",
            )
            db.add(da)
        else:
            da.subsystem_id = sub_id
            da.system_text = sheet_name
            da.location = loc
            da.extra = rec
            da.source_batch_id = batch.id

        add_alias(db, dev_code, dev_code, "ba_device")
        cnt += 1

    batch.row_count = cnt
    db.commit()
    print(f"  · 明细「{sheet_name}」→ {cnt} 设备（Device+DeviceArchive+Alias）")
    return cnt


def import_problems(db, wb):
    ws = wb["问题清单"]
    header = [ws.cell(row=3, column=c).value for c in range(1, ws.max_column + 1)]
    batch = get_or_create_batch(db, os.path.basename(DEFAULT_FILE), "问题清单", "import_ba")
    batch.subsystem_hint = "ba"
    batch.area_hint = ""
    batch.status = "done"
    batch.row_count = 0
    batch.file_count = 1

    cnt = 0
    # 幂等：先清除本批次已有问题，再插入（重复运行不会产生重复行）
    db.query(BaProblem).filter(BaProblem.source_batch_id == batch.id).delete()
    db.flush()
    for row in ws.iter_rows(min_row=4, values_only=True):
        if not row or all(v is None for v in row):
            continue
        rec = {header[i]: (row[i] if i < len(row) else None) for i in range(len(header))}
        ba_system = to_str(rec.get("所属系统"))
        ba_device_no = to_str(rec.get("设备编号"))
        group_area = to_str(rec.get("组别/区域"))
        location = to_str(rec.get("位置"))
        problem_type = to_str(rec.get("问题类型"))
        maprow = db.query(BaSystemMap).filter(BaSystemMap.ba_system == ba_system).first()
        ba_system_code = maprow.code if maprow else None
        device_code = bridge_device_code(db, ba_device_no)
        # 幂等 upsert：同一 (设备编号, 所属系统) 仅保留一条，避免重跑脚本时重复落库
        exist = db.query(BaProblem).filter(
            BaProblem.ba_device_no == ba_device_no, BaProblem.ba_system == ba_system).first()
        if exist:
            exist.device_code = device_code
            exist.ba_system_code = ba_system_code
            exist.problem_type = problem_type
            exist.group_area = group_area
            exist.location = location
            exist.source_batch_id = batch.id
        else:
            db.add(BaProblem(
                ba_device_no=ba_device_no, device_code=device_code, ba_system=ba_system,
                ba_system_code=ba_system_code, problem_type=problem_type, group_area=group_area,
                location=location, status="open", source_batch_id=batch.id,
            ))
            cnt += 1
    # row_count 取本批次真实总数（含幂等 upsert 已存在的行），避免重跑时归零
    batch.row_count = db.query(BaProblem).filter(BaProblem.source_batch_id == batch.id).count()
    db.commit()
    print(f"  · 问题清单 → {cnt} 条新增 / 批次共 {batch.row_count} 条（BaProblem）")
    return cnt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--limit", type=int, default=0, help="仅导入前 N 个明细 sheet（验证用）")
    args = ap.parse_args()

    sheets = DETAIL_SHEETS
    if args.limit:
        sheets = sheets[:args.limit]

    db = Session()
    try:
        # 确保子系统 / ba_system_map 等参照数据已播种（幂等），否则问题清单的 ba_system_code 无法回填
        seed_assets(db)
        wb = openpyxl.load_workbook(args.file, read_only=True, data_only=True)
        total_dev = 0
        for s in sheets:
            if s in wb.sheetnames:
                total_dev += import_detail_sheet(db, wb, s)
            else:
                print(f"  ! 未找到明细 sheet：{s}")
        if "问题清单" in wb.sheetnames:
            import_problems(db, wb)
        # 设备总览统计：仅打印核对
        if "设备总览统计" in wb.sheetnames:
            ws = wb["设备总览统计"]
            print("  · 设备总览统计 sheet 存在（聚合由 /ba/overview 实时计算，不单独落库）")
        wb.close()
        print(f"BA 导入完成：明细设备 {total_dev} 台。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
