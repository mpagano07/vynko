-- ========================================
-- AFIP Electronic Invoicing Module
-- ========================================

-- Add AFIP fields to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS iva_condition TEXT DEFAULT 'consumidor_final'
  CHECK (iva_condition IN ('responsable_inscripto', 'monotributista', 'consumidor_final', 'sujeto_exento', 'responsable_no_inscripto'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_category TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'DNI'
  CHECK (document_type IN ('DNI', 'CUIL', 'CUIT', 'Pasaporte', 'CE'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS document_number TEXT;

-- Add AFIP config to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cuit TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS punto_venta INT DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS iva_condition TEXT DEFAULT 'responsable_inscripto'
  CHECK (iva_condition IN ('responsable_inscripto', 'monotributista', 'consumidor_final', 'sujeto_exento', 'responsable_no_inscripto'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ingresos_brutos TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS inicio_actividades DATE;

-- Electronic invoices table
CREATE TABLE IF NOT EXISTS electronic_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  invoice_number INT NOT NULL,
  punto_venta INT NOT NULL DEFAULT 1,
  invoice_type TEXT NOT NULL DEFAULT 'B'
    CHECK (invoice_type IN ('A', 'B', 'C', 'NC_A', 'NC_B', 'NC_C', 'ND_A', 'ND_B', 'ND_C')),
  cuit_emisor TEXT NOT NULL,
  cuit_receptor TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'DNI',
  document_number TEXT,
  iva_condition TEXT NOT NULL DEFAULT 'consumidor_final',
  total_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  iva_cents BIGINT NOT NULL DEFAULT 0,
  iva_percentage DECIMAL(5,2) DEFAULT 21.00,
  other_taxes_cents BIGINT DEFAULT 0,
  cae TEXT,
  cae_due_date TEXT,
  afip_result TEXT,
  afip_response JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, punto_venta, invoice_number)
);

-- Invoice items table
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES electronic_invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  iva_percentage DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  iva_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Invoice number sequence per tenant, punto de venta and invoice type
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  punto_venta INT NOT NULL DEFAULT 1,
  invoice_type TEXT NOT NULL DEFAULT 'B',
  next_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, punto_venta, invoice_type)
);

-- ========================================
-- RLS POLICIES
-- ========================================
ALTER TABLE electronic_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;

-- Electronic invoices access policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electronic_invoices'
    AND policyname = 'Users can view their tenant electronic invoices'
  ) THEN
    CREATE POLICY "Users can view their tenant electronic invoices" ON electronic_invoices
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electronic_invoices'
    AND policyname = 'Users can insert electronic invoices in their tenant'
  ) THEN
    CREATE POLICY "Users can insert electronic invoices in their tenant" ON electronic_invoices
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'electronic_invoices'
    AND policyname = 'Users can update electronic invoices in their tenant'
  ) THEN
    CREATE POLICY "Users can update electronic invoices in their tenant" ON electronic_invoices
      FOR UPDATE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- Invoice items access policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_items'
    AND policyname = 'Users can view their tenant invoice items'
  ) THEN
    CREATE POLICY "Users can view their tenant invoice items" ON invoice_items
      FOR SELECT USING (
        invoice_id IN (SELECT id FROM electronic_invoices WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_items'
    AND policyname = 'Users can insert invoice items in their tenant'
  ) THEN
    CREATE POLICY "Users can insert invoice items in their tenant" ON invoice_items
      FOR INSERT WITH CHECK (
        invoice_id IN (SELECT id FROM electronic_invoices WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;

-- Invoice sequences access policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_sequences'
    AND policyname = 'Users can view their tenant invoice sequences'
  ) THEN
    CREATE POLICY "Users can view their tenant invoice sequences" ON invoice_sequences
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_sequences'
    AND policyname = 'Users can insert invoice sequences in their tenant'
  ) THEN
    CREATE POLICY "Users can insert invoice sequences in their tenant" ON invoice_sequences
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_sequences'
    AND policyname = 'Users can update invoice sequences in their tenant'
  ) THEN
    CREATE POLICY "Users can update invoice sequences in their tenant" ON invoice_sequences
      FOR UPDATE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_tenant_id ON electronic_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_sale_id ON electronic_invoices(sale_id);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_customer_id ON electronic_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_status ON electronic_invoices(status);
CREATE INDEX IF NOT EXISTS idx_electronic_invoices_created_at ON electronic_invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sequences_tenant_id ON invoice_sequences(tenant_id);
