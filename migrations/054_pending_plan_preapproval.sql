-- Track pending preapproval for plan change (downgrade) not yet confirmed by webhook
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mercadopago_pending_preapproval_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mercadopago_pending_plan TEXT CHECK (mercadopago_pending_plan IN ('starter','business'));
COMMENT ON COLUMN tenants.mercadopago_pending_preapproval_id IS 'Preapproval creado para un cambio de plan pendiente de pago (downgrade/upgrade pendiente)';
COMMENT ON COLUMN tenants.mercadopago_pending_plan IS 'Plan destino del preapproval pendiente';
