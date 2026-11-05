-- Up Migration
ALTER TABLE user_vehicles
  ADD COLUMN mileage_km integer,
  ADD CONSTRAINT user_vehicles_mileage_valid CHECK (mileage_km IS NULL OR mileage_km BETWEEN 0 AND 9999999);

-- Down Migration
ALTER TABLE user_vehicles
  DROP CONSTRAINT user_vehicles_mileage_valid,
  DROP COLUMN mileage_km;
