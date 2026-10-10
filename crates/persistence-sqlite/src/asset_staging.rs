//! Durable quarantine for migrated asset metadata. Never expose these rows as active assets.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct StagedAssetInput {
    pub source_asset_id: String,
    pub source_variant_id: String,
    pub name: String,
    pub review_status: String,
    /// Strictly allowlisted portable entry JSON; never an active Deployment record.
    pub entry_json: String,
    pub resolved_copies: i64,
    pub missing_copies: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAssetBatch {
    pub id: String,
    pub source_exported_at: String,
    pub created_at: String,
    pub item_count: i64,
    pub awaiting_verification: i64,
    pub blocked_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAssetRow {
    pub id: String,
    pub batch_id: String,
    pub source_asset_id: String,
    pub source_variant_id: String,
    pub name: String,
    pub review_status: String,
    pub resolved_copies: i64,
    pub missing_copies: i64,
    pub operator_decision: String,
    pub revision: i64,
    #[serde(skip_serializing)]
    pub entry_json: String,
    #[serde(skip_serializing)]
    pub binding_overrides_json: String,
}

#[derive(Debug, Clone)]
pub struct StagedAssetReviewContext {
    pub entry_json: String,
    pub storage_mappings_json: String,
    pub binding_overrides_json: String,
    pub operator_decision: String,
    pub revision: i64,
}

#[derive(Clone)]
pub struct AssetStagingRepository {
    pool: SqlitePool,
}

impl AssetStagingRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// All-or-nothing, never replaces an earlier import from the same source snapshot.
    pub async fn stage(
        &self,
        id: Uuid,
        exported_at: &str,
        mappings_json: &str,
        items: &[StagedAssetInput],
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let now = Utc::now().to_rfc3339();
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO portable_asset_batches (id,source_exported_at,created_at,storage_mappings_json,state) VALUES (?,?,?,?,'pending')",
        )
        .bind(id.to_string())
        .bind(exported_at)
        .bind(&now)
        .bind(mappings_json)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() != 1 {
            return Ok(false);
        }
        for item in items {
            sqlx::query(
                "INSERT INTO portable_asset_staged_items (id,batch_id,source_asset_id,source_variant_id,name,review_status,entry_json,resolved_copies,missing_copies) VALUES (?,?,?,?,?,?,?,?,?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(id.to_string())
            .bind(&item.source_asset_id)
            .bind(&item.source_variant_id)
            .bind(&item.name)
            .bind(&item.review_status)
            .bind(&item.entry_json)
            .bind(item.resolved_copies)
            .bind(item.missing_copies)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(true)
    }

    pub async fn list_batches(&self) -> Result<Vec<StagedAssetBatch>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT b.id,b.source_exported_at,b.created_at,COUNT(i.id) AS item_count, \
             COALESCE(SUM(CASE WHEN i.review_status='awaiting_verification' AND i.operator_decision='review' THEN 1 ELSE 0 END),0) AS awaiting_verification, \
             COALESCE(SUM(CASE WHEN i.id IS NOT NULL AND (i.review_status<>'awaiting_verification' OR i.operator_decision<>'review') THEN 1 ELSE 0 END),0) AS blocked_count \
             FROM portable_asset_batches b LEFT JOIN portable_asset_staged_items i ON i.batch_id=b.id \
             GROUP BY b.id ORDER BY b.created_at DESC",
        ).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(StagedAssetBatch {
                    id: row.try_get("id")?,
                    source_exported_at: row.try_get("source_exported_at")?,
                    created_at: row.try_get("created_at")?,
                    item_count: row.try_get("item_count")?,
                    awaiting_verification: row.try_get("awaiting_verification")?,
                    blocked_count: row.try_get("blocked_count")?,
                })
            })
            .collect()
    }

    pub async fn list_items(&self, batch_id: Uuid) -> Result<Vec<StagedAssetRow>, sqlx::Error> {
        let rows = sqlx::query(
            "SELECT id,batch_id,source_asset_id,source_variant_id,name,review_status,resolved_copies,missing_copies,operator_decision,revision,entry_json,binding_overrides_json \
             FROM portable_asset_staged_items WHERE batch_id=? ORDER BY rowid",
        ).bind(batch_id.to_string()).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(StagedAssetRow {
                    id: row.try_get("id")?,
                    batch_id: row.try_get("batch_id")?,
                    source_asset_id: row.try_get("source_asset_id")?,
                    source_variant_id: row.try_get("source_variant_id")?,
                    name: row.try_get("name")?,
                    review_status: row.try_get("review_status")?,
                    resolved_copies: row.try_get("resolved_copies")?,
                    missing_copies: row.try_get("missing_copies")?,
                    operator_decision: row.try_get("operator_decision")?,
                    revision: row.try_get("revision")?,
                    entry_json: row.try_get("entry_json")?,
                    binding_overrides_json: row.try_get("binding_overrides_json")?,
                })
            })
            .collect()
    }

    pub async fn get_review_context(
        &self,
        batch_id: Uuid,
        item_id: Uuid,
    ) -> Result<Option<StagedAssetReviewContext>, sqlx::Error> {
        let row = sqlx::query(
            "SELECT i.entry_json,b.storage_mappings_json,i.binding_overrides_json,i.operator_decision,i.revision \
             FROM portable_asset_staged_items i \
             INNER JOIN portable_asset_batches b ON b.id=i.batch_id \
             WHERE i.id=? AND i.batch_id=? AND b.state='pending'",
        )
        .bind(item_id.to_string())
        .bind(batch_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(StagedAssetReviewContext {
                entry_json: row.try_get("entry_json")?,
                storage_mappings_json: row.try_get("storage_mappings_json")?,
                binding_overrides_json: row.try_get("binding_overrides_json")?,
                operator_decision: row.try_get("operator_decision")?,
                revision: row.try_get("revision")?,
            })
        })
        .transpose()
    }

    /// Compare-and-swap prevents a stale review window from overwriting another edit.
    /// The status vocabulary and decision vocabulary are enforced by SQL CHECK.
    pub async fn update_review(
        &self,
        batch_id: Uuid,
        item_id: Uuid,
        expected_revision: i64,
        review_status: &str,
        decision: &str,
        overrides_json: &str,
        resolved: i64,
        missing: i64,
    ) -> Result<bool, sqlx::Error> {
        let changed = sqlx::query(
            "UPDATE portable_asset_staged_items \
             SET review_status=?,operator_decision=?,binding_overrides_json=?,resolved_copies=?,missing_copies=?, \
                 revision=revision+1,reviewed_at=? \
             WHERE id=? AND batch_id=? AND revision=?",
        )
        .bind(review_status)
        .bind(decision)
        .bind(overrides_json)
        .bind(resolved)
        .bind(missing)
        .bind(Utc::now().to_rfc3339())
        .bind(item_id.to_string())
        .bind(batch_id.to_string())
        .bind(expected_revision)
        .execute(&self.pool)
        .await?;
        Ok(changed.rows_affected() == 1)
    }

    /// All-or-nothing operator-only batch decision. Never modifies bindings,
    /// local validation labels or anything in the active resource index.
    /// A concurrent editor changing one row rejects the entire operation.
    pub async fn update_batch_decisions(
        &self,
        batch_id: Uuid,
        changes: &[(Uuid, i64)],
        decision: &str,
    ) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let reviewed_at = Utc::now().to_rfc3339();
        for (item_id, expected_revision) in changes {
            let result = sqlx::query(
                "UPDATE portable_asset_staged_items \
                 SET operator_decision=?, revision=revision+1, reviewed_at=? \
                 WHERE id=? AND batch_id=? AND revision=? AND \
                 EXISTS (SELECT 1 FROM portable_asset_batches b \
                         WHERE b.id=portable_asset_staged_items.batch_id AND b.state='pending')",
            )
            .bind(decision)
            .bind(&reviewed_at)
            .bind(item_id.to_string())
            .bind(batch_id.to_string())
            .bind(expected_revision)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                // Dropping the open transaction rolls back already-updated rows.
                return Ok(false);
            }
        }
        tx.commit().await?;
        Ok(true)
    }

    /// Discard staging only. ON DELETE CASCADE removes review rows, never active assets.
    pub async fn discard(&self, batch_id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM portable_asset_batches WHERE id=?")
            .bind(batch_id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, status: &str) -> StagedAssetInput {
        StagedAssetInput {
            source_asset_id: Uuid::new_v4().to_string(),
            source_variant_id: Uuid::new_v4().to_string(),
            name: name.into(),
            review_status: status.into(),
            entry_json: "{\"name\":\"preview only\"}".into(),
            resolved_copies: 0,
            missing_copies: 1,
        }
    }

    #[sqlx::test]
    async fn stage_persists_and_rejects_duplicate_snapshot(
        pool: SqlitePool,
    ) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool.clone());
        assert!(
            repo.stage(
                Uuid::new_v4(),
                "2026-10-10T00:00:00Z",
                "[]",
                &[
                    input("one", "awaiting_verification"),
                    input("two", "needs_rebind")
                ]
            )
            .await?
        );
        assert!(
            !repo
                .stage(
                    Uuid::new_v4(),
                    "2026-10-10T00:00:00Z",
                    "[]",
                    &[input("again", "blocked_path")]
                )
                .await?
        );
        let list = repo.list_batches().await?;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].item_count, 2);
        assert_eq!(list[0].awaiting_verification, 1);
        assert_eq!(list[0].blocked_count, 1);
        assert_eq!(
            repo.list_items(Uuid::parse_str(&list[0].id).unwrap())
                .await?
                .len(),
            2
        );
        assert!(repo.discard(Uuid::parse_str(&list[0].id).unwrap()).await?);
        assert!(
            repo.list_items(Uuid::parse_str(&list[0].id).unwrap())
                .await?
                .is_empty()
        );
        Ok(())
    }

    #[sqlx::test]
    async fn staging_failure_rolls_back_entire_batch(pool: SqlitePool) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool);
        let first = input("ok", "needs_rebind");
        let mut invalid = input("bad", "online");
        invalid.source_variant_id = first.source_variant_id.clone();
        assert!(
            repo.stage(
                Uuid::new_v4(),
                "2026-10-10T02:00:00Z",
                "[]",
                &[first, invalid]
            )
            .await
            .is_err()
        );
        assert!(repo.list_batches().await?.is_empty());
        Ok(())
    }
    #[sqlx::test]
    async fn review_decisions_are_local_and_revision_guarded(
        pool: SqlitePool,
    ) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool.clone());
        let batch = Uuid::new_v4();
        repo.stage(
            batch,
            "2026-10-10T08:00:00Z",
            "[]",
            &[input("needs mapping", "needs_rebind")],
        )
        .await?;
        let item = repo.list_items(batch).await?.pop().unwrap();
        let item_id = Uuid::parse_str(&item.id).unwrap();
        let first = repo.get_review_context(batch, item_id).await?.unwrap();
        assert_eq!(first.revision, 0);
        assert!(
            repo.update_review(batch, item_id, 0, "needs_rebind", "defer", "[]", 0, 1)
                .await?
        );
        assert!(
            !repo
                .update_review(
                    batch,
                    item_id,
                    0,
                    "awaiting_verification",
                    "review",
                    "[]",
                    1,
                    0
                )
                .await?
        );
        let updated = repo.list_items(batch).await?.pop().unwrap();
        assert_eq!(updated.operator_decision, "defer");
        assert_eq!(updated.revision, 1);
        assert_eq!(updated.review_status, "needs_rebind");
        assert!(
            repo.update_review(batch, item_id, 1, "needs_rebind", "exclude", "[]", 0, 1)
                .await?
        );
        assert_eq!(repo.list_batches().await?.len(), 1);
        let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assets")
            .fetch_one(&pool)
            .await?;
        assert_eq!(active, 0);
        Ok(())
    }

    #[sqlx::test]
    async fn illegal_review_status_cannot_promote_to_online(
        pool: SqlitePool,
    ) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool);
        let batch = Uuid::new_v4();
        repo.stage(
            batch,
            "2026-10-10T09:00:00Z",
            "[]",
            &[input("photo", "awaiting_verification")],
        )
        .await?;
        let item_id = Uuid::parse_str(&repo.list_items(batch).await?[0].id).unwrap();
        assert!(
            repo.update_review(batch, item_id, 0, "online", "review", "[]", 1, 0)
                .await
                .is_err()
        );
        assert!(
            repo.update_review(
                batch,
                item_id,
                0,
                "awaiting_verification",
                "verified",
                "[]",
                1,
                0
            )
            .await
            .is_err()
        );
        assert_eq!(
            repo.get_review_context(batch, item_id)
                .await?
                .unwrap()
                .revision,
            0
        );
        Ok(())
    }    #[sqlx::test]
    async fn batch_decision_update_is_atomic_and_leaves_resource_state_alone(
        pool: SqlitePool,
    ) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool.clone());
        let batch = Uuid::new_v4();
        repo.stage(
            batch, "2026-10-10T10:00:00Z", "[]",
            &[input("alpha", "needs_rebind"), input("beta", "blocked_duplicate")],
        ).await?;
        let items = repo.list_items(batch).await?;
        let a = Uuid::parse_str(&items[0].id).unwrap();
        let b = Uuid::parse_str(&items[1].id).unwrap();

        // A stale second revision means the first update must also roll back.
        assert!(!repo.update_batch_decisions(batch, &[(a, 0), (b, 4)], "exclude").await?);
        let unchanged = repo.list_items(batch).await?;
        assert_eq!(unchanged[0].revision, 0);
        assert_eq!(unchanged[0].operator_decision, "review");
        assert_eq!(unchanged[1].revision, 0);

        assert!(repo.update_batch_decisions(batch, &[(a, 0), (b, 0)], "defer").await?);
        let deferred = repo.list_items(batch).await?;
        assert_eq!(deferred.iter().map(|i| i.revision).collect::<Vec<_>>(), vec![1, 1]);
        assert!(deferred.iter().all(|i| i.operator_decision == "defer"));
        assert_eq!(deferred[0].review_status, "needs_rebind");
        assert_eq!(deferred[1].review_status, "blocked_duplicate");
        assert!(deferred.iter().all(|i| i.binding_overrides_json == "[]"));
        let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM assets").fetch_one(&pool).await?;
        assert_eq!(active, 0);
        Ok(())
    }

    #[sqlx::test]
    async fn batch_decisions_reject_cross_batch_rows(
        pool: SqlitePool,
    ) -> Result<(), sqlx::Error> {
        let repo = AssetStagingRepository::new(pool);
        let own = Uuid::new_v4();
        let other = Uuid::new_v4();
        repo.stage(own,"2026-10-10T11:00:00Z","[]",&[input("one", "needs_rebind")]).await?;
        repo.stage(other,"2026-10-10T12:00:00Z","[]",&[input("two", "needs_rebind")]).await?;
        let foreign = Uuid::parse_str(&repo.list_items(other).await?[0].id).unwrap();
        assert!(!repo.update_batch_decisions(own,&[(foreign,0)],"exclude").await?);
        assert_eq!(repo.list_items(other).await?[0].operator_decision, "review");
        Ok(())
    }


}
