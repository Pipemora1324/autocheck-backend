-- Up Migration
-- Historial de diagnósticos. No se guarda la imagen. confianza es NULL cuando el usuario eligió el testigo a mano.
-- telltale_id apunta al catálogo versionado en src/data/telltales.ts, que no es una tabla.
CREATE TABLE diagnoses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES user_vehicles (id) ON DELETE CASCADE,
  telltale_id text NOT NULL,
  severidad text NOT NULL,
  confianza double precision,
  descripcion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnoses_severidad_valid CHECK (severidad IN ('rojo', 'amarillo', 'informativo')),
  CONSTRAINT diagnoses_confianza_valid CHECK (confianza IS NULL OR confianza BETWEEN 0 AND 1),
  CONSTRAINT diagnoses_descripcion_length CHECK (descripcion IS NULL OR char_length(descripcion) <= 500)
);
CREATE INDEX diagnoses_vehicle_created_idx ON diagnoses (vehicle_id, created_at DESC, id DESC);
CREATE INDEX diagnoses_user_id_idx ON diagnoses (user_id);

-- Down Migration
DROP TABLE diagnoses;
