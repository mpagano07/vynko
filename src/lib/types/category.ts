export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
}
