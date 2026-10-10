-- P2 phase 3: per-row operator decisions and local-only rebindings.
-- Decisions never imply provider validation, or grant delete/share operations.
ALTER TABLE portable_asset_staged_items
  ADD COLUMN operator_decision TEXT NOT NULL DEFAULT 'review'
  CHECK (operator_decision IN ('review','defer','exclude'));
ALTER TABLE portable_asset_staged_items
  ADD COLUMN binding_overrides_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE portable_asset_staged_items
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE portable_asset_staged_items
  ADD COLUMN reviewed_at TEXT;
