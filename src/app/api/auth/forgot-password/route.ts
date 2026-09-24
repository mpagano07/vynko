import { NextResponse } from 'next/server';
import { sendResetPasswordEmail } from '@/lib/auth-service';

export async function POST(request: Request) {
  try {
    const result = await sendResetPasswordEmail(request);
    return NextResponse.json(result.data, { status: result.status, headers: result.headers });
  } catch (err) {
    console.error('Error in POST /api/auth/forgot-password:', err);
    return NextResponse.json({ success: true, message: 'Email enviado' });
  }
}