-- =============================================================================
-- Migración 003 (UP): Versión de credenciales en tb_usuarios (token_version)
-- Motivo: invalidar sesiones abiertas cuando cambia la contraseña o la cuenta
-- se desactiva. El JWT lleva el claim `tv`; verificarToken exige tv === token_version.
-- Tokens antiguos sin `tv` se leen como 0 (compatibilidad: siguen válidos hasta
-- el primer cambio). SOLO ADITIVA E IDEMPOTENTE (IF NOT EXISTS).
-- Ejecutar: node migrations/run-migration.mjs migrations/003_token_version.up.sql
-- =============================================================================

BEGIN;

ALTER TABLE tb_usuarios
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
