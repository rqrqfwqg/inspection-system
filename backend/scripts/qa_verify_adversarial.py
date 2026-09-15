# -*- coding: utf-8 -*-
"""QA 独立验证 · item 2 负向 / 对抗测试（自构造，不抄作者）"""
import os
import sys
import time

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

print("=" * 70)
print("item 2 · 负向 / 对抗测试")
print("=" * 70)

CASES = [
    ("空串", ""),
    ("纯空白", "   \t  "),
    ("None", None),
    ("纯CRLF", "\r\n"),
    ("CRLF夹码", "G-1D9\r\nAPt"),
    ("超长10001", "A" * 10001),
    ("超长10001-数字", "9" * 10001),
    ("全角Ｇ－１Ｄ９ＡＰｔ", "Ｇ－１Ｄ９ＡＰｔ"),
    ("全角ＧＥ２ＦＫＴＪＦ１０１", "ＧＥ２ＦＫＴＪＦ１０１"),
    ("全角数字GE1FPDF208", "ＧＥ１ＦＰＤＦ２０８"),
    ("半全角混合GE２F-KTJF-101", "GE２F-KTJF-101"),
    ("中文", "配电箱"),
    ("中文+码", "配电箱G-1D9APt"),
    ("井号", "#"),
    ("井号夹码", "GE#2F#KTJF#101"),
    ("左括号", "("),
    ("右括号", ")"),
    ("百分号", "%"),
    ("下划线", "_"),
    ("单引号", "'"),
    ("双引号", '"'),
    ("反斜杠", "\\"),
    ("反斜杠+码", "GE\\2F-KTJF-101"),
    ("极短J", "J"),
    ("极短1", "1"),
    ("极短JJ", "JJ"),
    (">40连续码", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJ"),
    ("带连字符", "GE-2F-KTJF-101"),
    ("无连字符", "GE2FKTJF101"),
    ("带空格", "ge 2f ktjf 101"),
    ("带空格+横线混乱", " GE - 2F - KTJF - 101 "),
    ("GE1F-PDF-208", "GE1F-PDF-208"),
    ("GE1FPDF208", "GE1FPDF208"),
    ("基线G-1D9APt", "G-1D9APt"),
    ("下划线码GE_2F_KTJF_101", "GE_2F_KTJF_101"),
    ("点号码GE.2F.KTJF.101", "GE.2F.KTJF.101"),
    ("斜杠码GE/2F/KTJF/101", "GE/2F/KTJF/101"),
    ("SQL注入1", "'; DROP TABLE devices;--"),
    ("SQL注入2", "1 OR 1=1"),
    ("LIKE通配组合%_", "%_%"),
    ("纯数字长", "10430201211100004970"),
    ("唯一序列号", "152100424110742M"),
    ("BIM tag", "10430201211100004970"),
]

for name, q in CASES:
    t0 = time.time()
    try:
        r = acm.resolve_code(idx, q)
        dt = (time.time() - t0) * 1000
        cands = r["candidates"]
        top = cands[0] if cands else {}
        print(f"\n[{name}] q={q!r}")
        print(f"  loose={r['normalized']['loose']!r} kind={r['kind']} exact={r['exact']} "
              f"count={r['count']} shared_count={r.get('shared_count')} "
              f"hint={r.get('hint')}  ({dt:.0f}ms)")
        if top:
            print(f"  top: {top['device_code']!r} {top['match_type']} conf={top['confidence']} "
                  f"field={top['match_field']} mv={top['matched_value']!r}")
        if r["count"] > 1:
            codes = [c["device_code"] for c in cands[:6]]
            print(f"  前6候选: {codes}")
    except Exception as e:
        import traceback
        print(f"\n[{name}] q={q!r} -> EXCEPTION {type(e).__name__}: {e}")
        traceback.print_exc()

# 专项：% / _ 是否被当通配符导致全表命中
print("\n" + "=" * 70)
print("专项：% 与 _ 是否 LIKE 通配（若全表命中则危险）")
print("=" * 70)
for q in ("%", "_", "%%", "__", "%_%"):
    r = acm.resolve_code(idx, q, limit=20)
    print(f"  q={q!r}: kind={r['kind']} count={r['count']}（总行 8977）")

# 专项：超长输入耗时（防 DoS）
print("\n专项：超长输入耗时")
for n in (1000, 10000, 100000):
    q = "A" * n
    t0 = time.time()
    r = acm.resolve_code(idx, q)
    print(f"  len={n}: kind={r['kind']} count={r['count']} 耗时={(time.time()-t0)*1000:.0f}ms")

print("\n[完成 adversarial]")
