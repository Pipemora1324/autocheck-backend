-- Up Migration
-- resultado: los testigos con su explicación (JSON, sin imagen), para releerlos sin llamar a la IA.
-- telltale_id solo aplica a la elección manual: un diagnóstico con IA no sale del catálogo.
ALTER TABLE diagnoses ALTER COLUMN telltale_id DROP NOT NULL;
ALTER TABLE diagnoses ADD COLUMN resultado jsonb;

-- Down Migration
-- Los diagnósticos con IA no tienen testigo del catálogo, así que no caben en el esquema anterior.
DELETE FROM diagnoses WHERE telltale_id IS NULL;
ALTER TABLE diagnoses DROP COLUMN resultado;
ALTER TABLE diagnoses ALTER COLUMN telltale_id SET NOT NULL;
