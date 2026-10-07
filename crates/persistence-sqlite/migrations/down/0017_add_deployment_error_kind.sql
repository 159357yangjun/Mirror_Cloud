-- Reverse of 0017_add_deployment_error_kind.sql.

ALTER TABLE deployments DROP COLUMN last_error_kind;
