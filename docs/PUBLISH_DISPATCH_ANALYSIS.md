# Publish 调度接入分析（§39 四件的协作载体）

> **命名说明**：本文说的"调度"指 publish 链里 asset→deployment→provider 的发出流程。
> 与发布门禁 **G2（RC 出包 / workflow_dispatch）** 无关——那一项缺的是认证不是代码，
> 见 `docs/RELEASE_GATE_UPDATER.md:14`。两者刻意不共用名字。
>
> 状态：**分析，未改代码**。等确认后再实现。

## A. dispatch 的数据依赖清单

`PublisherCore::publish_group` 的实际入参（`crates/application/src/lib.rs:89-96`）：

| 参数 | 类型 | 来源 | 是否已具备 |
| --- | --- | --- | --- |
| `strategy` | `StorageGroupStrategy` | `group.strategy` 字符串解析（commands.rs:2622+ / cli.rs:857+） | ✅ |
| `members` | `Vec<PublishMember>` | `group.members` 逐个解析 role + `build_provider` | ✅ |
| `bytes` | `Bytes` | 图片处理产出的变体字节 | ✅ |
| `remote_path` | `String` | 路径模板渲染（含 `{uuid}`） | ✅ |
| `mime_type` | `String` | 变体 MIME | ✅ |

`PublishMember`（:37-43）= `storage_id / storage_name / role / priority / provider`，其中
`provider: Result<Arc<dyn StorageProvider>, String>` —— **构造失败以 Err 携带在成员里**，
`upload_member`(:184 起) 在函数开头把它转成带 error 的 outcome。这点很重要：不需要新的错误通道。

对照 §39 第一件的对象，缺口只有两处：

| PublishPlan 需要 | 现状 | 结论 |
| --- | --- | --- |
| `PlannedUpload.asset_id` | group 分支目前只能取 `source_assets.first()`（我在 publish_plan.rs 里明确标注为占位） | 需由调用方传入真实 variant→asset 映射；单 asset 场景已正确 |
| `ExpectedResult.expected_bytes` | 恒 `None` | 变体的 `size_bytes` 就在调用方手里（cli.rs:602、commands.rs:2425，两处都是
`prepared.body.len() as u64`），可直接填 |

其余（role、priority、remote_path、rollback_policy）**全部现有数据可覆盖**，无需新查询。

## B. 接入点定位

四个 `publish_group` 调用点，两个入口各两处：

| # | 文件:行 | 所在函数 | 能否拿到 journal |
| --- | --- | --- | --- |
| 1 | `commands.rs:2353` | `run_workflow_publish_task(app, state: AppState, …)` :2257 | ✅ `state.journal` |
| 2 | `commands.rs:2649` | `publish_group_bytes(state: &AppState, …)` :2614 | ✅ `state.journal` |
| 3 | `cli.rs:540` | `publish_one(context: &CliContext, …)` :456 | ✅ `context.journal` |
| 4 | `cli.rs:867` | `upload_group(context: &CliContext, …)` :849 | ✅ `context.journal` |

**关键结论：四处都已在持有 state/context，而两边都已有 `journal` 字段 ⇒ 接入不需要改任何函数签名。**
这比我预期的好得多，意味着可以小步接。

`publish_group` 本身是关联函数、无 state 参数（:89），所以调度器不能装在它内部——
接入层必须在调用方。这是正确的分层（application crate 不该知道持久层），不要为了"统一"把
journal 塞进 `PublisherCore`。

### 关于"接入点在 upload 之后还是 verification 之后"

答案是**两侧都要，但记录的东西不同**：

```text
compile(intent) ─────────▶ 计划事件（可选，先不做）
      │
   [upload 前]  ── append UploadAttemptCompleted/Failed 的"开始"侧 ← 现在没有 started 事件类型
      │
   upload_member() → PublishOutcome{error, public_url}
      │
   [后端内 verification] GitHub/Gitee SHA 回读、OpenDAL stat
      │                  ↑ 结果目前只决定返回 Ok/Err，没落到 Deployment 层
   [upload 后]  ── append DeploymentStatusChanged（已接，见 record_publish_events）
      │
   select_public_url(outcomes) → 对外链接
```

第二件留下的 `VerificationEvidence` 与第三件的 journal 现在**还没连起来**：verification
发生在后端内部，其结论没有传到调用方（`UploadResult` 里没有验证字段）。这是本分析发现的
最大缺口，见 D 节。

## C. "能发"的验收标准（可测谓词）

分三级，每级都能写成断言或测试：

**L1 请求发出**（最弱）
- 谓词：`publish_group` 返回的 outcomes 数量 == members 数量。
- 现状：已由 `PrimaryWithBackups` 三 lane 测试覆盖一部分，但**没有跨策略的统一计数断言**。

**L2 收到成功响应**
- 谓词：`outcome.error.is_none() && outcome.public_url.is_some()`。
- 现状：就是今天 `status = Online` 的判据 —— **仍然只是"SDK 调用没报错"**。

**L3 远端已被证明**（真正的"能发"）
- 谓词：存在一条 `VerificationRecorded` 事件，其 `method ∈ {sha_readback, stat_bytes}` 且
  `passed = true`，且 `expected == observed`。
- 现状：**无法达成** —— 后端做了验证但不上报结论（见 D）。

建议实现顺序按 L3 倒推：先补 `UploadResult` 的验证结论字段，再让调度层写
`UploadAttemptCompleted` + `VerificationRecorded`，最后才谈 L1/L2 的额外断言。
否则会出现"事件很多但没有一条能证明内容真的在云上"的假繁荣。

**可立即写的两条判别式**（不需要新能力）：
1. 每个 publish 出口都必须产生 attempt 级事件：摘掉任一处 → 门禁红。
2. `MirrorAll` 下某个成员失败时，其余成员的 outcome 必须仍在列表里（不被短路）。

## D. 与 EventJournal / Reconciliation 的协作方式

### 现在能直接接的

```text
调用方（4 处）
  ├─ compile intent → plan        （决定要打哪些 key）
  ├─ publish_group(plan 派生的 members)
  ├─ journal.append(UploadAttemptCompleted | Failed)   ← 每个成员一条
  └─ journal.append(DeploymentStatusChanged)           ← 已接
```

`PlanStep.rollback_points` 正好替代现在**两份重复实现**的回滚逻辑：
`commands.rs:2564` 与 `cli.rs:47` 各有一份 `rollback_successful_uploads`，
都是"从 outcomes 现场反推该删什么"。计划里有显式 rollback_points 后，
这份推导可以收敛成一处，并顺带解决两版文案已经不一致的问题
（desktop 版中文提示、cli 版英文提示，同一条件不同措辞）。

### 接不了的（必须先补一层）

**VerificationEvidence ↔ journal 之间断链。** 三个后端的真验证（GitHub/Gitee SHA 回读、
OpenDAL `stat` 字节数）结果止步于"要不要返回 Err"，`UploadResult` 不携带验证结论。
所以调度层即使想写 `VerificationRecorded` 事件，也无数据来源 —— 只能瞎写，那正是刚从
`verified_at` 身上拆掉的错误。

修法（下一步的实现范围，不在本分析里做）：给 `UploadResult` 加一个
`verification: Option<VerificationOutcome>`，三个后端各自填自己真实做过的那种，
没做的填 `None`（对应 `VerificationMethod::None`，语义已在第二件定义好）。
这是**跨 crate 的接口变更**（storage-core + 三个后端 + application + 两个入口），
比前面几步都大，需要你单独放行。

### 与 Reconciliation 的关系

对账扫描（已完成的手动命令）读的是 **DB 信念 vs 远端现实**；publish 调度写的是
**每次发出的事实**。两者通过 journal 相连：reconciler 发现 `MissingRemote` 时，
可以回查该 deployment 的历史事件，判断"从未上传成功过"和"曾经在线后来消失"——
这两种情况的正确处置完全不同，而现在无法区分。这是接入调度器之后 reconciliation
才真正有价值的地方，也是我建议先做 publish 而不是先做定时器的另一个理由。

## E. 建议的实现切分（等你确认后再动手）

| 笔 | 内容 | 规模 | 风险 |
| --- | --- | --- | --- |
| 1 | 4 个调用点写 `UploadAttemptCompleted/Failed` 事件 | 小 | 低（纯追加） |
| 2 | `UploadResult` 带验证结论 + 写 `VerificationRecorded` | 中，跨 5 crate | 中（接口变更） |
| 3 | 用 `PublishPlan` 替换两处 `rollback_successful_uploads` | 中 | **高**（改回滚行为，需 G3 类验证） |
| 4 | 定时器化 sweep | 小 | 中（无人值守） |

第 3 项会改变"部分失败时删什么"的行为，属不可逆动作路径，我建议在 G3 真机验证之后再动。
