# Domain Event Journal 与现有 `app.emit()` 的关系

> §39 第三件。本轮交付：`DomainEvent` 值对象 + `EventType` / `AggregateKind` 枚举 +
> `EventJournal` trait + 内存 mock 实现 + 11 个测试。
> **不接入 publish 路径，不建表** —— SQLite 实现留到第四件与 Reconciliation 一起做。

## 1. 现状：状态变更被"广播"，但没被"记录"

全仓只有四处 `app.emit(...)`（Tauri webview 推送）：

| 事件名 | 位置 | payload | 触发条件 |
| --- | --- | --- | --- |
| `asset://published` | `commands.rs:3337` | name / publicUrl / pluginOutputs | **仅当 public_url 非空**（前面有提前 return） |
| `task://updated` | `commands.rs:3348` | id / status / progress / error | 每次任务状态变化 |
| `integration://shortcut-error` | `integrations.rs:458` | 裸字符串 | 全局快捷键上传失败 |
| `integration://shortcut-uploaded` | `integrations.rs:530` | urls / clipboard | 剪贴板上传成功 |

它们的共同局限：

1. **易失**。窗口关着、前端把事件丢了、进程崩了 ⇒ 历史不存在。
2. **无顺序**。没有 sequence，无法判断"是否漏了一个事件"。
3. **不完整**。最典型的是 `asset://published`：它在 `public_url` 为空时**直接 return**，所以"上传成功但没有可用链接"这种最需要复盘的状态，连广播都没有。
4. **不可回放**。第四件（Reconciliation）要回答"系统怎么走到当前信念的"，靠广播流做不到。

## 2. 分工

```text
                    ┌───────────────┐
   状态变更发生 ───▶ │  EventJournal │  持久、有序、可回放（本轮定义契约）
                    └──────┬────────┘
                           │ append() → 分配 sequence
                    ┌──────▼────────┐
                    │  domain_events│  （第四件建表）
                    └───────────────┘

                    ┌───────────────┐
   UI 需要即时反馈 ─▶ │  app.emit()   │  易失推送，本轮保留不动
                    └───────────────┘
```

两者不是替代关系而是不同职责：**journal 是事实记录，emit 是通知**。本轮刻意不让 emit 从 journal 派生——那会把"改事件语义"和"改前端契约"两件事耦合进一次改动。派生留给后续：届时 `emit_asset_published` 变成 `journal.append(...)` 的订阅者，而它现有的"public_url 为空就跳过"规则应下沉为**只影响是否通知 UI，不影响是否记录事实**（修复上面第 3 点）。

## 3. 类型对照

| EventType | 对应现有的 | 说明 |
| --- | --- | --- |
| `AssetPublished` | `asset://published` | 语义扩展：即使没有可用 URL 也要记录事实 |
| `TaskStatusChanged` | `task://updated` | 持久化 counterpart |
| `UploadAttemptCompleted` / `UploadAttemptFailed` | 无（第二件的 `DeploymentAttempt.outcome` 只在内存/未来表里） | journal 让"这次尝试结束了"成为一个可回放事件 |
| `VerificationRecorded` | 无（第二件的 `VerificationEvidence`） | 含"没验"这一合法情形 |
| `DeploymentStatusChanged` | DB 列更新，无任何通知 | 补上缺失的记录面 |
| `StorageConfigured` | 存储 CRUD | — |
| `CredentialRotated` | 凭证轮换 | **payload 绝不携带密钥本身**，沿用 Gitee 脱敏那条纪律 |

命名用过去式，与 webhook 插件既有 hooks（`after_upload` / `on_publish_failure`）的约定一致。

## 4. 顺序模型：为什么 sequence 是 per-aggregate 而非全局

`sequence` 由 journal 在 `append` 时分配，**trait 明确要求拒绝携带非零 sequence 的事件**：调用方自选位置是制造空洞最省事的方式，而检测空洞正是这套东西存在的理由。

一个聚合内的单调递增意味着：某个聚合出现空洞就是它自己丢了事件，不会被别的聚合的繁忙流量掩盖。测试
`per_aggregate_sequences_do_not_mask_each_other` 锁的就是这条性质（繁忙聚合连发 4 条后安静聚合的第 1 条仍是全局第 5 位，两者各自 `find_gaps == None`）。

`find_gaps` 做成自由函数而非塞进 trait，是为了让内存实现与将来的 SQL 实现对同一问题给出同一个答案。

## 5. trait 的最小面

必需方法有四个：`append` / `events_for` / `events_since` / `current_sequence`。
`replay(from, to)` 提供**默认实现**（由 `events_since` 派生），这样实现方不可能在原始方法正确、而 replay 单独写错的情况下通过测试。将来若 SQL 能用索引做得比扫描好，再 override。

## 6. 本轮未做（第四件必须一并处理）

1. **无 SQLite 实现、无 migration**。按你的指示，建表与 down 脚本策略一起在第四件解决——避免在"13 up / 0 down"的缺口上再单独开一刀。
2. **未接入任何写路径**：`publish_group`、任务状态机、存储 CRUD 都还不产生事件。
3. **`aggregate_kind` 尚未参与唯一性约束**：真正建表时需要 `(aggregate_kind, aggregate_id, sequence)` 唯一索引，否则两张表的 UUID 撞号会让两个聚合的事件混进同一条序列。这一点已在类型里预留，但只有 schema 能强制。
4. **payload schema 未定型**：每种 `EventType` 的 payload 目前是自由 `Value`；接入执行时应各配一个结构体并加断言，否则 journal 会退化成什么都往里塞的日志表。
