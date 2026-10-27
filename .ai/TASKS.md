# TASKS

## 代码结构统一

- 第一批已实施：异步桌面订阅生命周期、云端浏览共享计算、开发入口和离线测试入口。具体工作区验证见 `WORKLOG.md`。
- 第二批待实施：按领域拆分前端 IPC 与页面，保留已有命令、参数、查询和业务行为。
- 第三批待实施：在验证条件具备时收敛 Rust 服务和仓储职责，保持安全边界、接口和数据兼容。

范围和方案见 `docs/superpowers/specs/2026-10-26-structure-unification-design.md`；首批计划见 `docs/superpowers/plans/2026-10-26-structure-unification-batch1.md`。未执行的真实 Tauri、云端与发布验收不能由本地模拟检查替代。

任务登记、状态和收尾规则统一见根目录 `AGENTS.md`。
