# DeploymentAttempt 与 VerificationEvidence

> §39 第二件。本轮交付：`verified_at → recorded_at` 改名（含迁移）+ 两个新对象的定义。
> **未接入执行路径**，与第一件同性质：先立结构，再接线。

## 0. 为什么先改名

`deployments.verified_at` 从来没验证过任何东西。三处写入点全部是：

```rust
status: if outcome.error.is_none() { DeploymentStatus::Online } else { Failed },
deployed_at: Some(now),
recorded_at: Some(now),      // ← 原名 verified_at
```

（`commands.rs` / `remote_index.rs` / `cli.rs`，各一处，同一个 `now`。）

也就是说它记的是"这一行被本地写入的时刻"，字段名却声称"远端已被核验"。在只有它一个时间戳时这无害；一旦真的引入 VerificationEvidence，就会出现"假字段和真字段并存、读的人不知道该信谁"。所以先把名字改成诚实的，再往上盖证据层。

**改名不改变任何行为**：该列此前没有任何 SELECT 读取它（全仓仅 INSERT/UPDATE 写入），所以它是只写不读的死列——这也是为什么这次改名风险低于预期。

| 落点 | 数量 | 位置 |
| --- | --- | --- |
| domain 字段 | 1 | `crates/domain/src/lib.rs` |
| SQL 字符串 | 5 | `crates/persistence-sqlite/src/lib.rs`（INSERT 列名 + bind + 3 处 UPDATE） |
| 写入点 | 3 | `commands.rs` / `commands/remote_index.rs` / `cli.rs` |
| 迁移 | 1（新增） | `migrations/0014_rename_verified_to_recorded.sql` |
| 前端 | **0** | 无命中（inventory 阶段我误报过"牵动前端类型"，实际没有） |
| `0001_init.sql` | **刻意不改** | 见下 |

### 为什么 0001 保留旧列名

`scripts/validate.py` 会在内存库上按文件名顺序重放全部迁移并统计表数。全新数据库走的是
`0001(建 verified_at) → … → 0014(RENAME)`，最终列名同样是 `recorded_at`。若改 0001 而不加 0014，
老用户库就永远停在旧列名上——那才是真正的语义分裂。

### 已验证的重放路径（本机 Python sqlite3 3.45.3）

| 场景 | 结果 |
| --- | --- |
| 全新库重放 14 个迁移 | 12 张表；`deployments` 列为 …,`deployed_at`,`recorded_at`,`last_error` |
| 老库（跑到 0013）再应用 0014 | 已有行的值逐字保留（`2026-10-02T03:04:05Z` 前后一致） |
| 索引 | 5 个索引改名前后完全一致 |
| 旧列名 | `SELECT verified_at` → `no such column`（如期失败） |

⚠️ 生产 SQLite 由 sqlx 内置提供，版本可能与本机不同；`ALTER TABLE … RENAME COLUMN` 需 SQLite ≥3.25
（2018）。这一点只能靠 CI 的 `cargo test --workspace --locked` 覆盖，本机无法证明。

## 1. 关系图

```text
                      ┌──────────────┐
                      │  Asset       │
                      │  AssetVariant│
                      └──────┬───────┘
                             │ 1:N
                     ┌───────▼────────┐   recorded_at（本地写入时刻，非验证）
                     │  Deployment    │◄── 现状唯一的时间字段
                     └───────┬────────┘
                             │ 1:N        ← 本轮新增的下两层
              ┌──────────────▼───────────────┐
              │  DeploymentAttempt           │  attempt_index / started_at / completed_at
              │  每一次远端操作一条，追加不覆写 │  outcome / error / bytes_sent
              └──────────────┬───────────────┘
                             │ 1:0..1      ← 一次尝试最多一份证据
              ┌──────────────▼───────────────┐
              │  VerificationEvidence        │  method: sha_readback | stat_bytes | none
              │                              │  passed + observed/expected，可证"没验"
              └──────────────────────────────┘

与既有对象的关系：
  Task.attempt (u32)          —— 保留，task 级总计数；它的问题是重排队时 `error=NULL` 抹掉上次原因
  PublishOutcome              —— 保留，事后结果；将来由 executor 从 plan 生成，并被 attempt 取代其 error 承载
  PublishPlan.PlanStep        —— 它的 expectation 正是 VerificationEvidence 要对照的"期望"
```

**协同设计的落点**：attempt 与 evidence 是一对多里的两半——"这次尝试发生了什么"和"这次尝试被证明了什么"。
分成两张表但用 `attempt_id` 外键连接，避免把方法/结论混进尝试记录本身（一次尝试可能因后端不支持回读而
`method = none`，那是证据缺失，不是尝试失败）。

## 2. 为什么不复用现有后端验证

三个后端**已经有真验证**，这是本轮盘点最有价值的发现：

| 后端 | 验证方式 | 位置 |
| --- | --- | --- |
| GitHub | 上传后回读 blob SHA，不符则重试到上限 | `storage-github/src/lib.rs`（`verified_sha` 比对） |
| Gitee | 同上 | `storage-gitee/src/lib.rs` |
| OpenDAL(S3/OSS/COS/WebDAV) | `stat()` 比 `content_length` 与期望字节数 | `storage-opendal/src/lib.rs` |

但它们的结果止步于"决定要不要返回 Err"，**没有落到 Deployment 层**。所以 `VerificationEvidence` 的价值
不在发明验证，而在把已有的验证结论持久化成可追溯记录。第四种可能 `none` 必须显式存在：某些后端不提供
回读，"没验"要能被记下来，而不是被省略成一个看起来像验过的时间戳——那正是我们刚从 `verified_at`
身上拆掉的错误。

## 3. 新增对象（`crates/domain/src/attempt_and_evidence.rs`）

### `DeploymentAttempt`

| 字段 | 语义 |
| --- | --- |
| `id` | 每次尝试独立 |
| `deployment_id` / `variant_id` / `storage_id` | 定位到"哪个变体在哪个目标上" |
| `attempt_index` | 1-based，**由 `begin(prior_attempts)` 推导而非由调用方 supplied** ⇒ 调用方无法复用旧 index 覆盖历史 |
| `started_at` / `completed_at` | 未完成时后者为 `None` |
| `outcome` | `Succeeded` / `Failed` / `Abandoned`（用户取消或被取代，请求未发出） |
| `error` | 该次尝试自己的失败原因，**永不被他方清空** |
| `bytes_sent` | 传输量观测值 |

`finish()` 取 `self`（而非 `&mut self`），所以一条记录不能被关闭两次。

关键回归点由测试 `finishing_keeps_the_previous_attempt_error_untouched` 锁住：旧行为是
requeue 时 `error=NULL`，两次重试后没人记得第一次为什么失败；两条独立行让这件事不可能发生。

### `VerificationEvidence`

| 字段 | 语义 |
| --- | --- |
| `attempt_id` | 外键指向唯一一次尝试（1:0..1） |
| `verified_at` | 真正执行核验的时刻 |
| `method` | `ShaReadback` / `StatBytes` / `UrlReachability`(预留) / **`None`** |
| `passed` | 仅当 method 确实观测了远端**且**匹配才为真 |
| `expected` / `observed` | 对照双方，供事后审计 |

两个构造器分工明确：
- `compared(...)` —— `passed` **在函数内计算**（`expected == observed`），不由调用方传入 ⇒
  不匹配的配对无法被记成成功。
- `unverified(attempt_id, at, detail)` —— 后端不提供回读时使用，`method = None` 且
  `passed = false`。**"没验"必须是一条可记录的行，而不是一个暗示已验的时间戳**——这正是刚从
  `verified_at` 身上拆掉的错误。

`observes_remote_state()` 把"这个 method 到底看没看到远端"变成可查询的谓词，避免将来接入
URL 探测时出现"声称验证却没观测任何东西"的行。

### 测试（8 个）

index 由前值推导且 append 产生新 id / 完成一次不影响上一次的 error / 未结束无 completed_at /
SHA 匹配才 passed 且不匹配必 false / StatBytes 走同一规则 / 无回读显式记 `None`+`false` /
UrlReachability 归类为"有观测" / evidence 通过 attempt_id 精确挂到一次尝试。

## 4. 本轮未做（下一轮接执行时必须一并处理）

1. **两张表尚未建立**：`DeploymentAttempt` / `VerificationEvidence` 目前只是 Rust 侧的值对象，
   没有对应 migration、仓储与调用方。
2. **未接入 publish 路径**：`publish_group` 仍不产生 attempt 记录。
3. **`ExpectedResult.expected_bytes` 恒为 None**：需要 executor 从 variant 带上真实字节数。
4. **public_url 可达性仍未验证**：全仓无一处 HTTP HEAD/GET。这是有意的范围切分——先把"已有后端验证
   提到 Deployment 层"做完，URL 探测作为后续增强，否则会把两件不同的事混在一次改动里。
5. **回滚策略**：仓内 13 up / 0 down 的结构性缺口不因本轮改变；0014 同样只有 up。Rename 是唯一
   不可回退的动作，因此它被单独切成一笔最小改动，不与建表混在一起。
