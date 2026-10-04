ALTER TABLE plugins ADD COLUMN granted_permissions_json TEXT NOT NULL DEFAULT '["read_asset"]';
UPDATE plugins
SET enabled = 0
WHERE manifest_json LIKE '%"network"%'
   OR manifest_json LIKE '%"secret"%'
   OR manifest_json LIKE '%"external_write"%';
