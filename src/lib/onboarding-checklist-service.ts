import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { AuthInfo } from '@/lib/api-auth';

type Result = { ok: true; dismissed: boolean } | { ok: false; error: string };

/**
 * Guarda (o limpia) la preferencia de ocultar el checklist "Primeros pasos".
 *
 * Va contra `profiles` con service_role y no con el cliente del navegador: en
 * este repo toda escritura a `profiles` pasa por el servidor. Que el update este
 * acotado a `.eq('id', auth.userId)` es lo que impide que un usuario le cambie
 * la preferencia a otro.
 */
export async function setChecklistDismissed(auth: AuthInfo, dismissed: boolean): Promise<Result> {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ onboarding_checklist_dismissed_at: dismissed ? new Date().toISOString() : null })
    .eq('id', auth.userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, dismissed };
}