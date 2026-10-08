# -*- coding: utf-8 -*-
"""数据表记录结构化条件筛选（record_filters）· 真值表测试 33 项

跑法：`backend/venv/Scripts/python.exe tests/test_record_filters.py`
（必须用项目 venv：隔离 venv 未装 sqlalchemy）

覆盖：
  A. 8 个算子语义（eq/ne/contains/not_contains/starts_with/ends_with/is_empty/not_empty）
  B. LIKE 通配符 % _ 转义（§13 事故③：`q=%` 曾命中全表）
  C. AND / OR 组合、空条件
  D. 解析层校验（注入字段名 / 未知 op / 超限 / 非法 JSON）
构造 6 行真值表：第 4 行 device_code=NULL、第 5 行缺 box_code 键、
第 6 行 box_code 含字面通配符 C_%x（验证转义生效且不误伤）。
"""
import sys, json, os
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HERE)

from sqlalchemy import create_engine, text as sa_text
from record_filters import (
    parse_filters, parse_logic, build_filter_clause, FilterError, DEVICE_CODE_FIELD,
)

_PROBE_DB = os.path.join(_HERE, "tests", "_filter_probe.db")
if os.path.exists(_PROBE_DB):
    os.remove(_PROBE_DB)
eng = create_engine("sqlite:///" + _PROBE_DB.replace("\\", "/"), future=True)
db = eng.connect()
db.execute(sa_text("CREATE TABLE records (id INTEGER PRIMARY KEY, table_id INT, device_code TEXT, data TEXT)"))
rows = [
    (1, "105000000001", {"floor": u"\u4ea4\u901a\u4e2d\u5fc3-\u9996\u5c42", "box_code": "",   "device_type": u"\u7a7a\u8c03\u5668"}),
    (2, "105000000002", {"floor": u"\u4ea4\u901a\u4e2d\u5fc3-\u9996\u5c42", "box_code": "A-1", "device_type": u"\u7a7a\u8c03\u5668"}),
    (3, "105000000003", {"floor": u"2#\u697c-2\u5c42",     "box_code": "B-2", "device_type": u"\u914d\u7535\u7bb1"}),
    (4, None,            {"floor": u"2#\u697c-2\u5c42",     "box_code": "   ", "device_type": u"\u914d\u7535\u7bb1"}),
    (5, "105000000005", {"floor": u"3#\u697c-3\u5c42",     "device_type": u"\u6c34\u6cf5"}),
    (6, "105000000006", {"floor": u"\u4ea4\u901a\u4e2d\u5fc3-\u9996\u5c42", "box_code": "C_%x", "device_type": u"\u7a7a\u8c03\u5668"}),
]
for i, dc, d in rows:
    db.execute(sa_text("INSERT INTO records VALUES (:i,:t,:dc,CAST(:d AS TEXT))"),
               {"i": i, "t": 1, "dc": dc, "d": json.dumps(d, ensure_ascii=False)})
db.commit()
TOTAL = len(rows)
FIELDS = set(["floor","box_code","device_type","x", DEVICE_CODE_FIELD])
FL1 = u"\u4ea4\u901a\u4e2d\u5fc3-\u9996\u5c42"
F2  = u"2#\u697c"
E = []
def t(name, conds, logic, expect):
    got = run(conds, logic)
    ok = got == expect
    E.append(ok)
    print("  %s %-34s got=%s expect=%s" % ("ok " if ok else "FAIL", name, got, expect))
def run(conds, logic="and"):
    clause = build_filter_clause(conds, logic)
    if clause is None: return list(range(1, TOTAL+1))
    c = clause.compile()
    sql = "SELECT id FROM records WHERE table_id=1 AND " + str(c)
    return sorted(r[0] for r in db.execute(sa_text(sql), dict(c.params)).fetchall())

print("=== A. 8 ops semantics ===")
t("eq", [{"field":"floor","op":"eq","value":FL1}], "and", [1,2,6])
t("ne", [{"field":"floor","op":"ne","value":FL1}], "and", [3,4,5])
t("contains", [{"field":"floor","op":"contains","value":F2}], "and", [3,4])
t("not_contains", [{"field":"floor","op":"not_contains","value":F2}], "and", [1,2,5,6])
t("starts_with", [{"field":"floor","op":"starts_with","value":FL1[:3]}], "and", [1,2,6])
t("ends_with", [{"field":"floor","op":"ends_with","value":u"-2\u5c42"}], "and", [3,4])
t("is_empty(incl space+missing)", [{"field":"box_code","op":"is_empty"}], "and", [1,4,5])
t("not_empty", [{"field":"box_code","op":"not_empty"}], "and", [2,3,6])
t("devcode eq", [{"field":DEVICE_CODE_FIELD,"op":"eq","value":"105000000002"}], "and", [2])
t("devcode is_empty(NULL)", [{"field":DEVICE_CODE_FIELD,"op":"is_empty"}], "and", [4])
t("devcode contains 105", [{"field":DEVICE_CODE_FIELD,"op":"contains","value":"105"}], "and", [1,2,3,5,6])
t("case-insensitive eq (abc)", [{"field":"box_code","op":"eq","value":"a-1"}], "and", [2])
print("=== B. LIKE wildcard escape ===")
t("pct literal -> only C_%x", [{"field":"box_code","op":"contains","value":"%"}], "and", [6])
t("under literal -> only C_%x", [{"field":"box_code","op":"contains","value":"_"}], "and", [6])
t("literal C_%x", [{"field":"box_code","op":"contains","value":"C_%x"}], "and", [6])
print("=== C. AND / OR combine ===")
a = [{"field":"floor","op":"eq","value":FL1},{"field":"box_code","op":"is_empty"}]
t("AND", a, "and", [1])
t("OR", a, "or", [1,2,4,5,6])
b = [{"field":"box_code","op":"eq","value":"A-1"},{"field":"device_type","op":"eq","value":u"\u914d\u7535\u7bb1"}]
t("AND empty result", b, "and", [])
t("OR", b, "or", [2,3,4])
t("no conditions = all", [], "and", [1,2,3,4,5,6])
print("=== D. parse-level validation ===")
def chk(lbl, raw, want):
    try:
        r, _ = parse_filters(raw, FIELDS)
        ok = len(r) == want
        print("  %s %-20s -> %d conds" % ("ok " if ok else "FAIL", lbl, len(r)))
    except FilterError as e:
        ok = (want == "reject")
        print("  %s %-20s -> reject(%s)" % ("ok " if ok else "FAIL", lbl, str(e)[:32]))
    E.append(ok)
chk("sql-inject field", json.dumps([{"field":"evil; DROP TABLE records","op":"eq","value":"x"}]), "reject")
chk("unknown op", json.dumps([{"field":"floor","op":"regex","value":"x"}]), "reject")
chk("empty value dropped", json.dumps([{"field":"floor","op":"eq","value":""}]), 0)
chk("empty filters str", "", 0)
chk("none filters", None, 0)
chk("bad json", "{bad", "reject")
chk("not array", json.dumps({"a":1}), "reject")
chk("21 conditions", json.dumps([{"field":"floor","op":"eq","value":"x"}]*21), "reject")
chk("20 conditions ok", json.dumps([{"field":"floor","op":"eq","value":"x"}]*20), 20)
chk("valueless op kept", json.dumps([{"field":"box_code","op":"is_empty"}]), 1)
for lbl, raw, want in [("logic=or","or","or"), ("logic empty","","and"), ("logic bad","xor","reject")]:
    try:
        got = parse_logic(raw); ok = got == want
        print("  %s %-20s -> %s" % ("ok " if ok else "FAIL", lbl, got))
    except FilterError:
        ok = (want == "reject"); print("  %s %-20s -> reject" % ("ok " if ok else "FAIL", lbl))
    E.append(ok)
print("\nPASS %d / %d" % (sum(E), len(E)))
db.close()
