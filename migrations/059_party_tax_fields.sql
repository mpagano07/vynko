-- ========================================
-- Datos fiscales de terceros (clientes y proveedores)
-- ========================================
-- Para poder emitir (o recibir) un comprobante hacen falta el CUIT, la
-- condición frente al IVA y el documento del receptor. En `customers` ya
-- existen desde 011_afip_invoices.sql; acá se suman a los proveedores, que
-- se guardan en `suppliers` y se espejan en `providers`.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS iva_condition TEXT
  CHECK (iva_condition IN ('responsable_inscripto', 'monotributista', 'consumidor_final', 'sujeto_exento', 'responsable_no_inscripto'));
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS document_type TEXT
  CHECK (document_type IN ('DNI', 'CUIL', 'CUIT', 'Pasaporte', 'CE'));
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS document_number TEXT;

ALTER TABLE providers ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS iva_condition TEXT
  CHECK (iva_condition IN ('responsable_inscripto', 'monotributista', 'consumidor_final', 'sujeto_exento', 'responsable_no_inscripto'));
ALTER TABLE providers ADD COLUMN IF NOT EXISTS document_type TEXT
  CHECK (document_type IN ('DNI', 'CUIL', 'CUIT', 'Pasaporte', 'CE'));
ALTER TABLE providers ADD COLUMN IF NOT EXISTS document_number TEXT;
