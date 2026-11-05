-- Up Migration
-- Sin alertas de vencimiento ni consulta al RUNT estos datos ya no tienen finalidad ni una API para consultarlos
-- o corregirlos. Conservarlos iría contra el principio de finalidad de la Ley 1581 de 2012, por eso se eliminan.
ALTER TABLE user_vehicles
  DROP COLUMN soat_expires_on,
  DROP COLUMN rtm_expires_on,
  DROP COLUMN runt_status;

ALTER TABLE user_vehicles DROP CONSTRAINT user_vehicles_source_valid;
UPDATE user_vehicles SET source = 'manual' WHERE source = 'runt';
ALTER TABLE user_vehicles ADD CONSTRAINT user_vehicles_source_valid CHECK (source IN ('manual', 'scan'));

-- Down Migration
-- Restaura la estructura; los valores eliminados no se pueden recuperar y las columnas quedan vacías.
ALTER TABLE user_vehicles DROP CONSTRAINT user_vehicles_source_valid;
ALTER TABLE user_vehicles ADD CONSTRAINT user_vehicles_source_valid CHECK (source IN ('manual', 'scan', 'runt'));

ALTER TABLE user_vehicles
  ADD COLUMN soat_expires_on date,
  ADD COLUMN rtm_expires_on date,
  ADD COLUMN runt_status text;
