# -*- coding: utf-8 -*-
"""QA 独立验证 · 公共装配

在 fixture 的**副本**上建 sqlalchemy 会话，复现生产装配路径：
  alr._load_all(db) -> rows；acm.build_match_index(db, rows) -> index
绝不触碰原 fixture、绝不写线上库。
"""
import copy
import os
import shutil
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

FIX = os.path.join(_HERE, "_online_fixture.db")
COPY = os.path.join(_HERE, "qa_fixture_copy.db")


def ensure_copy():
    if not os.path.exists(COPY):
        shutil.copy2(FIX, COPY)
    return COPY


def get_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    p = ensure_copy()
    eng = create_engine(f"sqlite:///{p}", connect_args={"check_same_thread": False})
    return sessionmaker(bind=eng)()


def load_rows(db):
    import asset_ledger_routes as alr
    return alr._load_all(db)


def build(pristine_rows, db):
    import asset_code_match as acm
    return acm.build_match_index(db, pristine_rows)


def fresh_rows_noindex(db):
    """用生产装配路径取『未建索引』的干净 rows（临时把 alr.build_match_index 换成 no-op）。"""
    import asset_ledger_routes as alr
    import asset_code_match as acm
    alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
    alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
    orig = alr.build_match_index
    alr.build_match_index = lambda d, rows: {"_noop": True}
    try:
        rows = alr._load_all(db)
    finally:
        alr.build_match_index = orig
    return rows
