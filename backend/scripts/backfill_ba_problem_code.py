"""回填 ba_problems.ba_system_code（修复 BA 问题清单未挂子系统编码的缺陷）。

缺陷背景：import_ba.py 首次导入「问题清单」时 ba_system_map 尚未播种，
导致 ba_problems.ba_system_code 全为 NULL，/ba/overview 的 problem_rate 恒为 0。

本脚本：以 ba_problems.ba_system（中文系统名）→ ba_system_map.ba_system 反查 code 并写回。
幂等：仅对 ba_system_code 为空者回填；已正确者不动。

用法：
  venv/Scripts/python.exe scripts/backfill_ba_problem_code.py
"""
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from database import engine, BaProblem, BaSystemMap
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=engine)


def main():
    db = Session()
    try:
        # 预载 中文系统名 -> code 映射
        mapping = {m.ba_system: m.code for m in db.query(BaSystemMap).all()}
        print(f"[回填] ba_system_map 映射 {len(mapping)} 条：{mapping}")

        problems = db.query(BaProblem).all()
        fixed = 0
        unmatched = 0
        for p in problems:
            if p.ba_system_code:
                continue
            code = mapping.get(p.ba_system)
            if code:
                p.ba_system_code = code
                fixed += 1
            else:
                unmatched += 1
                print(f"  ! 未匹配 ba_system={p.ba_system!r}（问题 id={p.id}）")
        db.commit()
        print(f"[回填] 已修复 ba_system_code：{fixed} 条；未匹配（保留 NULL）：{unmatched} 条")
    finally:
        db.close()


if __name__ == "__main__":
    main()
