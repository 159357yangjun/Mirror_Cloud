# 迁移可逆性策略（down scripts）

> 本仓此前是 **13 up / 0 down**。§39 第四件要求建表，第一次需要"能退回去"。
> 这份文档定规矩，之后每个新迁移都按它走。

## 目录布局

```text
crates/persistence-sqlite/migrations/
├── 0001_init.sql … NNNN_*.sql        # up：sqlx 与 validate.py 扫描的层
└── down/
    └── NNNN_*.sql                    # down：同名一一对应
```

**为什么 down 放子目录而不是 `NNNN_x.down.sql` 平铺**：`scripts/validate.py` 用
`glob('migrations/*.sql')` 按序重放全部文件来校验迁移链。平铺的 `.down.sql` 会被这个 glob
吃到（它是单层通配、不递归，但 `.down.sql` 仍在同一层），于是"建表 → 删表 → 再建表"混进
up 序列，重放校验直接失真。子目录方案已实测：`*.sql` 看到 14 个、`**/*.sql` 看到 15 个，
探测文件不被 up 重放捕获。

这不是"sqlx 不支持 reversible migration"——它支持（`Migrator::undo`、
`MigrationType::ReversibleUp/Down`）。但 sqlx 靠文件名后缀推断类型，而本仓的 up 侧已经是
`NNNN_name.sql` 的 simple 命名；改成 `.up.sql/.down.sql` 要重命名全部历史文件，代价远大于收益。
因此 down 由本项目的回滚工具显式加载，不进 sqlx 的解析路径。

## 规矩

1. **每个新增 up 必须同笔配一个同名 down。** 二者一起提交，缺任一侧门禁红
   （`check_user_flow.py` 断言）。
2. **down 必须是真可逆操作**，即执行后数据库状态与 up 之前等价。允许的可逆形态：
   - `CREATE TABLE` ↔ `DROP TABLE`
   - `CREATE INDEX` ↔ `DROP INDEX`
   - `ADD COLUMN` ↔ `DROP COLUMN`
   - `RENAME`（列/表）↔ 反向 `RENAME`
3. **不可逆操作必须在 up 文件头显式标注**，格式：

   ```sql
   -- IRREVERSIBLE: <为什么无法回退>
   -- DOWN: <对应 down 文件实际做什么（通常是 no-op 或仅删结构、数据不回）>
   ```

   典型不可逆：`INSERT`/`UPDATE` 携带数据迁移语义、`DROP COLUMN`（旧版本读不到被删列的数据）、
   任何写入用户生成内容的语句。
4. **老迁移不追溯补 down**。0001–0014 保持现状（见下节）。理由：给已经发布过的迁移补一个从未
   被执行验证过的 down 文件，比没有 down 更危险——它会给人一种"可以安全回退到任意版本"的错觉。
5. **回退前先备份**：`%APPDATA%\dev.multicloud.publisher\publisher.sqlite3`。这条在
   `docs/HANDOFF_TEST_SUBMISSION.md` §7 与 `.ai/STATE.md` 里都有，不因有了 down 就作废——
   down 只保证 schema 形状可逆，不保证业务数据可逆。

## 0001–0014 的现状判定

| 编号 | 内容 | 若需回退 |
| --- | --- | --- |
| 0001–0008, 0011, 0013 | 建表 / 建索引 | 结构上可逆（DROP） |
| 0009, 0010, 0012 | `UPDATE plugins SET …` 改写官方插件 manifest、禁用敏感插件 | **不可逆**：原值未被保留，无法从当前状态推出改前的值 |
| 0014 | 列改名 | 可逆（反向 RENAME），且值不动 |

按规矩 4，这些都不补写。只有 **0015 起**适用本策略。
