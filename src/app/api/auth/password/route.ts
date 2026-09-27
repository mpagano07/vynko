import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { authErrorMessage } from '@/lib/auth-errors';

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 200;

/**
 * Cambio de contrasena y verificacion de identidad.
 *
 * Antes estas dos operaciones vivian en el navegador con
 * `supabase.auth.updateUser()` y `supabase.auth.signInWithPassword()`. Con la
 * cookie de sesion HttpOnly el cliente ya no puede llamarlas, asi que se
 * validan y ejecutan aca, en el servidor.
 *
 * `verify` existe para los flujos que piden la contrasena actual antes de dejar
 * cambiar algo sensible. Supabase no expone un endpoint "comprobar contrasena",
 * asi que se resuelve con `signInWithPassword`, que ademas devuelve un error de
 * credenciales invalidas ante un email inexistente: no revela si el email esta
 * registrado. Requiere CSRF porque opera sobre la sesion del usuario.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let body: { action?: unknown; currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body?.action;
  if (action !== 'change' && action !== 'verify') {
    return NextResponse.json({ error: 'Accion invalida' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user?.email) {
    return NextResponse.json({ error: 'Sesion no valida' }, { status: 401 });
  }

  if (action === 'change') {
    const newPassword = body?.newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` },
        { status: 400 }
      );
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: 'Contrasena demasiado larga' }, { status: 400 });
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return NextResponse.json({ error: authErrorMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  const currentPassword = body?.currentPassword;
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: 'Contrasena actual invalida' }, { status: 400 });
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (error) {
    // No se distingue "contrasena incorrecta" de "usuario inexistente" a
    // proposito: responder distinto permitiria enumerar cuentas registradas.
    return NextResponse.json({ error: 'La contrasena actual es incorrecta' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
