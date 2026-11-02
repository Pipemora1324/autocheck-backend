-- Up Migration
-- Garaje: vehículos reales registrados por cada usuario. No se guarda el documento del propietario.
CREATE TABLE user_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plate text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  color text,
  cylinder_cc integer,
  chassis text,
  fuel_type text,
  service_type text,
  soat_expires_on date,
  rtm_expires_on date,
  runt_status text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Carro ABC-123 o moto ABC-12D.
  CONSTRAINT user_vehicles_plate_format CHECK (plate ~ '^[A-Z]{3}-([0-9]{3}|[0-9]{2}[A-Z])$'),
  CONSTRAINT user_vehicles_year_valid CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  CONSTRAINT user_vehicles_cylinder_valid CHECK (cylinder_cc IS NULL OR cylinder_cc BETWEEN 1 AND 20000),
  CONSTRAINT user_vehicles_source_valid CHECK (source IN ('manual', 'scan', 'runt'))
);
CREATE UNIQUE INDEX user_vehicles_user_plate_key ON user_vehicles (user_id, plate);

-- Down Migration
DROP TABLE user_vehicles;
