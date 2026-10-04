ALTER TABLE plugins ADD COLUMN enabled_hooks_json TEXT NOT NULL DEFAULT '["after_upload"]';
