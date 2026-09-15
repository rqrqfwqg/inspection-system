# -*- coding: utf-8 -*-
"""QA 运行包装器：把目标脚本的 stdout/stderr 写入文件（本会话 shell 无法回显 stdout）。

用法：
  python qa_run.py <target_script.py> <out.txt> [args...]
"""
import runpy
import sys


class _T:
    def __init__(self, f):
        self.f = f

    def write(self, s):
        self.f.write(s)
        self.f.flush()

    def flush(self):
        self.f.flush()


def main():
    target = sys.argv[1]
    out = sys.argv[2]
    extra = sys.argv[3:]
    f = open(out, "w", encoding="utf-8")
    sys.stdout = _T(f)
    sys.stderr = _T(f)
    sys.argv = [target] + extra
    try:
        runpy.run_path(target, run_name="__main__")
    except SystemExit:
        pass
    except BaseException:
        import traceback
        traceback.print_exc()
    finally:
        f.flush()
        f.close()


main()
