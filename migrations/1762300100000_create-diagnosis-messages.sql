-- Up Migration
-- Conversación con la IA sobre un diagnóstico. Solo texto, sin imágenes. Se borra con el diagnóstico.
CREATE TABLE diagnosis_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnosis_id uuid NOT NULL REFERENCES diagnoses (id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnosis_messages_role_valid CHECK (role IN ('user', 'assistant')),
  CONSTRAINT diagnosis_messages_content_length CHECK (char_length(content) BETWEEN 1 AND 6000)
);
CREATE INDEX diagnosis_messages_diagnosis_created_idx ON diagnosis_messages (diagnosis_id, created_at, id);

-- Down Migration
DROP TABLE diagnosis_messages;
