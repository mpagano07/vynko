-- Agregar ON DELETE CASCADE a foreign keys de product_id que lo tienen sin especificar.
-- Sin esto, borrar un producto que tiene ventas/compras asociadas falla con FK violation.

ALTER TABLE sale_items
  DROP CONSTRAINT IF EXISTS sale_items_product_id_fkey,
  ADD CONSTRAINT sale_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE po_items
  DROP CONSTRAINT IF EXISTS po_items_product_id_fkey,
  ADD CONSTRAINT po_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_product_id_fkey,
  ADD CONSTRAINT purchase_order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
