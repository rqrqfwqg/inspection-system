# -*- coding: utf-8 -*-
"""字段候选值端点测试（数据表管理「条件筛选」值下拉）

覆盖：
  A. 白名单（拒绝未定义字段 / 拒绝空字段 / 关联键放行）
  B. 取值正确性（__device_code 走独立列；JSON 字段走 json_extract）
  C. 空值不进候选（NULL / 空串 / 纯空白都排除）
  D. count 正确 + 排序（count DESC, value ASC）
  E. q 过滤（ASCII 折叠；与 contains 算子同口径；q 超长截断不报错）
  F. limit 夹紧 [1,200] + truncated 标记
  G. 🔴 与筛选的一致性：候选里的每个值都能被 eq 筛出，且条数等于 count
  H. 缓存命中后仍返回正确结果；reset 后重算
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 必须在改 engine 之前导入

# 🔴 必须重绑 database.engine / SessionLocal：asset_routes 里的 get_db 用的是
#    database 模块的**全局** engine（指向 backend/app.db —— 本机那份是过期示范副本）。
#    不重绑就会打到真库上：既读不到 seed 数据，又会因旧 schema 报
#    「no such column: users.username」。用 tempfile 不落仓库。
_TMP = tempfile.mkdtemp(prefix="field_values_")
database.DATABASE_URL = "sqlite:///" + os.path.join(_TMP, "test.db")
database.engine = database.create_engine(
    database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = database.sessionmaker(
    autocommit=False, autoflush=False, bind=database.engine)
database.init_db()

from database import Base, DataTable, FieldDef, Record  # noqa: E402
import asset_routes  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from record_field_values import reset_cache  # noqa: E402

Session = database.sessionmaker(bind=database.engine)
db = Session()

# ---- 造一张表：关联键 panel_code，另加 device_name / category / blank 三个字段 ----
tbl = DataTable(name="候选值测试表", code="fv_probe", subsystem_id=8, is_active=True)
db.add(tbl)
db.flush()

db.add_all([
    FieldDef(table_id=tbl.id, key="panel_code", label="固定资产编号", type="text",
             is_relation_key=True, sort_order=1),
    FieldDef(table_id=tbl.id, key="device_name", label="设备名称", type="text", sort_order=2),
    FieldDef(table_id=tbl.id, key="category", label="设备类别", type="text", sort_order=3),
    FieldDef(table_id=tbl.id, key="blank", label="空值列", type="text", sort_order=4),
])
db.flush()
TID = tbl.id

# 构造真值：
#   device_name：UPS×3（大小写混杂）、ups×1、变压器×2 → 测 ASCII 折叠与 count
#   blank：全部为空（""/纯空白/缺键）→ 候选必须为空
#   category：含字面 % 与 _ 的值 → 候选不受 LIKE 通配符影响
rows = [
    ("1050001", "UPS", "A%组", ""),
    ("1050002", "ups", "A%组", "   "),
    ("1050003", "UPS", "B_组", None),          # 缺键
    ("1050004", "变压器", "A%组", ""),
    ("1050005", "变压器", None, "  "),
]
for code, name, cat, blank in rows:
    data = {"panel_code": code}      # 关联键字段的值与 device_code 列同值（线上真实形态）
    if name is not None:
        data["device_name"] = name
    if cat is not None:
        data["category"] = cat
    if blank is not None:
        data["blank"] = blank
    db.add(Record(table_id=TID, device_code=code, data=data))
db.commit()
TOTAL_ROWS = len(rows)

# 🔴 asset_routes.router 自带 prefix="/assets"，测试应用只能再挂 "/ops/api"
app = FastAPI()
app.include_router(asset_routes.router, prefix="/ops/api")
client = TestClient(app)

passed = 0
failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        print("  ok   %-46s %s" % (label, got))
        passed += 1
    else:
        print("  FAIL %-46s got=%r want=%r" % (label, got, want))
        failed += 1


def check_true(label, cond, extra=""):
    check(label + (" " + extra if extra else ""), bool(cond), True)


def fv(field, **kw):
    r = client.get("/ops/api/assets/tables/%d/field-values" % TID, params=dict(field=field, **kw))
    if r.status_code == 200:
        return r.status_code, r.json()
    # 🔴 400 也返回 json（全局异常处理器包成 {"code":40000,"detail":"..."}），
    #    刻意不返回 text —— 否则下面「带人话原因」的断言会假阴性。
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, {"detail": r.text[:160]}


def eq_count(field, value):
    """用筛选端点做 eq，返回命中条数（验证候选 count 与实际筛选一致）。"""
    return _filter_count(field, "eq", value)


def not_empty_count(field):
    """用 not_empty 算子数该字段非空行数（守恒式的另一半，与候选侧完全独立）。"""
    return _filter_count(field, "not_empty", "")


def _filter_count(field, op, value):
    import json as _json
    r = client.get("/ops/api/assets/tables/%d/records" % TID, params={
        "filters": _json.dumps([{"field": field, "op": op, "value": value}], ensure_ascii=False),
    })
    return len(r.json()) if r.status_code == 200 else -1


print("\n=== A. 白名单 ===")
code, body = fv("panel_code")
check("关联键字段放行", code, 200)
code, body = fv("no_such_field")
check("未定义字段 → 400", code, 400)
check_true("400 带人话原因", isinstance(body, dict) and "不属于这张表" in str(body), str(body)[:80])
code, body = fv("")
check("空字段 → 400", code, 400)
code, body = fv("   ")
check("纯空白字段 → 400", code, 400)

print("\n=== B. 取值正确性 ===")
code, body = fv("device_name", limit=50)
check("device_name 200", code, 200)
vals = {v["value"]: v["count"] for v in body["values"]}
check("候选集合（大小写折叠后）", sorted(vals.keys()), ["UPS", "变压器"])
check("折叠后 distinct 总数", body["total"], 2)
code, body2 = fv("panel_code", limit=50)
check("关联键走独立列 → 5 个候选", body2["total"], 5)
check_true("关联键候选含真实编号", "1050001" in {v["value"] for v in body2["values"]})

print("\n=== C. 空值不进候选 ===")
code, body = fv("blank", limit=50)
check("全空字段 → 200", code, 200)
check("全空字段候选为空", body["values"], [])
check("全空字段 total=0", body["total"], 0)
code, body = fv("category", limit=50)
catvals = {v["value"] for v in body["values"]}
check_true("缺键不产生空候选", "" not in catvals and None not in catvals, str(sorted(catvals)))

print("\n=== D. count 与排序 ===")
code, body = fv("device_name", limit=50)
seq = [(v["value"], v["count"]) for v in body["values"]]
# 🔴 UPS(2) + ups(1) 必须合并成一项 UPS(3)：eq 大小写不敏感，候选必须与之一致
check("大小写折叠合并 + count 降序 + 同频 value 升序", seq, [("UPS", 3), ("变压器", 2)])
check("returned 与实际条数一致", body["returned"], len(body["values"]))
check("matched（无 q）== total", body["matched"], body["total"])
code, body = fv("category", limit=50)
check("字面 % 不被当通配符 → A%组 计数正确",
      {v["value"]: v["count"] for v in body["values"]}, {"A%组": 3, "B_组": 1})

print("\n=== E. q 过滤（ASCII 折叠） ===")
code, body = fv("device_name", q="ups", limit=50)
check("q=ups 命中合并后的 UPS 项", [v["value"] for v in body["values"]], ["UPS"])
check("q 后 matched", body["matched"], 1)
check("q 后 total 仍是全量", body["total"], 2)
code, body = fv("device_name", q="UPS", limit=50)
check("q=UPS 与 q=ups 等价", [v["value"] for v in body["values"]], ["UPS"])
code, body = fv("device_name", q="变压", limit=50)
check("q 子串（中文）", [v["value"] for v in body["values"]], ["变压器"])
code, body = fv("device_name", q="不存在zzz", limit=50)
check("q 无命中 → 空列表不报错", body["values"], [])
check("q 无命中 → matched=0", body["matched"], 0)
code, _ = fv("device_name", q="x" * 500, limit=50)
check("q 超长截断不报错", code, 200)
code, body = fv("category", q="%", limit=50)
check("q=% 找字面 % （转义生效）", [v["value"] for v in body["values"]], ["A%组"])
code, body = fv("category", q="_", limit=50)
check("q=_ 找字面 _ （转义生效）", [v["value"] for v in body["values"]], ["B_组"])

print("\n=== F. limit 夹紧 + truncated ===")
code, body = fv("device_name", limit=1)
check("limit=1 → returned 1", body["returned"], 1)
check("limit=1 → truncated=True", body["truncated"], True)
check("limit=1 → matched 仍全量", body["matched"], body["total"])
code, body = fv("device_name", limit=9999)
check("limit 上限 200 → returned<=200", body["returned"] <= 200, True)
code, body = fv("device_name", limit=0)
check("limit=0 夹到 1 → returned 1", body["returned"], 1)
code, body = fv("device_name", limit=-5)
check("limit=-5 夹到 1 → returned 1", body["returned"], 1)
code, body = fv("device_name", limit="abc")
# 🔴 limit 声明为 Optional[int]，非数字由 FastAPI/pydantic 在进本模块前拦下 → 422。
#    与同族端点 list_records 完全一致（那里也是 422），故此处不强行改 400：
#    把查询参声明成 str 再自己解析只会让两个端点的校验行为不一致。
check("limit 非数字 → 4xx（pydantic 拦，与 list_records 同口径）", str(code)[0], "4")
code, body = fv("device_name", limit=50)
check("limit 够大 → truncated=False", body["truncated"], False)

print("\n=== G. 🔴 候选与实际筛选一致（核心不变量） ===")
for field in ("device_name", "category", "panel_code"):
    code, body = fv(field, limit=50)
    mismatch = []
    for item in body["values"]:
        real = eq_count(field, item["value"])
        if real != item["count"]:
            mismatch.append((item["value"], item["count"], real))
    check_true("%s 全部候选 count 与 eq 实筛一致" % field, not mismatch, str(mismatch[:3]))
# 守恒：候选 count 之和 == 该字段非空行数（不漏不重）
# 非空行数用 not_empty 算子**独立**问出来（不写死常量），
# 这样若将来 seed 数据变了，守恒式仍自动成立。
for field in ("device_name", "category", "panel_code"):
    code, body = fv(field, limit=50)
    sum_counts = sum(v["count"] for v in body["values"])
    check("%s 候选 count 之和 == not_empty 行数" % field, sum_counts, not_empty_count(field))

print("\n=== H. 缓存 ===")
code, b1 = fv("device_name", limit=50)
code, b2 = fv("device_name", limit=50)
check("重复调用结果一致（缓存命中）", b1["values"], b2["values"])
reset_cache()
code, b3 = fv("device_name", limit=50)
check("reset 后重算结果仍一致", b1["values"], b3["values"])

db.close()

print("\n" + "=" * 60)
print("通过 %d / %d" % (passed, passed + failed))
if failed:
    print("失败 %d 项" % failed)
    sys.exit(1)
print("全部通过")
