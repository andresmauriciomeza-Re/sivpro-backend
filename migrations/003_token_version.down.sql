-- =============================================================================
-- Migración 003 (DOWN): Eliminar tb_usuarios.token_version
-- ATENCIÓN: revertir primero el código (middlewares/auth.js y auth.service.js
-- leen/escriben esta columna); con el código nuevo desplegado, esta columna
-- no puede faltar.
-- Ejecutar: node migrations/run-migration.mjs migrations/003_token_version.down.sql
-- =============================================================================

BEGIN;

ALTER TABLE tb_usuarios
  DROP COLUMN IF EXISTS token_version;

COMMIT;
