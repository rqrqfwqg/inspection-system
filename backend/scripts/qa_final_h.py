# -*- coding: utf-8 -*-
"""QA final · H：列表接口 before/after 逐字节（索引=no-op vs 真实索引）"""
import json
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_ledger_routes as alr  # noqa: E402

db = Q.get_session()
COMBOS = [dict(), dict(source="ledger_only"), dict(state="with_asset"), dict(q="配电箱"),
          dict(sort="price_tax", order="desc"),
          dict(sort="name", order="asc", page=2, page_size=50),
          dict(area="GTC", state="bim", sort="record_count", order="desc")]


def dump(r):
    return json.dumps(r, ensure_ascii=False, sort_keys=True, default=str)


alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
_orig = alr.build_match_index
alr.build_match_index = lambda d, rws: {"_noop": True}
try:
    before = []
    for c in COMBOS:
        alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
        before.append(dump(alr.list_asset_ledger(db=db, _=None, **c)))
finally:
    alr.build_match_index = _orig
after = []
for c in COMBOS:
    alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
    alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
    after.append(dump(alr.list_asset_ledger(db=db, _=None, **c)))
same = sum(1 for a, b in zip(before, after) if a == b)
print(f"列表接口 before/after：SAME={same}  DIFF={len(COMBOS)-same}  (共 {len(COMBOS)})")
for c, a, b in zip(COMBOS, before, after):
    print(f"  {str(c):<72} {'SAME' if a==b else 'DIFF'}")
# rows 污染检查
import copy
rows0 = Q.fresh_rows_noindex(db)
snap = copy.deepcopy(rows0)
import asset_code_match as acm
acm.build_match_index(db, rows0)
print(f"build_match_index 后 rows==deepcopy(快照): {rows0 == snap}")
