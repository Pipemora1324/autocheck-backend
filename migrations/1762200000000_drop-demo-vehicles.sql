-- Up Migration
-- Las rutas de demostración /vehicles ya no existen: estas tablas solo tenían 3 placas ficticias.
DROP TABLE inspections;
DROP TABLE vehicles;

-- Down Migration
-- Restaura la estructura y los datos ficticios de 1761800100000 y 1761800200000.
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

INSERT INTO vehicles (
  plate, brand, model, year, cylinder, chassis, owner_name, owner_document, color, fuel_type, transmission,
  mileage, registration_date, runt_number, runt_expires_on, soat_number, soat_expires_on, rtm_number, rtm_expires_on, updated_at
) VALUES
  ('ABC-1234', 'Toyota', 'Corolla', 2022, '1.8L', 'TKY4U2E2NCV123456', 'Ana María Pérez Rodríguez', 'CC 12345678', 'Blanco', 'Gasolina', 'Automática',
   18420, '2022-05-14', 'RUNT-2022-001', '2027-12-31', 'SOAT-2026-001', '2026-09-30', 'RTM-2026-001', '2027-06-30', '2026-08-01T10:30:00Z'),
  ('DEF-5678', 'Mazda', 'CX-5', 2021, '2.0L', 'JM1V8W2F9MN123456', 'Luis Alberto Vega Restrepo', 'CC 87432190', 'Negro', 'Diesel', 'Automática',
   48200, '2021-09-22', 'RUNT-2021-002', '2024-11-30', 'SOAT-2025-002', '2025-08-31', 'RTM-2025-002', '2026-10-15', '2026-07-28T09:15:00Z'),
  ('GHI-9012', 'BMW', 'X3', 2023, '2.0L', 'WBX5U5C52M4C12345', 'Sofía Camila Torres Valencia', 'CC 1010101010', 'Gris', 'Híbrido', 'Automática',
   12680, '2023-01-10', 'RUNT-2023-003', '2028-01-31', 'SOAT-2026-003', '2027-01-31', 'RTM-2026-003', '2027-03-31', '2026-08-02T12:40:00Z');

INSERT INTO inspections (vehicle_id, code, category, name, status, result, notes, sort_order, updated_at)
SELECT v.id, i.code, i.category, i.name, i.status, i.result, i.notes, i.sort_order, v.updated_at
FROM (VALUES
  ('ABC-1234', 'body', 'Exterior', 'Carrocería y pintura', 'Aprobado', 'Sin daños visibles', 'Revisión exterior correcta.', 1),
  ('ABC-1234', 'brakes', 'Frenos', 'Frenos y líquido', 'Aprobado', 'En buen estado', 'Frenos delanteros y traseros aprobados.', 2),
  ('ABC-1234', 'steering', 'Dirección', 'Dirección y suspensión', 'Atención', 'Revisión pendiente', 'Conjunto de suspensión requiere revisión.', 3),
  ('ABC-1234', 'lights', 'Iluminación', 'Luces y señales', 'Aprobado', 'Funciona correctamente', 'Todas las luces están operativas.', 4),
  ('ABC-1234', 'tires', 'Neumáticos', 'Neumáticos y presión', 'Aprobado', 'Presión correcta', 'Marcha estimada de 4.2 mm.', 5),
  ('ABC-1234', 'engine', 'Motor', 'Motor y escapes', 'Aprobado', 'Sin fallas detectadas', 'Nivel de aceite dentro de parámetros.', 6),
  ('DEF-5678', 'body', 'Exterior', 'Carrocería y pintura', 'Atención', 'Daños menores', 'Rayón en el lateral izquierdo.', 1),
  ('DEF-5678', 'brakes', 'Frenos', 'Frenos y líquido', 'No aprobado', 'Frenos desgastados', 'Reemplazo recomendado.', 2),
  ('DEF-5678', 'steering', 'Dirección', 'Dirección y suspensión', 'Aprobado', 'Sin anomalías', 'Sistema de suspensión correcto.', 3),
  ('DEF-5678', 'lights', 'Iluminación', 'Luces y señales', 'Aprobado', 'Funciona correctamente', 'Todas las luces están operativas.', 4),
  ('DEF-5678', 'tires', 'Neumáticos', 'Neumáticos y presión', 'Atención', 'Neumático delantero roto', 'Cambio recomendado antes de circular.', 5),
  ('DEF-5678', 'engine', 'Motor', 'Motor y escapes', 'Aprobado', 'Sin fallas detectadas', 'Compra de aceite pendiente.', 6),
  ('GHI-9012', 'body', 'Exterior', 'Carrocería y pintura', 'Aprobado', 'Sin daños visibles', 'Revisión exterior correcta.', 1),
  ('GHI-9012', 'brakes', 'Frenos', 'Frenos y líquido', 'Aprobado', 'En buen estado', 'Frenos y líquido aprobados.', 2),
  ('GHI-9012', 'steering', 'Dirección', 'Dirección y suspensión', 'Aprobado', 'Sin anomalías', 'Sistema correcto.', 3),
  ('GHI-9012', 'lights', 'Iluminación', 'Luces y señales', 'Aprobado', 'Funciona correctamente', 'Todas las luces están operativas.', 4),
  ('GHI-9012', 'tires', 'Neumáticos', 'Neumáticos y presión', 'Aprobado', 'Presión correcta', 'Marcha estimada de 5.1 mm.', 5),
  ('GHI-9012', 'engine', 'Motor', 'Motor y escapes', 'Aprobado', 'Sin fallas detectadas', 'Sistema híbrido operativo.', 6)
) AS i (plate, code, category, name, status, result, notes, sort_order)
JOIN vehicles v ON v.plate = i.plate;
