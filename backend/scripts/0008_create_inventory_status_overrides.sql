-- 设备台账 redesign · 管理员逃生舱覆盖表
-- 依据：设备台账redesign-SPEC §4 / 架构 §11.2
--
-- 部署方式（任选其一，均不触碰既有表、零迁库、零 DML）：
--   1) 应用启动时 init_db()（Base.metadata.create_all）会自动建表（ORM 模型已加）；或
--   2) 手动在线上库执行本 SQL（推荐走 online_db.py 只读通道复核后执行）。
--
-- 约束要点：
--   - device_code 引用台账（与 _load_all 行键同源），**不建 devices 外键**（一期 C1）；
--     不在 ledger 中的 code 由 API 层拒绝写入（404）。
--   - status 仅两值，CHECK 约束兜底。
--   - 量极小（仅被人工例外的设备），无需额外索引；不进 _ALL_SQL、不污染 total（8455）。

CREATE TABLE IF NOT EXISTS inventory_status_overrides (
    device_code    TEXT PRIMARY KEY,                       -- 台账 device_code
    status         TEXT NOT NULL
                     CHECK (status IN ('confirmed','unconfirmed')),
    overridden_by  TEXT NOT NULL,                          -- 管理员标识（user.email / name）
    overridden_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason         TEXT                                     -- 人工覆盖原因（API 层强制必填；列允许 NULL 仅为兼容）
);
