import { NextResponse } from 'next/server';
import { sendResetPasswordEmail } from '@/lib/auth-service';
import { isSameOriginRequest } from '@/lib/security/csrf';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  // Sin sesion por definicion, pero un POST cross-site позволяет disparar
  // emails de reset a una victima (email bombing) desde otra web.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  try {
    const result = await sendResetPasswordEmail(request);
    return NextResponse.json(result.data, { status: result.status, headers: result.headers });
  } catch (err) {
    logger.error('Error in POST /api/auth/forgot-password:', { error: err });
    return NextResponse.json({ success: true, message: 'Email enviado' });
  }
}
