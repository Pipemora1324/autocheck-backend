-- Up Migration
-- Evidencia de la autorización para el tratamiento de datos (Ley 1581 de 2012): fecha y versión aceptada.
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN terms_version text;

-- Down Migration
ALTER TABLE users DROP COLUMN terms_version;
ALTER TABLE users DROP COLUMN terms_accepted_at;
