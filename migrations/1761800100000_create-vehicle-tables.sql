-- Up Migration
CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL,
  brand text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  cylinder text NOT NULL,
  chassis text NOT NULL,
  owner_name text NOT NULL,
  owner_document text NOT NULL,
  color text NOT NULL,
  fuel_type text NOT NULL,
  transmission text NOT NULL,
  mileage integer NOT NULL,
  registration_date date NOT NULL,
  runt_number text NOT NULL,
  runt_expires_on date NOT NULL,
  soat_number text NOT NULL,
  soat_expires_on date NOT NULL,
  rtm_number text NOT NULL,
  rtm_expires_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_plate_format CHECK (plate ~ '^[A-Z]{3}-[0-9]{4}$'),
  CONSTRAINT vehicles_year_valid CHECK (year BETWEEN 1900 AND 2100),
  CONSTRAINT vehicles_mileage_valid CHECK (mileage >= 0)
);
CREATE UNIQUE INDEX vehicles_plate_key ON vehicles (plate);

CREATE TABLE inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
  code text NOT NULL,
  category text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  result text NOT NULL,
  notes text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspections_status_valid CHECK (status IN ('Aprobado', 'Atención', 'No aprobado'))
);
CREATE UNIQUE INDEX inspections_vehicle_code_key ON inspections (vehicle_id, code);

-- Down Migration
DROP TABLE inspections;
DROP TABLE vehicles;
