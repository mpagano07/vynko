-- Baja definitiva de una variante en una sucursal.
--
-- `product_variants` es GLOBAL (igual que `products`): no se puede borrar la
-- fila, porque el historial de ventas/movimientos la referencia con
-- ON DELETE SET NULL y otras sucursales pueden compartir el mismo producto.
-- Lo que se elimina es la pertenencia de este tenant: `variant_stock` (la
-- variante deja de aparecer en catálogo/POS) y `sellable_codes` (sus códigos
-- quedan libres). La fila global queda como metadata del historial.
--
-- Se bloquea si hay transferencias o compras abiertas que todavía la usan:
-- esos flujos necesitan la fila de `variant_stock` para mover/creditar stock.

CREATE OR REPLACE FUNCTION public.delete_product_variant(
  p_variant_id UUID,
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_label TEXT;
BEGIN
  SELECT v.label INTO v_label
    FROM public.variant_stock s
    JOIN public.product_variants v ON v.id = s.variant_id
   WHERE s.variant_id = p_variant_id
     AND s.tenant_id = p_tenant_id
   FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_in_tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.stock_transfer_items it
      JOIN public.stock_transfers t ON t.id = it.transfer_id
     WHERE it.variant_id = p_variant_id
       AND t.status IN ('pending', 'in_transit')
       AND (t.from_tenant_id = p_tenant_id OR t.to_tenant_id = p_tenant_id)
  ) OR EXISTS (
    SELECT 1
      FROM public.purchase_order_items it
      JOIN public.purchase_orders po ON po.id = it.purchase_order_id
     WHERE it.variant_id = p_variant_id
       AND po.tenant_id = p_tenant_id
       AND po.status IN ('draft', 'sent', 'partial')
  ) THEN
    RAISE EXCEPTION 'variant_in_use' USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM public.sellable_codes
   WHERE tenant_id = p_tenant_id
     AND variant_id = p_variant_id;

  DELETE FROM public.variant_stock
   WHERE variant_id = p_variant_id
     AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('ok', true, 'label', v_label);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product_variant(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_variant(UUID, UUID) TO service_role;
