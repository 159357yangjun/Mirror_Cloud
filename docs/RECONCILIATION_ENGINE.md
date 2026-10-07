# Reconciliation Engine（§39 第四件）

> 交付：`domain_events` 表 + SQLite journal + 纯函数漂移检测 + down 脚本策略。
> **未接入任何自动执行** —— 引擎只"提出"动作，修复仍由人决定。

## 1. 三块各自的位置

| 块 | 位置 | 性质 |
| --- | --- | --- |
| schema | `migrations/0015_domain_events.sql` + `migrations/down/0015_domain_events.sql` | 持久层 |
| journal | `crates/persistence-sqlite/src/journal.rs` 的 `SqliteEventJournal` | async I/O |
| 判定 | 同文件的 `detect_drift(belief, observations)` | **纯函数，零 I/O** |

判定与 I/O 分离不是风格偏好：它让"网络抖动会不会被误读成文件丢失"这条最重要的性质可以在没有数据库的条件下被测出来（测试 `an_inconclusive_probe_is_never_reported_as_missing`）。

## 2. 为什么没有实现同步 `EventJournal` trait

第三件留的 trait 是 sync，sqlx pool 是 async。在 tokio worker 上 `block_on` 会死锁而不是响亮失败，所以这里暴露**同契约的 async 方法**，sync trait 继续留给内存实现与测试。

trait 与实现的差异记在模块注释里，避免下一个读者以为"忘了 impl"。

## 3. 序号分配的并发边界（如实说明，非已解决）

`append` = `SELECT MAX(sequence)+1` 然后 `INSERT`，两条语句。同一聚合上的两个并发发布者可能都算出 N ⇒ UNIQUE 索引拒掉后者。**结果是可重试的错误，不是静默损坏**；不同聚合的序号本就互相独立。

彻底消除该窗口的写法存在（单条 `INSERT … SELECT COALESCE(MAX(sequence),0)+1 …` 相关子查询），当前不做，因为"两个任务打同一聚合"的执行路径还不存在——journal 尚未接入 publish。接入那轮必须一并改掉，否则会把一次正确性缺陷伪装成偶发错误率。

## 4. 漂移判定的四种结论

| 本地信念 | 远端观测 | 结论 |
| --- | --- | --- |
| online | Present | 无漂移 |
| offline | Absent | 无漂移 |
| online | **Absent** | `MissingRemote` |
| offline | **Present** | `UnrecordedRemote` |
| 任意 | `Unknown` | `ProbeInconclusive` |
| 任意 | **从未探测** | `ProbeInconclusive` |

最后两行是这个引擎存在的理由。`RemoteObservation::Unknown` 与"没探测过"都不许落到 `MissingRemote`——否则一次网络抖动就会被解释成"远端文件全没了"，接着触发批量删除用户内容。**探测不确定 ≠ 缺失**，这条由测试双向锁住（一面给 Unknown、一面给空观测表，两者都必须产 `ProbeInconclusive`）。

引擎只返回 `Vec<Drift>`，不执行修复。现有的人工修复入口 `repair_asset`（按单个 asset、以本地 DB 状态为准）保持不变；把 drift 结果接到它上面属于后续工作，且需要用户显式确认每一条。

## 5. down 脚本策略

见 `docs/MIGRATION_REVERSIBILITY.md`。要点：down 放 `migrations/down/` 子目录而非平铺 `.down.sql`，因为 `validate.py` 用 `glob('*.sql')` 重放校验迁移链，平铺会被吃进 up 序列；每个新 up 同笔配同名 down；不可逆操作在 up 头标 `IRREVERSIBLE`；0001–0014 一律不追溯补 down。

## 6. 本轮未做

1. **journal 未接入写路径**：publish / 任务状态机 / 存储 CRUD 都还不产生事件 ⇒ 表目前是空的。这意味着第 3 节的并发窗口现在无法被真实触发，也意味着 reconciler 还没有历史可读。
2. **无周期调度**：全仓零定时器（inventory 已证）。reconcile 目前只能被显式调用，不会自己跑。
3. **无远端探测实现**：`RemoteObservation` 是输入类型，本文件不产生它。真正去 HEAD/stat 的代码要复用三个后端已有的回读逻辑，那是接入阶段的工作。
4. **`events_after_rowid` 尚无消费者**。
