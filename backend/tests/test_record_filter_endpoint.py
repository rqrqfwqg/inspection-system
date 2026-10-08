# -*- coding: utf-8 -*-
"""数据表记录结构化条件筛选 · 端点级验证（临时 sqlite，不碰生产）

覆盖 GET /assets/tables/{tid}/records 的 filters / filter_logic：
  - 8 算子端到端命中数正确
  - AND / OR 组合
  - 与既有 q 共存（AND 关系）
  - 不传 filters 时与改造前逐字节一致（向后兼容）
  - 非法条件一律 400 且带人话原因（不静默忽略）
  - 白名单：筛不属于该表的字段 → 400
  - 分页在筛选之后施加（命中集的分页）

运行：
  cd inspection-system/backend
  venv/Scripts/python.exe tests/test_record_filter_endpoint.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 必须在改 engine 之前导入

_TMP = tempfile.mkdtemp(prefix="rec_filter_")
_DB_PATH = os.path.join(_TMP, "test.db")
database.DATABASE_URL = f"sqlite:///{_DB_PATH}"
database.engine = database.create_engine(
    database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = database.sessionmaker(
    autocommit=False, autoflush=False, bind=database.engine)
database.init_db()

from database import DataTable, FieldDef, Record, Subsystem  # noqa: E402
import asset_routes  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# 🔴 asset_routes.router 自带 prefix="/assets"，此处只能再挂 "/ops/api"，
#    挂两次会变成 /assets/assets/... 全 404（已踩过的坑）
app = FastAPI()
app.include_router(asset_routes.router, prefix="/ops/api")
client = TestClient(app)

TID = 0  # seed() 后由真实自增 id 覆盖
FIELDS = [
    ("floor", "楼层"), ("box_code", "箱号"), ("device_type", "设备类型"),
]
ROWS = [
    (1, "105000000001", {"floor": "交通中心-首层", "box_code": "", "device_type": "空调器"}),
    (2, "105000000002", {"floor": "交通中心-首层", "box_code": "A-1", "device_type": "空调器"}),
    (3, "105000000003", {"floor": "2#楼-2层", "box_code": "B-2", "device_type": "配电箱"}),
    (4, None, {"floor": "2#楼-2层", "box_code": "   ", "device_type": "配电箱"}),
    (5, "105000000005", {"floor": "3#楼-3层", "device_type": "水泵"}),
    (6, "105000000006", {"floor": "交通中心-首层", "box_code": "C_%x", "device_type": "空调器"}),
]
PASS = []


def check(name, cond, extra=""):
    PASS.append(bool(cond))
    print(f"  {'ok  ' if cond else 'FAIL'} {name}{('  ' + extra) if extra else ''}")


def seed():
    global TID
    db = database.SessionLocal()
    sub = Subsystem(name="测试子系统", code="t_sub")
    db.add(sub)
    db.flush()
    tbl = DataTable(name="筛选测试表", code="filter_probe", subsystem_id=sub.id)
    db.add(tbl)
    db.flush()
    TID = tbl.id
    for key, label in FIELDS:
        db.add(FieldDef(table_id=tbl.id, key=key, label=label, type="text",
                        sort_order=0))
    db.flush()
    for rid, dc, data in ROWS:
        db.add(Record(table_id=tbl.id, device_code=dc, data=data))
    db.commit()
    db.close()


def get(filters=None, logic=None, q=None, skip=None, limit=None):
    params = {}
    if filters is not None:
        params["filters"] = json.dumps(filters, ensure_ascii=False)
    if logic is not None:
        params["filter_logic"] = logic
    if q is not None:
        params["q"] = q
    if skip is not None:
        params["skip"] = skip
    if limit is not None:
        params["limit"] = limit
    r = client.get(f"/ops/api/assets/tables/{TID}/records", params=params)
    return r


def ids(filters=None, logic=None, q=None, skip=None, limit=None):
    r = get(filters, logic, q, skip, limit)
    assert r.status_code == 200, f"期望 200 实得 {r.status_code}: {r.text[:200]}"
    return sorted(item["id"] for item in r.json())


seed()

print("=== A. 8 算子端到端 ===")
FL1 = "交通中心-首层"
check("eq", ids([{"field": "floor", "op": "eq", "value": FL1}]) == [1, 2, 6])
check("ne", ids([{"field": "floor", "op": "ne", "value": FL1}]) == [3, 4, 5])
check("contains", ids([{"field": "floor", "op": "contains", "value": "2#楼"}]) == [3, 4])
check("not_contains", ids([{"field": "floor", "op": "not_contains", "value": "2#楼"}]) == [1, 2, 5, 6])
check("starts_with", ids([{"field": "floor", "op": "starts_with", "value": "交通"}]) == [1, 2, 6])
check("ends_with", ids([{"field": "floor", "op": "ends_with", "value": "-2层"}]) == [3, 4])
check("is_empty(含纯空格/缺键)", ids([{"field": "box_code", "op": "is_empty"}]) == [1, 4, 5])
check("not_empty", ids([{"field": "box_code", "op": "not_empty"}]) == [2, 3, 6])
check("关联键 eq", ids([{"field": "__device_code", "op": "eq", "value": "105000000002"}]) == [2])
check("关联键 is_empty(NULL)", ids([{"field": "__device_code", "op": "is_empty"}]) == [4])

print("=== B. AND / OR ===")
pair = [{"field": "floor", "op": "eq", "value": FL1},
        {"field": "box_code", "op": "is_empty"}]
check("AND", ids(pair, logic="and") == [1])
check("OR", ids(pair, logic="or") == [1, 2, 4, 5, 6])
check("logic 缺省=and", ids(pair) == [1])

print("=== C. 与既有 q 共存（AND 关系）===")
check("filters+q 同时生效",
      ids([{"field": "floor", "op": "eq", "value": FL1}], q="A-1") == [2])
check("仅 q（向后兼容）", ids(None, None, "A-1") == [2])

print("=== D. 不传 filters = 全量（向后兼容）===")
check("无筛选返回 6 条", len(ids()) == 6)
r = get()
check("响应是裸数组", isinstance(r.json(), list), f"type={type(r.json()).__name__}")
check("响应无 total 包装", "total" not in r.json()[0])

print("=== E. 非法条件一律 400 ===")
for name, f, logic in [
    ("未知 op", [{"field": "floor", "op": "regex", "value": "x"}], None),
    ("非本表字段", [{"field": "no_such_field", "op": "eq", "value": "x"}], None),
    ("非法 logic", [{"field": "floor", "op": "eq", "value": FL1}], "xor"),
]:
    r = get(f, logic)
    check(f"{name} → 400", r.status_code == 400, f"实得 {r.status_code}")
    if r.status_code == 400:
        detail = r.json().get("detail", "")
        check(f"{name} 原因可读", isinstance(detail, str) and len(detail) > 4,
              detail[:46])
r = client.get(f"/ops/api/assets/tables/{TID}/records", params={"filters": "{bad json"})
check("非法 JSON → 400", r.status_code == 400, f"实得 {r.status_code}")

print("=== F. SQL 注入不可行 ===")
r = get([{"field": "floor; DROP TABLE records--", "op": "eq", "value": "x"}])
check("注入字段名 → 400", r.status_code == 400, f"实得 {r.status_code}")
check("表仍存活", len(ids()) == 6)

print("=== G. 分页在筛选之后 ===")
page1 = ids([{"field": "device_type", "op": "eq", "value": "空调器"}], skip=0, limit=2)
page2 = ids([{"field": "device_type", "op": "eq", "value": "空调器"}], skip=2, limit=2)
# 命中集 = [1,2,6]（id5 的 device_type 是「水泵」而非「空调器」，不属于本条件）
# 端点固定 id desc 排序 → 顺序 [6,2,1]
check("第1页", page1 == [2, 6], f"got={page1}")
check("第2页", page2 == [1], f"got={page2}")
check("两页不重叠", not set(page1) & set(page2))

print("=== H. LIKE 通配符不被当通配符 ===")
check("contains '%' 只命中字面量",
      ids([{"field": "box_code", "op": "contains", "value": "%"}]) == [6])

print(f"\n通过 {sum(PASS)} / {len(PASS)}")
print("全部通过" if all(PASS) else "有失败项")