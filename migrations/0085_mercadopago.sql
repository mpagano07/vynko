-- Add Mercado Pago preapproval id to tenants table

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mercadopago_preapproval_id TEXT;