-- ========================================
-- Commercial Documents Module
-- Replaces electronic invoices with:
-- - Remitos de salida/ingreso
-- - Presupuestos
-- - Órdenes de compra/venta
-- ========================================

-- Main documents table
CREATE TABLE IF NOT EXISTS commercial_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL
    CHECK (document_type IN ('remito_salida', 'remito_ingreso', 'presupuesto', 'orden_compra', 'orden_venta')),
  document_number INT NOT NULL,
  sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  supplier_name TEXT,
  notes TEXT,
  total_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  valid_until DATE,
  delivery_date DATE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, document_type, document_number)
);

-- Document items table
CREATE TABLE IF NOT EXISTS commercial_document_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES commercial_documents(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Document number sequences per tenant and document type
CREATE TABLE IF NOT EXISTS commercial_document_sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  next_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, document_type)
);

-- ========================================
-- RLS POLICIES
-- ========================================
ALTER TABLE commercial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_document_sequences ENABLE ROW LEVEL SECURITY;

-- Commercial documents access policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_documents'
    AND policyname = 'Users can view their tenant documents'
  ) THEN
    CREATE POLICY "Users can view their tenant documents" ON commercial_documents
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_documents'
    AND policyname = 'Users can insert documents in their tenant'
  ) THEN
    CREATE POLICY "Users can insert documents in their tenant" ON commercial_documents
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_documents'
    AND policyname = 'Users can update documents in their tenant'
  ) THEN
    CREATE POLICY "Users can update documents in their tenant" ON commercial_documents
      FOR UPDATE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_documents'
    AND policyname = 'Users can delete documents in their tenant'
  ) THEN
    CREATE POLICY "Users can delete documents in their tenant" ON commercial_documents
      FOR DELETE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- Document items access policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_items'
    AND policyname = 'Users can view their tenant document items'
  ) THEN
    CREATE POLICY "Users can view their tenant document items" ON commercial_document_items
      FOR SELECT USING (
        document_id IN (SELECT id FROM commercial_documents WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_items'
    AND policyname = 'Users can insert document items in their tenant'
  ) THEN
    CREATE POLICY "Users can insert document items in their tenant" ON commercial_document_items
      FOR INSERT WITH CHECK (
        document_id IN (SELECT id FROM commercial_documents WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_items'
    AND policyname = 'Users can delete document items in their tenant'
  ) THEN
    CREATE POLICY "Users can delete document items in their tenant" ON commercial_document_items
      FOR DELETE USING (
        document_id IN (SELECT id FROM commercial_documents WHERE tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()))
      );
  END IF;
END $$;

-- Document sequences access policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_sequences'
    AND policyname = 'Users can view their tenant document sequences'
  ) THEN
    CREATE POLICY "Users can view their tenant document sequences" ON commercial_document_sequences
      FOR SELECT USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_sequences'
    AND policyname = 'Users can insert document sequences in their tenant'
  ) THEN
    CREATE POLICY "Users can insert document sequences in their tenant" ON commercial_document_sequences
      FOR INSERT WITH CHECK (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'commercial_document_sequences'
    AND policyname = 'Users can update document sequences in their tenant'
  ) THEN
    CREATE POLICY "Users can update document sequences in their tenant" ON commercial_document_sequences
      FOR UPDATE USING (
        tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX IF NOT EXISTS idx_commercial_documents_tenant_id ON commercial_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_type ON commercial_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_sale_id ON commercial_documents(sale_id);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_customer_id ON commercial_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_status ON commercial_documents(status);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_created_at ON commercial_documents(created_at);
CREATE INDEX IF NOT EXISTS idx_commercial_document_items_document_id ON commercial_document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_commercial_document_sequences_tenant_id ON commercial_document_sequences(tenant_id);
