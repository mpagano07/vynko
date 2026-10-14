-- ========================================
-- ARCA Credit Notes (Notas de Crédito)
-- ========================================
-- Una Nota de Crédito acredita a un comprobante ya emitido. Se guarda a quién
-- referencia para poder mostrar la relación, impedir acreditaciones dobles y
-- (más adelante) reconstruir la cadena fiscal.

ALTER TABLE electronic_invoices
  ADD COLUMN IF NOT EXISTS related_invoice_id UUID REFERENCES electronic_invoices(id) ON DELETE SET NULL;

-- Acelera la búsqueda de la NC de una factura (idempotencia de creación).
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_related_invoice_id
  ON electronic_invoices(related_invoice_id);
