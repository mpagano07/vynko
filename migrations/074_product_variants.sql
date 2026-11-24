-- ============================================================
-- 074: productos principales con variantes creadas manualmente
-- ============================================================
--
-- Aditiva e idempotente. No toca products, product_stock ni ninguna fila
-- historica: los productos simples siguen por product_stock y todas las RPC
-- existentes conservan su firma y su contrato cuando no hay variante.
--
-- Modelo:
--   products (padre, catalogo global como hoy)
--     -> product_attributes / product_attribute_values (definiciones globales)
--     -> product_variants (unidad comercializable, con SKU/barcode/precio/costo propios)
--          -> product_variant_values (identidad relacional de la variante)
--          -> variant_stock (inventario por variante y sucursal)
--
-- Unicidad de codigos: `sellable_codes` registra por (tenant, tipo, codigo) y
-- pertenece a un producto_simple O a una variante. El RPC que lo escribe toma
-- un advisory lock de transaccion sobre TENANT + CODIGO (no por tipo), asi que
-- un mismo valor no puede quedar como SKU de un articulo y barcode de otro:
-- dos altas concurrentes se serializan y una pierde con
-- `duplicate_sellable_code`. No es una validacion de JavaScript.
--
-- ORDEN DE DEPLOY: esta migracion va ANTES que el codigo que la usa. El codigo
-- viejo no conoce las columnas nuevas y sigue funcionando.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Definiciones de atributos y valores (catalogo global)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.product_attribute_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id UUID NOT NULL REFERENCES public.product_attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attribute_id, value)
);

CREATE INDEX IF NOT EXISTS idx_product_attribute_values_attribute
  ON public.product_attribute_values (attribute_id);

-- ------------------------------------------------------------
-- 2. Variantes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT,
  label TEXT NOT NULL,
  price_cents BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cost NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Varios SKU vacíos por producto son legítimos: el SKU es opcional y la
-- unicidad la resuelve `sellable_codes` solo cuando el código no está vacío.
-- La restricción inline se elimina también si la migración ya se aplicó a medias.
ALTER TABLE public.product_variants
  DROP CONSTRAINT IF EXISTS product_variants_product_id_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku
  ON public.product_variants (product_id, sku) WHERE sku <> '';

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants (product_id);
-- barcode no es globalmente unico (migracion 016 quito el UNIQUE de products):
-- la unicidad real se resuelve en sellable_codes, por tenant.
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants (barcode);

CREATE TABLE IF NOT EXISTS public.product_variant_values (
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  value_id UUID NOT NULL REFERENCES public.product_attribute_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, value_id)
);

CREATE INDEX IF NOT EXISTS idx_product_variant_values_value
  ON public.product_variant_values (value_id);

-- ------------------------------------------------------------
-- 3. Stock por variante y sucursal
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.variant_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  max_stock INTEGER NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  deposito TEXT,
  pasillo TEXT,
  estanteria TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (variant_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_stock_tenant_active ON public.variant_stock (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_variant_stock_variant ON public.variant_stock (variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_stock_critical
  ON public.variant_stock (tenant_id) WHERE active AND stock <= min_stock;

-- ------------------------------------------------------------
-- 4. Registro compartido de codigos comercializables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sellable_codes (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sku', 'barcode')),
  code TEXT NOT NULL CHECK (char_length(code) > 0),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, code),
  CHECK ((product_id IS NULL) <> (variant_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_sellable_codes_product ON public.sellable_codes (product_id);
CREATE INDEX IF NOT EXISTS idx_sellable_codes_variant ON public.sellable_codes (variant_id);

-- Backfill ADITIVO: registra los codigos no vacios que ya existen, por tenant.
-- No modifica products ni product_stock; ON CONFLICT descarta repetidos (el
-- codigo ya estaba en uso y por eso no puede ser adoptado por una variante).
-- Un codigo duplicado historicamente queda reservado al primer producto, que
-- es el que el lookup por SKU/barcode ya resuelve en cada tenant.
INSERT INTO public.sellable_codes (tenant_id, kind, code, product_id)
SELECT ps.tenant_id, 'sku', btrim(p.sku), p.id
  FROM public.products p
  JOIN public.product_stock ps ON ps.product_id = p.id
 WHERE p.sku IS NOT NULL AND btrim(p.sku) <> ''
ON CONFLICT (tenant_id, kind, code) DO NOTHING;

INSERT INTO public.sellable_codes (tenant_id, kind, code, product_id)
SELECT ps.tenant_id, 'barcode', btrim(p.barcode), p.id
  FROM public.products p
  JOIN public.product_stock ps ON ps.product_id = p.id
 WHERE p.barcode IS NOT NULL AND btrim(p.barcode) <> ''
ON CONFLICT (tenant_id, kind, code) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Columnas nullable en tablas transaccionales
-- ------------------------------------------------------------
ALTER TABLE public.sale_items                 ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.stock_history              ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements            ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_order_items       ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.stock_transfer_items       ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.commercial_document_items  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.invoice_items              ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON public.sale_items (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_history_variant ON public.stock_history (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_variant ON public.stock_transfer_items (variant_id);

-- ------------------------------------------------------------
-- 6. Un producto con variantes activas no mueve stock por padre
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_parent_stock_with_variants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  IF TG_OP = 'UPDATE'
     AND NEW.stock IS NOT DISTINCT FROM OLD.stock
     AND NEW.active IS NOT DISTINCT FROM OLD.active THEN
    RETURN NEW;
  END IF;
  -- `active` es por sucursal: una variante dada de baja en otra empresa no
  -- puede bloquear el stock del padre acá. La baja no borra historial.
  IF EXISTS (
    SELECT 1 FROM public.product_variants v
      JOIN public.variant_stock s ON s.variant_id = v.id
     WHERE v.product_id = v_product_id
       AND s.tenant_id = NEW.tenant_id
       AND s.active
  ) THEN
    RAISE EXCEPTION 'parent_stock_locked'
      USING ERRCODE = 'check_violation',
            MESSAGE = 'El producto tiene variantes activas: el stock se mueve por variante';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_parent_stock_with_variants ON public.product_stock;
CREATE TRIGGER trg_block_parent_stock_with_variants
  BEFORE INSERT OR UPDATE OF stock, active ON public.product_stock
  FOR EACH ROW EXECUTE FUNCTION public.block_parent_stock_with_variants();

REVOKE ALL ON FUNCTION public.block_parent_stock_with_variants() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7. RLS y permisos
-- ------------------------------------------------------------
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variant_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sellable_codes ENABLE ROW LEVEL SECURITY;

-- Lectura de catalogo publica para usuarios autenticados, igual que products.
-- Escritura: solo service_role (la app valida manage_catalog en el servidor).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'product_attributes', 'product_attribute_values',
    'product_variants', 'product_variant_values'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'Authenticated users can view ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Authenticated users can view %1$s" ON public.%1$s FOR SELECT USING (auth.role() = ''authenticated'')',
        t
      );
    END IF;
  END LOOP;
END $$;

-- Stock por sucursal: mismo aislamiento que product_stock, con el helper de
-- membresias activas (034/067) para no recursar RLS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'variant_stock'
      AND policyname = 'Users can view their tenant variant stock'
  ) THEN
    CREATE POLICY "Users can view their tenant variant stock" ON public.variant_stock
      FOR SELECT USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
  END IF;
  -- Mismo alcance que product_stock (016): leer/insertar/actualizar, sin
  -- borrado desde el cliente. La baja de una variante es un UPDATE de `active`
  -- y el historial queda intacto.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'variant_stock'
      AND policyname = 'Users can insert their tenant variant stock'
  ) THEN
    CREATE POLICY "Users can insert their tenant variant stock" ON public.variant_stock
      FOR INSERT WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'variant_stock'
      AND policyname = 'Users can update their tenant variant stock'
  ) THEN
    CREATE POLICY "Users can update their tenant variant stock" ON public.variant_stock
      FOR UPDATE USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
  END IF;
  DROP POLICY IF EXISTS "Users can write their tenant variant stock" ON public.variant_stock;
END $$;

-- sellable_codes queda deny-all: solo la service_role, desde los RPC.
REVOKE ALL ON TABLE public.sellable_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sellable_codes TO service_role;

-- ============================================================
-- 8. RPCs de catalogo y codigos
-- ============================================================

-- Registro transaccional de un codigo. El lock por clave hace que dos
-- operaciones concurrentes no puedan both pasar la verificacion.
CREATE OR REPLACE FUNCTION public.register_sellable_code(
  p_tenant_id UUID,
  p_kind TEXT,
  p_code TEXT,
  p_product_id UUID DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_owner_product UUID;
  v_owner_variant UUID;
  v_conflict UUID;
BEGIN
  IF p_kind NOT IN ('sku', 'barcode') THEN
    RAISE EXCEPTION 'invalid_code_kind' USING ERRCODE = 'check_violation';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    -- SKU vacio es legal (Tiendanube no exporta SKU) y no identifica nada.
    RETURN TRUE;
  END IF;
  v_code := btrim(p_code);

  -- Lock por (tenant, codigo), no por tipo: el escaner no sabe si lo que leyo
  -- es un SKU o un barcode, asi que ambos deben resolver al MISMO articulo.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::TEXT || ':code:' || v_code));

  FOR v_owner_product, v_owner_variant IN
    SELECT sc.product_id, sc.variant_id
      FROM public.sellable_codes sc
     WHERE sc.tenant_id = p_tenant_id AND sc.code = v_code
     FOR UPDATE
  LOOP
    IF v_owner_product IS DISTINCT FROM p_product_id
       OR v_owner_variant IS DISTINCT FROM p_variant_id THEN
      RAISE EXCEPTION 'duplicate_sellable_code: % %', p_kind, v_code
        USING ERRCODE = 'unique_violation';
    END IF;
  END LOOP;

  -- Codigo historico que todavia no estaba registrado (producto creado antes de
  -- esta migracion, o con el codigo cambiado): no puede ser adoptado. Se miran
  -- SKU y barcode a la vez por la misma razon del lock de arriba.
  SELECT p.id INTO v_conflict
    FROM public.products p
    JOIN public.product_stock ps ON ps.product_id = p.id
   WHERE ps.tenant_id = p_tenant_id
     AND (btrim(COALESCE(p.sku, '')) = v_code
       OR btrim(COALESCE(p.barcode, '')) = v_code)
   LIMIT 1;
  IF v_conflict IS NOT NULL AND v_conflict IS DISTINCT FROM p_product_id THEN
    RAISE EXCEPTION 'duplicate_sellable_code: % %', p_kind, v_code
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.sellable_codes (tenant_id, kind, code, product_id, variant_id)
  VALUES (p_tenant_id, p_kind, v_code, p_product_id, p_variant_id)
  ON CONFLICT (tenant_id, kind, code) DO NOTHING;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.register_sellable_code(UUID, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_sellable_code(UUID, TEXT, TEXT, UUID, UUID) TO service_role;

-- Alta de variante: variante + valores + stock + codigos + historial en una
-- sola transaccion. La pertenencia se comprueba por product_stock del tenant.
CREATE OR REPLACE FUNCTION public.create_product_variant(
  p_product_id UUID,
  p_tenant_id UUID,
  p_by UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_label TEXT,
  p_price_cents BIGINT,
  p_cost NUMERIC,
  p_value_ids UUID[],
  p_stock INTEGER DEFAULT 0,
  p_min_stock INTEGER DEFAULT 0,
  p_max_stock INTEGER DEFAULT 0,
  p_deposito TEXT DEFAULT NULL,
  p_pasillo TEXT DEFAULT NULL,
  p_estanteria TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_variant_id UUID;
  v_row JSONB;
  v_value UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.product_stock
     WHERE product_id = p_product_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'product_not_in_tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'variant_label_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 0 THEN
    RAISE EXCEPTION 'invalid_variant_price' USING ERRCODE = 'check_violation';
  END IF;
  IF p_stock IS NULL OR p_stock < 0 THEN
    RAISE EXCEPTION 'negative_stock' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.product_variants
    (product_id, sku, barcode, label, price_cents, cost)
  VALUES
    (p_product_id, COALESCE(NULLIF(btrim(p_sku), ''), ''), NULLIF(btrim(p_barcode), ''),
     btrim(p_label), p_price_cents, p_cost)
  RETURNING id INTO v_variant_id;

  -- Los valores se validan contra la tabla relacional: una variante sin valores
  -- no es una combinacion valida de los atributos configurados.
  IF p_value_ids IS NULL OR array_length(p_value_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'variant_values_required' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH v_value IN ARRAY p_value_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE id = v_value) THEN
      RAISE EXCEPTION 'invalid_attribute_value' USING ERRCODE = 'foreign_key_violation';
    END IF;
    INSERT INTO public.product_variant_values (variant_id, value_id)
    VALUES (v_variant_id, v_value)
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.variant_stock
    (variant_id, tenant_id, stock, min_stock, max_stock, deposito, pasillo, estanteria, category_id)
  VALUES
    (v_variant_id, p_tenant_id, p_stock, COALESCE(p_min_stock, 0), COALESCE(p_max_stock, 0),
     p_deposito, p_pasillo, p_estanteria, p_category_id);

  PERFORM public.register_sellable_code(p_tenant_id, 'sku', p_sku, NULL, v_variant_id);
  PERFORM public.register_sellable_code(p_tenant_id, 'barcode', p_barcode, NULL, v_variant_id);

  IF p_stock > 0 THEN
    INSERT INTO public.stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
    VALUES (p_tenant_id, p_product_id, v_variant_id, p_stock, 'in', 'Alta de variante', p_by);
  END IF;

  SELECT to_jsonb(v) INTO v_row FROM public.product_variants v WHERE v.id = v_variant_id;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_variant(UUID, UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, UUID[], INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_variant(UUID, UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, UUID[], INTEGER, INTEGER, INTEGER, TEXT, TEXT, TEXT, UUID) TO service_role;

-- Edicion de una variante: no mueve stock (eso es adjust_variant_stock_atomic).
CREATE OR REPLACE FUNCTION public.update_product_variant(
  p_variant_id UUID,
  p_tenant_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_label TEXT,
  p_price_cents BIGINT,
  p_cost NUMERIC,
  p_active BOOLEAN,
  p_value_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_old_sku TEXT;
  v_old_barcode TEXT;
  v_value UUID;
  v_row JSONB;
BEGIN
  SELECT v.product_id, v.sku, v.barcode INTO v_product_id, v_old_sku, v_old_barcode
    FROM public.product_variants v
    JOIN public.variant_stock s ON s.variant_id = v.id
   WHERE v.id = p_variant_id AND s.tenant_id = p_tenant_id
   FOR UPDATE OF v;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_in_tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_label IS NULL OR btrim(p_label) = '' THEN
    RAISE EXCEPTION 'variant_label_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 0 THEN
    RAISE EXCEPTION 'invalid_variant_price' USING ERRCODE = 'check_violation';
  END IF;
  IF p_value_ids IS NULL OR array_length(p_value_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'variant_values_required' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.register_sellable_code(p_tenant_id, 'sku', p_sku, NULL, p_variant_id);
  PERFORM public.register_sellable_code(p_tenant_id, 'barcode', p_barcode, NULL, p_variant_id);

  UPDATE public.product_variants
     SET sku = COALESCE(NULLIF(btrim(p_sku), ''), ''),
         barcode = NULLIF(btrim(p_barcode), ''),
         label = btrim(p_label),
         price_cents = p_price_cents,
         cost = p_cost,
         updated_at = now()
   WHERE id = p_variant_id;

  -- `active` es por sucursal: dar de baja una variante en un tenant no puede
  -- borrarla ni desactivarla en otro. El historial queda intacto.
  UPDATE public.variant_stock
     SET active = COALESCE(p_active, true), updated_at = now()
   WHERE variant_id = p_variant_id AND tenant_id = p_tenant_id;

  DELETE FROM public.product_variant_values WHERE variant_id = p_variant_id;
  FOREACH v_value IN ARRAY p_value_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.product_attribute_values WHERE id = v_value) THEN
      RAISE EXCEPTION 'invalid_attribute_value' USING ERRCODE = 'foreign_key_violation';
    END IF;
    INSERT INTO public.product_variant_values (variant_id, value_id)
    VALUES (p_variant_id, v_value)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Los codigos que dejo de usar se liberan solo si nadie mas los reclama.
  DELETE FROM public.sellable_codes sc
   WHERE sc.variant_id = p_variant_id
     AND (
       (sc.kind = 'sku' AND COALESCE(NULLIF(btrim(p_sku), ''), '') <> sc.code)
       OR (sc.kind = 'barcode' AND NULLIF(btrim(p_barcode), '') IS DISTINCT FROM sc.code)
     );

  SELECT to_jsonb(v) INTO v_row FROM public.product_variants v WHERE v.id = p_variant_id;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_variant(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, BOOLEAN, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_variant(UUID, UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, BOOLEAN, UUID[]) TO service_role;

-- Ajuste atomico de stock de variante: chequeo dentro del UPDATE bajo lock de
-- fila, historial en la misma transaccion. Misma semantica que 049.
CREATE OR REPLACE FUNCTION public.adjust_variant_stock_atomic(
  p_variant_id UUID,
  p_tenant_id UUID,
  p_quantity INTEGER,
  p_reason TEXT,
  p_created_by UUID
)
RETURNS TABLE (ok BOOLEAN, old_stock INTEGER, new_stock INTEGER, error TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_after INTEGER;
BEGIN
  SELECT v.product_id INTO v_product_id
    FROM public.product_variants v WHERE v.id = p_variant_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, 'variant_not_found'::TEXT;
    RETURN;
  END IF;

  UPDATE public.variant_stock s
     SET stock = s.stock + p_quantity, updated_at = now()
   WHERE s.variant_id = p_variant_id
     AND s.tenant_id = p_tenant_id
     AND s.stock + p_quantity >= 0
  RETURNING stock INTO v_after;

  IF v_after IS NULL THEN
    RETURN QUERY SELECT false, NULL::INTEGER, NULL::INTEGER, 'insufficient_or_missing'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.stock_history (tenant_id, product_id, variant_id, quantity, type, reason, created_by)
  VALUES (p_tenant_id, v_product_id, p_variant_id, p_quantity, 'adjustment', p_reason, p_created_by);

  RETURN QUERY SELECT true, v_after - p_quantity, v_after, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_variant_stock_atomic(UUID, UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_variant_stock_atomic(UUID, UUID, INTEGER, TEXT, UUID) TO service_role;

-- Reportes: criticos por variante, sin cambiar get_critical_products (064).
CREATE OR REPLACE FUNCTION public.get_critical_variants(p_tenant_ids UUID[])
RETURNS TABLE (
  id UUID, product_id UUID, name TEXT, label TEXT, sku TEXT,
  stock INTEGER, min_stock INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.id, p.id, p.name, v.label, v.sku, s.stock, s.min_stock
    FROM public.variant_stock s
    JOIN public.product_variants v ON v.id = s.variant_id
    JOIN public.products p ON p.id = v.product_id
   WHERE s.tenant_id = ANY (p_tenant_ids)
     AND s.active AND s.stock <= s.min_stock
   ORDER BY (s.stock - s.min_stock) ASC, p.name ASC, v.label ASC;
$$;

REVOKE ALL ON FUNCTION public.get_critical_variants(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_critical_variants(UUID[]) TO service_role;
