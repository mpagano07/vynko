-- Baja definitiva de una variante en una sucursal.
--
-- `product_variants` es GLOBAL (igual que `products`): no se puede borrar la
-- fila, porque el historial de ventas/movimientos la referencia con
-- ON DELETE SET NULL y otras sucursales pueden compartir el mismo producto.
-- Lo que se elimina es la pertenencia de este tenant: `variant_stock` (la
-- variante deja de aparecer en catálogo/POS) y `sellable_codes` (sus códigos
-- quedan libres). La fila global queda como metadata del historial, pero sus
-- códigos se liberan: `uq_product_variants_sku` es global por producto y, si no,
-- un SKU borrado no se podría reutilizar aunque ya no lo use nadie.
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

  -- La fila global se conserva para el historial, pero uq_product_variants_sku
  -- /uq_product_variants_barcode la siguen considerando ocupada. Si ningún
  -- tenant tiene ya esta variante, liberamos sus códigos para poder crear otra
  -- con el mismo SKU/barcode. El label se conserva para leer documentos viejos.
  IF NOT EXISTS (
    SELECT 1 FROM public.variant_stock s WHERE s.variant_id = p_variant_id
  ) THEN
    UPDATE public.product_variants
       SET sku = '', barcode = NULL, updated_at = now()
     WHERE id = p_variant_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'label', v_label);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product_variant(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_variant(UUID, UUID) TO service_role;

-- Reparación para bases donde ya se borraron variantes con la versión anterior
-- de esta RPC: la fila global quedó con el SKU ocupado aunque ningún tenant
-- tenga ya `variant_stock`. Sólo se limpia lo que nadie usa: si otra sucursal
-- conserva la variante, sus códigos siguen vigentes y no se tocan.
UPDATE public.product_variants v
   SET sku = '', barcode = NULL, updated_at = now()
 WHERE (COALESCE(v.sku, '') <> '' OR v.barcode IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM public.variant_stock s WHERE s.variant_id = v.id
   );
