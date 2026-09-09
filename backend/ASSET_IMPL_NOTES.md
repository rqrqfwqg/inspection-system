# 资产模块后端 P0 实现说明（ASSET_IMPL_NOTES）

> 作者：寇豆码（工程师）实现骨架；齐活林（主理人）复核+修复 BA 关联缺陷
> 状态：P0 后端完成，已通过主理人复核，待 QA（严过关）独立验证后启动前端 P0

## 交付内容

### 1. 库表（database.py）
- 新增 8 张模型：`ba_system_map` / `equipment_categories` / `device_aliases` /
  `import_batches` / `fixed_assets` / `device_archives` / `device_accessories` /
  `ba_problems`。
- `Device` 扩展 8 列：`transfer_no` / `asset_code` / `category_id` / `bim_tag` /
  `source_batch_id` / `old_code` / `old_name` / `system_text`（均为可空，不破坏旧数据）。
- `fixed_assets` / `device_archives` 各加 `room_id` / `room_code` / `room_match_method`
  （fk_exact / fuzzy / none），对应「可视化与关联设计.md」B.3。

### 2. 迁移（migrate_asset_schema.py，一次性幂等）
- 迁移前自动备份 `app.db` → `app.db.bak.<时间戳>`。
- 对 `devices` 做 ALTER 补齐扩展列（SQLite 仅支持加可空列，已满足）。
- `Base.metadata.create_all` 建新增表（已存在则跳过）。

### 3. 接口（asset_routes.py，均挂在 /ops/api/assets）
- 既有 CRUD 复用并扩展：`subsystems` / `tables` / `fields` / `records` / `devices` /
  `relations` / `search`（search 扩展返回 fixed_asset / archive / accessories / problems / aliases）。
- P0 新增 8 个：`GET /trees/area`、`GET /trees/subsystem`、`GET /ba/problems`、
  `GET /ba/overview`、`GET /stats/by-subsystem-area`，并复用 relations 建 4 类边。

### 4. 导入脚本（scripts/）
- `import_fixed_assets.py`：46 个固定资产 xlsx（表头第4行/23列）→ fixed_assets+devices+aliases，按移交编号幂等 upsert。
- `import_ba.py`：BA 清单 7 类明细→Device+DeviceArchive+Alias；问题清单→BaProblem。
- `import_rooms.py`：机房信息汇总 → rooms（516 间）。
- `normalize_location_room.py`：location 自由文本→room_code 归一化（fk_exact 优先，fuzzy 兜底）。
- `backfill_ba_problem_code.py`：**主理人新增**，回填 ba_problems.ba_system_code。
- `smoke_test_p0.py`：P0 接口冒烟。

## 主理人复核发现与修复

### 缺陷 A（已修复）：ba_problems.ba_system_code 全为空 → /ba/overview problem_rate 恒为 0
- 根因：`import_ba.py` 导入问题清单时按 `ba_system`（中文名）查 `ba_system_map` 取 code，
  但首次导入时 ba_system_map 尚未播种，故 88 行（去重后 86）code 全 NULL。
- 修复：新增 `backfill_ba_problem_code.py` 回填（ba_system→ba_system_map.code）；
  并将 `import_problems` 改为**幂等 upsert**（按 设备编号+所属系统 去重，避免重跑重复落库）。
- 验证：`ba/overview` 现已返回真实 problem_rate（如 管廊气体监测=1.0、排风机≈0.2426）。

### 数据完整性核对（已确认无丢失）
- 源文件 44 个，有效数据行 **8337**；导入后 fixed_assets = **7237**。
  差值 1100 行 = 599 个「移交编号」在 `(未修改)…` 副本文件与正式文件间**完全重复**
  （同编号+同资产名，如 105000624583 配电箱）。按移交编号唯一约束折叠为 7237 是**正确**的去重，
  非数据丢失（保留两份会重复计数）。
- 7 子系统齐全（power/fire/weak/lighting/water/hvac/other，旧 refriger 已合并 hvac）；
  ba_system_map 7 行，其中 ba_co_detect / ba_tunnel_gas 归 **weak**（符合拍板决策）。

## 待 QA 验证项
见任务 #7：6 接口冒烟 + 关键计数抽样 + 幂等性（重跑导入不重复）+ 迁移备份存在性。
