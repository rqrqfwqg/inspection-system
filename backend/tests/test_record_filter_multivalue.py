# -*- coding: utf-8 -*-
"""筛选条件**多值**（一条条件内多选）与**命中归因** · 真值表验证

跑法：
  cd inspection-system/backend
  venv/Scripts/python.exe tests/test_record_filter_multivalue.py

覆盖：
  A. 多值组内语义（正算子 OR / **否定算子 AND**）
  B. 单值逐字节等价（values 长度 1 == 老 value 结构，且 SQL 不套 or_）
  C. 组间 AND/OR 与多值正交
  D. 解析层：去重 / 上限 / values 与 value 共存 / 空值丢弃 / 非法输入 400
  E. 命中归因端点：counts[i] **必须等于**单独用第 i 条条件实筛的行数
  F. 归因守恒：combined 与 list_records 实筛条数一致（两者必须同源）
  G. 多值与候选下拉 count 一致（选中的值 sum(count) == 实筛命中）

真值表 6 行：第 4 行 device_code=NULL、第 5 行缺 box_code 键、
第 6 行 box_code 含字面通配符 C_%x（验证多值下转义仍生效且不误伤）。
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 🔴 必须在改 engine 之前导入

# 🔴 asset_routes 的 get_db 用的是 database 模块的**全局** engine（指向 backend/app.db
#    —— 本机那份是过期示范副本）。不重绑就会打到真库：读不到 seed 数据，
#    还会报 no such column: users.username。用 tempfile 不落仓库。
_TMP = tempfile.mkdtemp(prefix="mv_filter_")
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

from record_filters import (  # noqa: E402
    parse_filters, build_filter_clause, FilterError, DEVICE_CODE_FIELD,
    MAX_VALUES_PER_COND, NEGATIVE_OPS,
)

# 🔴 asset_routes.router 自带 prefix="/assets"，此处只能再挂 "/ops/api"
app = FastAPI()
app.include_router(asset_routes.router, prefix="/ops/api")
client = TestClient(app)

TID = 0
FIELDS = [
    ("floor", "楼层"), ("box_code", "箱号"), ("device_type", "设备类型"),
]
ROWS = [
    (1, "105000000001", {"floor": "交通中心-首层", "box_code": "", "device_type": "空调器"}),
    (2, "105000000002", {"floor": "交通中心-首层", "box_code": "A-1", "device_type": "空调器"}),
    (3, "105000000003", {"floor": "2#楼-2层", "box_code": "B-2", "device_type": "配电箱"}),
    (4, None, {"floor": "2#楼-2层", "box_code": "   ", "device_type": "配电箱"}),
    (5, "105000000005", {"floor": "3#楼-3层", "device_type": "水泵"}),
    (6, "105000000006", {"floor": "交通中心-首层", "box_code": "C_%x", "device_type": "ups"}),
]
PASS = []


def check(name, cond, extra=""):
    PASS.append(bool(cond))
    print(f"  {'ok  ' if cond else 'FAIL'} {name}{('  ' + extra) if extra else ''}")


def seed():
    global TID
    db = database.SessionLocal()
    sub = Subsystem(name="多值测试子系统", code="mv_sub")
    db.add(sub)
    db.flush()
    tbl = DataTable(name="多值筛选测试表", code="mv_probe", subsystem_id=sub.id)
    db.add(tbl)
    db.flush()
    TID = tbl.id
    for key, label in FIELDS:
        db.add(FieldDef(table_id=tbl.id, key=key, label=label, type="text", sort_order=0))
    db.flush()
    for rid, dc, data in ROWS:
        db.add(Record(table_id=tbl.id, device_code=dc, data=data))
    db.commit()
    db.close()


def ids(filters=None, logic=None, q=None):
    params = {}
    if filters is not None:
        params["filters"] = json.dumps(filters, ensure_ascii=False)
    if logic is not None:
        params["filter_logic"] = logic
    if q is not None:
        params["q"] = q
    r = client.get(f"/ops/api/assets/tables/{TID}/records", params=params)
    assert r.status_code == 200, f"期望 200 实得 {r.status_code}: {r.text[:200]}"
    return sorted(item["id"] for item in r.json())


def stats(filters=None, logic=None, q=None):
    params = {}
    if filters is not None:
        params["filters"] = json.dumps(filters, ensure_ascii=False)
    if logic is not None:
        params["filter_logic"] = logic
    if q is not None:
        params["q"] = q
    r = client.get(f"/ops/api/assets/tables/{TID}/filter-stats", params=params)
    return r


def st_body(filters=None, logic=None, q=None):
    r = stats(filters, logic, q)
    assert r.status_code == 200, f"期望 200 实得 {r.status_code}: {r.text[:200]}"
    return r.json()


FL1 = "交通中心-首层"
F2 = "2#楼-2层"
F3 = "3#楼-3层"

seed()

# ---------------------------------------------------------------- A 组内语义
print("=== A. 多值组内语义 ===")
check("eq 多值 = OR",
      ids([{"field": "floor", "op": "eq", "values": [F3, F2]}]) == [3, 4, 5],
      str(ids([{"field": "floor", "op": "eq", "values": [F3, F2]}])))
check("eq 多值顺序无关",
      ids([{"field": "floor", "op": "eq", "values": [F2, F3]}]) == [3, 4, 5])
# 🔴 核心不变量：ne 多值必须编译成 AND。若按 OR 编译会返回全表 [1..6]
check("ne 多值 = AND（非全表！）",
      ids([{"field": "floor", "op": "ne", "values": [F2, F3]}]) == [1, 2, 6],
      str(ids([{"field": "floor", "op": "ne", "values": [F2, F3]}])))
check("not_contains 多值 = AND",
      ids([{"field": "box_code", "op": "not_contains", "values": ["A-1", "B-2"]}]) == [1, 4, 5, 6])
check("contains 多值 = OR",
      ids([{"field": "box_code", "op": "contains", "values": ["A-1", "B-2"]}]) == [2, 3])
check("starts_with 多值 = OR",
      ids([{"field": "box_code", "op": "starts_with", "values": ["A", "B"]}]) == [2, 3])
check("ends_with 多值 = OR",
      ids([{"field": "box_code", "op": "ends_with", "values": ["-1", "-2"]}]) == [2, 3])
check("is_empty 忽略 values（= 单值）",
      ids([{"field": "box_code", "op": "is_empty", "values": ["A-1"]}])
      == ids([{"field": "box_code", "op": "is_empty"}]))
check("not_empty 忽略 values",
      ids([{"field": "box_code", "op": "not_empty", "values": ["A-1"]}])
      == ids([{"field": "box_code", "op": "not_empty"}]))
check("关联键多值",
      ids([{"field": "__device_code", "op": "eq",
            "values": ["105000000002", "105000000005"]}]) == [2, 5])
# 大小写不敏感：device_type 第 6 行是 "ups"，其余空调器
check("eq 多值大小写不敏感",
      ids([{"field": "device_type", "op": "eq", "values": ["UPS"]}]) == [6])
check("多值含重复/大小写变体不重复计数",
      ids([{"field": "device_type", "op": "eq", "values": ["ups", "UPS"]}]) == [6])

# 🔴 守恒：eq 多值 == 各单值并集；ne 多值 == 各单值交集
eq_all = ids([{"field": "floor", "op": "eq", "values": [F2, F3]}])
eq_u = sorted(set(ids([{"field": "floor", "op": "eq", "value": F2}])
                  ) | set(ids([{"field": "floor", "op": "eq", "value": F3}])))
check("守恒 eq多值 == 单值并集", eq_all == eq_u, f"{eq_all} vs {eq_u}")
ne_all = ids([{"field": "floor", "op": "ne", "values": [F2, F3]}])
ne_i = sorted(set(ids([{"field": "floor", "op": "ne", "value": F2}])
                  ) & set(ids([{"field": "floor", "op": "ne", "value": F3}])))
check("守恒 ne多值 == 单值交集（= NOT(OR)）", ne_all == ne_i, f"{ne_all} vs {ne_i}")
check("守恒 eq+ne == 全表",
      sorted(eq_all + ne_all) == [1, 2, 3, 4, 5, 6],
      f"{sorted(eq_all + ne_all)}")

# ---------------------------------------------------------- B 单值逐字节等价
print("=== B. 单值等价 & SQL 形状 ===")
one_v = [{"field": "floor", "op": "eq", "values": [FL1]}]
one_o = [{"field": "floor", "op": "eq", "value": FL1}]
check("values 长度1 == 老 value 结构（结果）", ids(one_v) == ids(one_o))
c1 = build_filter_clause(
    [{"field": "floor", "op": "eq", "values": [FL1]}], "and")
c2 = build_filter_clause([{"field": "floor", "op": "eq", "value": FL1}], "and")
check("values 长度1 == 老 value 结构（SQL 逐字节）",
      str(c1.compile()) == str(c2.compile()))
check("单值不套 or_（SQL 无 OR 关键字）",
      " OR " not in str(c1.compile()).upper(),
      str(c1.compile()))
c3 = build_filter_clause(
    [{"field": "floor", "op": "eq", "values": [FL1, F2]}], "and")
check("多值确实套 or_", " OR " in str(c3.compile()).upper())

# ------------------------------------------------------- C 组间与组内正交
print("=== C. 组间 AND/OR 与组内正交 ===")
mv = [{"field": "floor", "op": "eq", "values": [F2, F3]},
      {"field": "device_type", "op": "eq", "value": "配电箱"}]
check("组内OR + 组间AND", ids(mv, logic="and") == [3, 4], str(ids(mv, logic="and")))
# 手算：floor∈(F2,F3)=[3,4,5]；device_type=配电箱=[3,4]；OR = [3,4,5]
check("组内OR + 组间OR", ids(mv, logic="or") == [3, 4, 5],
      str(ids(mv, logic="or")))
mv_neg = [{"field": "floor", "op": "ne", "values": [F2, F3]},
          {"field": "box_code", "op": "not_empty"}]
check("组内AND + 组间AND", ids(mv_neg, logic="and") == [2, 6],
      str(ids(mv_neg, logic="and")))

# ------------------------------------------------------------ D 解析层校验
print("=== D. 解析层校验 ===")


def parse(raw, allowed=None):
    return parse_filters(json.dumps(raw, ensure_ascii=False),
                         allowed or {"floor", "box_code", "device_type", DEVICE_CODE_FIELD})


def expect_err(name, raw, needle):
    try:
        parse(raw)
    except FilterError as exc:
        check(name, needle in str(exc), str(exc)[:70])
        return
    check(name, False, "没报错")


conds, _ = parse([{"field": "floor", "op": "eq", "values": ["A", "a", " B ", ""]}])
check("values 去重(ASCII折叠)+去空白", conds[0]["values"] == ["A", " B ".strip()],
      str(conds[0]["values"]))
conds, _ = parse([{"field": "floor", "op": "eq", "values": ["A"], "value": "B"}])
check("values 与 value 共存 → 以 values 为准", conds[0]["values"] == ["A"],
      str(conds[0]["values"]))
conds, _ = parse([{"field": "floor", "op": "eq", "values": []}])
check("values 空数组 → 丢弃该条", conds == [], str(conds))
conds, _ = parse([{"field": "floor", "op": "eq", "values": ["", "  "]}])
check("values 全空白 → 丢弃该条", conds == [], str(conds))
conds, _ = parse([{"field": "floor", "op": "is_empty", "values": ["A"]}])
check("空值算子 values 归一为空", conds[0]["values"] == [], str(conds[0]["values"]))
conds, _ = parse([{"field": "floor", "op": "eq", "values": "A"}])
check("values 误传字符串 → 按单元素容错", conds[0]["values"] == ["A"],
      str(conds[0]["values"]))
expect_err("values 非数组非字符串 → 400",
           [{"field": "floor", "op": "eq", "values": 123}], "必须是字符串数组")
expect_err("values 超上限 → 400",
           [{"field": "floor", "op": "eq", "values": ["v"] * (MAX_VALUES_PER_COND + 1)}],
           "超过单条上限")
conds, _ = parse([{"field": "floor", "op": "eq", "values": ["v"] * MAX_VALUES_PER_COND}])
check("values 恰在上限 → 放行", len(conds) == 1)
expect_err("values 里的未知字段仍 400",
           [{"field": "no_such", "op": "eq", "values": ["A"]}], "不属于这张表")
expect_err("values 里的未知 op 仍 400",
           [{"field": "floor", "op": "regex", "values": ["A"]}], "不支持")
expect_err("values 里的注入字段名仍 400",
           [{"field": "floor; DROP TABLE records--", "op": "eq", "values": ["A"]}],
           "不属于这张表")
# 超长单值截断（不报错，与 value 同口径）
long_v = "x" * 500
conds, _ = parse([{"field": "floor", "op": "eq", "values": [long_v]}])
check("values 单元素超长截断到 200", len(conds[0]["values"][0]) == 200,
      str(len(conds[0]["values"][0])))
# 绑定参数唯一性：多值不能互相覆盖
clause = build_filter_clause(
    [{"field": "floor", "op": "eq", "values": ["AAA", "BBB"]}], "and")
params = dict(clause.compile().params)
check("多值绑定参数唯一（pv_0_0 / pv_0_1）",
      "pv_0_0" in params and "pv_0_1" in params, str(list(params)))
check("NEGATIVE_OPS 与实现一致", NEGATIVE_OPS == {"ne", "not_contains"}, str(NEGATIVE_OPS))

# ------------------------------------------------------------ E 命中归因
print("=== E. 命中归因端点 ===")
pair = [{"field": "floor", "op": "eq", "values": [F2, F3]},
        {"field": "box_code", "op": "not_empty"}]
body = st_body(pair, logic="and")
check("counts 与条件等长同序", len(body["counts"]) == len(pair), str(body))
check("total = 不带条件行数", body["total"] == 6, str(body["total"]))
# 手算：floor∈(F2,F3)=[3,4,5]；box_code 非空=[2,3,6]；AND 交集=[3] → 1 行
check("combined == 全部条件组合后行数", body["combined"] == 1, str(body["combined"]))
check("counts[0] = 只用第1条（floor多值）", body["counts"][0] == 3, str(body["counts"][0]))
check("counts[1] = 只用第2条（box_code非空）", body["counts"][1] == 3, str(body["counts"][1]))
# 🔴 核心不变量：归因数字必须等于单独实筛的行数
mismatch = []
for i, cond in enumerate(pair):
    real = len(ids([cond]))
    if real != body["counts"][i]:
        mismatch.append((i, body["counts"][i], real))
check("归因 counts[i] == 单独实筛行数", not mismatch, str(mismatch))

print("=== E2. 归因在各种组合下都自洽 ===")
cases = [
    ("AND 无交集", [{"field": "floor", "op": "eq", "value": F3},
                {"field": "device_type", "op": "eq", "value": "空调器"}], "and"),
    ("OR", [{"field": "floor", "op": "eq", "value": F3},
            {"field": "device_type", "op": "eq", "value": "空调器"}], "or"),
    ("多值+否定", [{"field": "floor", "op": "ne", "values": [F2, F3]},
               {"field": "box_code", "op": "is_empty"}], "and"),
    ("含空值算子", [{"field": "box_code", "op": "is_empty"},
                {"field": "floor", "op": "eq", "value": F2}], "and"),
    ("关联键多值", [{"field": "__device_code", "op": "eq",
                 "values": ["105000000002", "105000000003"]}], "and"),
]
for name, conds, logic in cases:
    b = st_body(conds, logic=logic)
    bad = []
    for i, c in enumerate(conds):
        real = len(ids([c]))
        if real != b["counts"][i]:
            bad.append((i, b["counts"][i], real))
    real_all = len(ids(conds, logic=logic))
    check(f"{name}: counts 逐条对齐", not bad, str(bad))
    check(f"{name}: combined == 实筛", b["combined"] == real_all,
          f'stats={b["combined"]} real={real_all}')

# 无条件
b = st_body(None)
check("无条件：counts=[]", b["counts"] == [] and b["combined"] == b["total"] == 6, str(b))
# 与 q 共存
b = st_body([{"field": "floor", "op": "eq", "value": F2}], logic="and", q="配电")
check("归因与 q 共存：total 已含 q", b["total"] == len(ids(None, q="配电")), str(b))
check("归因与 q 共存：counts[i] 已含 q", b["counts"][0] == len(ids([{"field": "floor", "op": "eq", "value": F2}], q="配电")), str(b))
# 非法条件 400（与 list_records 一致）
r = stats([{"field": "no_such", "op": "eq", "values": ["A"]}])
check("非法条件 → 400", r.status_code == 400, str(r.status_code))
check("400 带人话原因", "不属于这张表" in r.text, r.text[:90])

# --------------------------------------------------- F 多值 vs 候选下拉 count
print("=== F. 多值命中 == 候选 count 之和 ===")
for field in ("device_type", "box_code", "floor"):
    r = client.get(f"/ops/api/assets/tables/{TID}/field-values",
                   params={"field": field, "limit": 200})
    assert r.status_code == 200, r.text[:200]
    cands = r.json()["values"]
    picked = [c["value"] for c in cands[:3]]
    if not picked:
        continue
    b = st_body([{"field": field, "op": "eq", "values": picked}], logic="and")
    real = len(ids([{"field": field, "op": "eq", "values": picked}]))
    exp = sum(c["count"] for c in cands[:3])
    check(f"{field}: 多值实筛 == 候选 count 之和", b["combined"] == real == exp,
          f"stats={b['combined']} real={real} expect={exp}")

# ---------------------------------------------------------------- 汇总
print()
total = len(PASS)
ok = sum(1 for p in PASS if p)
print(f"通过 {ok} / {total}")
if ok != total:
    raise SystemExit(1)
print("全部通过")