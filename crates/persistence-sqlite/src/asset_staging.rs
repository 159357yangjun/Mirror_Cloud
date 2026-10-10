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
             COALESCE(SUM(CASE WHEN i.review_status='awaiting_verification' THEN 1 ELSE 0 END),0) AS awaiting_verification, \
             COALESCE(SUM(CASE WHEN i.review_status<>'awaiting_verification' THEN 1 ELSE 0 END),0) AS blocked_count \
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
            "SELECT id,batch_id,source_asset_id,source_variant_id,name,review_status,resolved_copies,missing_copies \
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
                })
            })
            .collect()
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
}
