import { NextResponse } from 'next/server';
import { completeOnboarding } from '@/lib/onboarding-service';
import { isSameOriginRequest } from '@/lib/security/csrf';

export async function POST(request: Request) {
  // `completeOnboarding` autentica por su cuenta (soporta token Bearer para el
  // flujo móvil), pero al no pasar por `getAuth` era el único POST sin la
  // comprobación de Origin.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const result = await completeOnboarding(request, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
