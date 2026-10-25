# WORKLOG

## 2026-10-25 — 协作规则集中与过期记录清理

**事实**：用户要求把 `.ai/` 中的详细规则整理到根目录 `AGENTS.md`，并直接删除过期内容。本轮从 `5a88d8579fb24a86e49a885d15feece40b3ef018` 开始，核对远端 main 为 `5c79c42a04bfde72020329679bbb5dd4f961dbbd`，工作区在修改前干净。

**判断**：长期规则应在一个入口维护；旧发布阶段、固定分支关系、工具链判断和候选版本不应继续充当现行指令。已删除过期状态、待办、决定和交接内容，保留检查脚本需要的文件入口；此前记录可通过 Git 历史追溯。

**动作**：AGENTS.md 集中规定 main-only、授权、证据、验证、凭据、发布、记录和交付要求；工具链改为按当前环境探测。产品源码、依赖、迁移、版本和工作流均不变；本轮不推送、不发布。生成快照和相关文档契约检查结果以本轮实际命令输出为准。

**验证**：`python scripts/validate.py`、`python scripts/check_user_flow.py`（639/0）、`python scripts/check_docs_site.py`（16 项）和 `git diff --check` 均通过；`python scripts/project_state.py --write` 成功生成本轮 main 来源快照，`--verify` 返回 problems=0，但远端 tag 对照因不可达而 SKIP，不能视为远端 tag 已复核。本轮仅改文档与生成快照，未运行产品构建、Rust 编译/测试、真实云端或安装器检查；本地提交未推送时无该提交的远端 CI。
