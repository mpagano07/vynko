export interface Notification {
  id: string;
  tenant_id: string;
  user_id?: string;
  type: 'stock_critical' | 'stock_low' | 'po_received' | 'po_cancelled' | 'collaborator_joined' | 'invitation_accepted' | 'system';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  created_at: string;
}
