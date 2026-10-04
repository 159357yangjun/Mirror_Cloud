# PublishPlan 与现有发布路径的关系

> 状态：**共存，未接入**。本文说明 `crates/domain/src/publish_plan.rs` 为什么存在、它与
> `PublishOutcome` / `publish_group` / `rollback_successful_uploads` 的边界在哪、以及未来替换的顺序。
> 本轮不改变任何现有 publish 行为。

## 1. 现状：只有"事后"，没有"事前"

```text
今天（已运行）
  commands.rs / cli.rs
      └─ PublisherCore::publish_group(strategy, ...)        ← 边执行边决定
             ├─ join3(primary, mirrors, backup)             ← 三条并发 lane
             └─ Vec<PublishOutcome>                          ← 结果，含 error 字段
      └─ select_public_url(&outcomes)                        ← 从结果里挑对外链接
      └─ rollback_successful_uploads(&outcomes)              ← 失败时从结果反推该删什么

新增（本轮，未接线）
  PublishIntent ──compile()──▶ PublishPlan ──(将来 execute)──▶ Vec<PublishOutcome>
   冻结决策                      有序步骤+前置+回滚点            仍是既有结果类型
```

关键区别：`PublishOutcome` 回答"发生了什么"；`PublishPlan` 回答"**本来打算发生什么**"。
后者才是可审计对象——partial failure 发生时，计划本身是证据，不必靠日志散文重建。

## 2. 对象映射

| 新对象 | 对应现有的 | 差异 |
| --- | --- | --- |
| `PublishIntent` | 散在调用参数里（strategy + storage ids + variant + path template） | 收拢成一个带 id/时间戳的不可变值；path template 被冻结，防模板日后变更追溯性地改变这次意图的含义 |
| `TargetSelection::Group` | `StorageGroupStrategy`（仅 `MirrorAll`/`PrimaryWithBackups` 两值） | 保留 group 引用，具体 storages 由 compile 注入 ⇒ 组的后续编辑不影响已编译计划 |
| `PlannedUpload` | `PublishOutcome` 的输入侧 | remote_path 在 compile 期就定稿（用 `{uuid}`→variant.simple()），retry 打同一个 key，不再每次重新推导 |
| `PlanStep.rollback_points` | `rollback_successful_uploads` 从 outcomes 现场反推 | 每步显式携带"此刻已完成哪些"⇒ 回滚目标变成数据而非算法 |
| `ExpectedResult` | **无对应**（今天是 `error.is_none()` 即算成功） | 为 §39 第二件 VerificationEvidence 预留槽位：期望先于事实存在，才谈得上"对账" |
| `RollbackPolicy` | 硬编码 RollbackSuccessful | 加 `KeepPartial`，把"宁可留重复也不要缺链接"变成可选策略 |

## 3. 排序规则及其理由

`compile()` 强制 Primary → Mirror → Backup，**不信任输入顺序**（测试 `compile_orders_primary_before_mirror_and_backup` 故意乱序喂进去验证）。

理由与 A 项修复同源：用户最终引用的是 primary URL。既然要失败，就应该失败在一个副本上，而不是在所有副本都做完之后才发现主目标没成。这与 `select_public_url` 的"primary 优先、backup 兜底"是同一条不变量的两面。

## 4. 不可变性怎么保证的（不是嘴上说说）

- 所有字段私有，无 setter；唯一入口是 `new` / `compile`，二者都消费输入。
- getter 返回 `&[T]` / `&str`，不给所有权 ⇒ 调用方拿不到可改的句柄。
- 改主意的唯一方式是造新对象：测试 `two_compiles_of_one_intent_are_distinct_plans_linked_to_the_same_intent` 断言两次 compile 得到不同 plan.id 但相同 intent_id。
- 判别式说明：Rust 层面"没有 pub 字段和 setter"是可静态检查的事实；测试额外证明 serde round-trip 保持 identity，因为序列化是当前 API 下最接近"试图篡改"的可构造操作。**它不声称能捕获未来新增的 setter** —— 那需要新的门禁断言（见 §6）。

## 5. 尚未做的（下一件之前不要误以为已存在）

1. **未接入执行**。`publish_group` 仍走原路，`PublishPlan` 目前没有任何生产调用者。
2. **asset_id 占位**。group 分支里 `PlannedUpload.asset_id` 暂取 `source_assets.first()`；真实的多 asset × 多 variant 展开需要 executor 按 variant→asset 反查，属于接入那一轮的工作，不在本轮范围。
3. **无持久化**。intent/plan 还没进 SQLite，因此谈不上"重启后还能看到当时的计划"。
4. **expected_bytes 恒为 None**。字节数期望要等 §39 第二件把 OpenDAL `stat()` 那类真校验提到 Deployment 层才有数据来源。

## 6. 与门禁的接口（接入那轮必须一并做）

按本项目"新门与违规同笔"的纪律，接入执行时至少要加：
- 一条禁止 `PublishIntent`/`PublishPlan` 出现 `pub fn set_` 或 `pub mut` 访问器的源码断言；
- 一条断言 `publish_group` 的调用方确实经过 `PublishPlan::compile`（否则本轮建的对象会沦为死代码而无人发现）；
- 若引入持久化，则其迁移需同时提供 down 脚本（仓内现状是 13 up / 0 down，属已知结构性风险）。
