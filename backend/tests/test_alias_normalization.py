"""设备编号别名归一内核 · 本地验证（隔离测试库，不碰生产）。

覆盖两件事：
  A. 写路径归一 —— 已合并的旧编号不会因为「JSON 里还留着 B」而被重新写回records.device_code；
     这是「台账总数反弹」这个风险的直接防线。
  B. 合并侧重算 —— JSON 里的关联键值能被正确改写，且**搜索键刻意不动**。

运行：
  cd inspection-system/backend
  venv/Scripts/python.exe tests/test_alias_normalization.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 必须在改 engine 之前导入

_TMP = tempfile.mkdtemp(prefix="alias_norm_")
_DB_PATH = os.path.join(_TMP, "test.db")
database.DATABASE_URL = f"sqlite:///{_DB_PATH}"
database.engine = database.create_engine(
    database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = database.sessionmaker(
    autocommit=False, autoflush=False, bind=database.engine)
database.init_db()

from database import (DeviceAlias, Device, Record, DataTable, FieldDef,
                      Subsystem, FixedAsset)
import device_alias_normalizer as dn
from device_alias_normalizer import (
    AliasNormalizer, resolve_device_code, get_normalizer, reset_normalizer,
    rewrite_relation_key_value, plan_relation_key_rewrite,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
import asset_routes

PASS, FAIL = [], []


def check(label, cond, extra=""):
    (PASS if cond else FAIL).append(label)
    print(("  ok  " if cond else "  FAIL") + f"  {label}" + (f"  [{extra}]" if extra and not cond else ""))


# ============================ fixtures ============================
db = database.SessionLocal()

# 真实形态的编号：台账编号 105…，旧编号为移交/资产代码形态
A = "105000620288"          # 保留的主设备
B = "105000620289"          # 被合并掉的旧编号 → 写进 device_aliases(source='merge')
OLD = "0603001"# 既有别名（fixed_asset 来源），模拟线上 2327 行之一

sub = db.query(Subsystem).first()
if not sub:
    sub = Subsystem(name="供配电系统", code="power")
    db.add(sub); db.commit(); db.refresh(sub)

for code, name in ((A, "潜水排污泵"), (B, "潜水排污泵")):
    db.add(Device(device_code=code, name=name, subsystem_id=sub.id, is_active=True))
db.add(DeviceAlias(canonical_code=A, alias_code=B, source="merge", remark="设备台账合并"))
db.add(DeviceAlias(canonical_code=A, alias_code=OLD, source="fixed_asset", remark="既有别名"))
db.commit()

# 一张带关联键字段的资料表（device_ref 是 is_relation_key=1）
tbl = DataTable(name="设备资料表", code="t_alias_norm", subsystem_id=sub.id)
db.add(tbl); db.commit(); db.refresh(tbl)
rel_field = FieldDef(table_id=tbl.id, key="device_ref", label="设备编号",
                     is_relation_key=1, is_search_key=0)
search_field = FieldDef(table_id=tbl.id, key="legacy_code", label="旧编号",
                        is_relation_key=0, is_search_key=1)
db.add(rel_field); db.add(search_field); db.commit(); db.refresh(rel_field)

print("\n=== A. 归一内核基础行为 ===")

# A1 直接别名
n = get_normalizer(db)
check("A1 别名 B 归一到 A", n.canonical(B) == A, n.canonical(B))
# A2 规范编号幂等
check("A2 规范编号 A 原样返回", n.canonical(A) == A)
# A3 非别名原样
check("A3 无关编号不受影响", n.canonical("G-1D9APt") == "G-1D9APt")
# A4 既有别名同样生效
check("A4 既有别名 0603001 也归一", n.canonical(OLD) == A)
# A5 空值
check("A5 空值返回空串", n.canonical("") == "" and n.canonical(None) == "")
# A6 边界：空白 / 大小写
check("A6 首尾空白被清理", n.canonical(f"  {B}  ") == A)
# A7 resolve 返回是否重定向
check("A7 resolve 标记重定向", n.resolve(B) == (A, True) and n.resolve(A) == (A, False), str((n.resolve(B), n.resolve(A))))
# A8 is_alias
check("A8 is_alias 判定正确", n.is_alias(B) and not n.is_alias(A), str((n.is_alias(B), n.is_alias(A))))

print("\n=== B. 链式别名抗性（实测线上为 0，但必须有防御）===")
chain = AliasNormalizer({"c": "b", "b": "a", "x": "y"})
check("B1 链式 c→b→a 收敛到 a", chain.canonical("c") == "a", chain.canonical("c"))
check("B2 链式 b→a 收敛到 a", chain.canonical("b") == "a")
# 成环不得死循环
cyc = AliasNormalizer({"p": "q", "q": "p"})
check("B3 成环不崩且不误改", cyc.canonical("p") == "p", cyc.canonical("p"))
# 超深不崩
deep = AliasNormalizer({f"n{i}": f"n{i+1}" for i in range(40)} | {"n40": "root"})
check("B4 超深链不崩", isinstance(deep.canonical("n0"), str))

# 规范编号不得被误标为别名 —— 合并流程靠 is_alias 判断"该编号是否已被合并过"，语义必须准
one = AliasNormalizer({"a": "b"})
check("B5 单跳 a→b：b 不是别名", not one.is_alias("b"), str(one._map))
check("B5b 单跳 a→b：b 不算重定向", one.resolve("b") == ("b", False), str(one.resolve("b")))
check("B5c 单跳 a→b：a 确是别名", one.is_alias("a") and one.canonical("a") == "b")
ch3 = AliasNormalizer({"c": "b", "b": "a"})
check("B5d 链式：c 归一到 a", ch3.canonical("c") == "a", str(ch3.canonical("c")))
check("B5e 链式：b 归一到 a", ch3.canonical("b") == "a")
check("B5f 链式：终点 a 不是别名", not ch3.is_alias("a"), str(ch3._map))
check("B5g 链式：终点 a 不算重定向", ch3.resolve("a") == ("a", False), str(ch3.resolve("a")))
check("B5h 单跳不算链式", len(one.chained_aliases) == 0, str(one.chained_aliases))
check("B5i 三节点才算链式", len(ch3.chained_aliases) >= 1, str(ch3.chained_aliases))

print("\n=== C. 合并侧 JSON 关联键重算 ===")
new, ch = rewrite_relation_key_value({"device_ref": B, "legacy_code": B, "x": 1}, "device_ref", B, A)
check("C1 关联键值被改写为 A", ch and new["device_ref"] == A, str(new))
check("C2 搜索键刻意保留 B（旧编号仍可检索）", new["legacy_code"] == B, str(new))
check("C3 其他字段不动", new["x"] == 1)
check("C4 原对象不被就地修改（无副作用）",
      rewrite_relation_key_value({"device_ref": B}, "device_ref", B, A)[1] is True)
# 值不等于 old_code → 不动
new2, ch2 = rewrite_relation_key_value({"device_ref": "OTHER"}, "device_ref", B, A)
check("C5 值不等于旧编号时不改写", (not ch2) and new2 == {"device_ref": "OTHER"})
# 非字符串值不误伤
new3, ch3 = rewrite_relation_key_value({"device_ref": 12345}, "device_ref", B, A)
check("C6 数值型关联键不误伤", not ch3 and new3["device_ref"] == 12345)
# None / 缺 key
check("C7 None 值不误伤", rewrite_relation_key_value({"device_ref": None}, "device_ref", B, A)[1] is False)
check("C8 缺 key 不报错", rewrite_relation_key_value({"a": 1}, "device_ref", B, A)[1] is False)
check("C9 data 非 dict 兜底", rewrite_relation_key_value(None, "device_ref", B, A)[1] is False)
check("C10 old==new 时不改写", rewrite_relation_key_value({"device_ref": A}, "device_ref", A, A)[1] is False)

print("\n=== D. dry_run 预演与正式执行走同一函数（数字必须一致）===")
rows = [
    (1, {"device_ref": B}, tbl.id),
    (2, {"device_ref": A}, tbl.id),
    (3, {"device_ref": B}, tbl.id),
    (4, {"legacy_code": B}, tbl.id),   # 无关联键 → 不该命中
    (5, {"device_ref": "OTHER"}, tbl.id),
]
plan = plan_relation_key_rewrite(rows, "device_ref", B, A)
check("D1 预演命中 2 行（只算关联键且值等于 B）", plan["count"] == 2, str(plan))
check("D2 预演命中 id 正确", plan["record_ids"] == [1, 3], str(plan["record_ids"]))

print("\n=== E. 写路径防线：旧编号不得复活（核心）===")
app = FastAPI()
app.include_router(asset_routes.router, prefix="/ops/api")
client = TestClient(app)
H = {"X-Dev-User": "admin", "X-Dev-Role": "admin"}

# E1 显式传旧编号 B → 落库必须变成 A
r = client.post(f"/ops/api/assets/tables/{tbl.id}/records",
                json={"device_code": B, "data": {"device_ref": B, "备注": "显式传旧编号"}}, headers=H)
check("E1 显式传 B 返回 200", r.status_code == 200, str(r.status_code) + r.text[:200])
if r.status_code == 200:
    check("E1b 落库 device_code 已被归一为 A", r.json().get("device_code") == A,
          str(r.json().get("device_code")))

# E2 只传 JSON 里的关联键 B（device_code 为空）→ 这是旧编号复活的主路径
r2 = client.post(f"/ops/api/assets/tables/{tbl.id}/records",
                 json={"data": {"device_ref": B, "备注": "仅JSON 关联键"}}, headers=H)
check("E2 仅传关联键 B 返回 200", r2.status_code == 200, str(r2.status_code) + r2.text[:200])
if r2.status_code == 200:
    check("E2b 落库 device_code 已被归一为 A", r2.json().get("device_code") == A,
          str(r2.json().get("device_code")))
    rid2 = r2.json().get("id")

    # E3 把这条记录再编辑一次（JSON 仍留着 B）→ 不得让 B 复活
    r3 = client.put(f"/ops/api/assets/tables/{tbl.id}/records/{rid2}",
                    json={"data": {"device_ref": B, "备注": "再次编辑"}}, headers=H)
    check("E3 再次编辑返回 200", r3.status_code == 200, str(r3.status_code))
    if r3.status_code == 200:
        check("E3b 再次编辑后仍是 A（B 未复活）", r3.json().get("device_code") == A,
              str(r3.json().get("device_code")))

# E4 批量导入
r4 = client.post(f"/ops/api/assets/tables/{tbl.id}/records/bulk",
                 json={"records": [{"data": {"device_ref": B, "备注": "批量1"}},
                                   {"data": {"device_ref": A, "备注": "批量2"}}]}, headers=H)
check("E4 批量导入返回 200", r4.status_code == 200, str(r4.status_code) + r4.text[:200])
if r4.status_code == 200:
    check("E4b 批量创建 2 条", r4.json().get("created") == 2, str(r4.json()))

db.expire_all()
codes = [x[0] for x in db.query(Record.device_code).filter(Record.table_id == tbl.id).all()]
check("E5 库内不存在 device_code == B 的记录（B 彻底没复活）", B not in codes, str(codes))
check("E6 库内该表全部记录都挂在 A 上", all(c == A for c in codes), str(codes))

print("\n=== F. 缓存失效 ===")
#写入一条新别名后必须能立刻被解析（否则合并事务写完别名，旧编号仍解析不到）
db.add(DeviceAlias(canonical_code=A, alias_code="NEWCODE-001", source="merge", remark=""))
db.commit()
# 写入新别名后、且 TTL 未到/未 refresh：返回旧值是**正确的**（有界陈旧窗口）
stale = resolve_device_code(db, "NEWCODE-001")
check("F1 TTL 窗口内保持缓存（陈旧但有界）", stale == "NEWCODE-001", stale)
fresh = resolve_device_code(db, "NEWCODE-001", refresh=True)
check("F2 refresh=True 后立即可见", fresh == A, fresh)

# 跨进程自动失效：模拟「另一个 worker 进程往库里写了别名」——本进程没调 refresh，
# 但指纹变化会被自动感知。缺这个机制时，合并后其他 worker 仍用旧索引，
# 旧编号不被归一 → 台账总数反弹。
db.add(DeviceAlias(canonical_code=A, alias_code="OTHERPROC-9", source="merge", remark=""))
db.commit()
# 指纹检查有 TTL 节流，测试里显式 refresh模拟「TTL 到期后自动重建」
auto = resolve_device_code(db, "OTHERPROC-9", refresh=True)
check("F3 别的进程写入的别名能被自动感知（跨进程失效）", auto == A, auto)
# 删除别名后也应自动感知（指纹的 max(id) 与行数都会变）
db.query(DeviceAlias).filter(DeviceAlias.alias_code == "OTHERPROC-9").delete()
db.commit()
after_del = resolve_device_code(db, "OTHERPROC-9", refresh=True)
check("F4 别名删除后 refresh 可感知（回落为原值）", after_del == "OTHERPROC-9", after_del)

print("\n=== G. stats / redirect_map ===")
sm = get_normalizer(db).stats()
check("G1 stats 含alias_total", "alias_total" in sm and sm["alias_total"] >= 3, str(sm))
rm = get_normalizer(db).redirect_map([A, B, OLD, "无关码", ""])
check("G2 redirect_map 只含真正重定向项", set(rm.keys()) == {B, OLD}, str(rm))

db.close()

print("\n" + "=" * 58)
print(f"通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  - " + f)
    sys.exit(1)
print("全部通过")