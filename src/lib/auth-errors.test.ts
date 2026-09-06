import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '@/lib/auth-errors';

describe('authErrorMessage', () => {
  it('traduce email_not_confirmed por código', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' }))
      .toContain('confirmás tu email');
  });

  it('traduce por mensaje cuando no hay código', () => {
    expect(authErrorMessage({ message: 'Email not confirmed' })).toContain('confirmás tu email');
  });

  it('traduce invalid_credentials', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }))
      .toBe('Email o contraseña incorrectos');
  });

  it('traduce user_already_exists', () => {
    expect(authErrorMessage({ code: 'user_already_exists', message: 'User already registered' }))
      .toContain('ya está registrado');
  });

  it('traduce weak_password', () => {
    expect(authErrorMessage({ code: 'weak_password', message: 'Password should be at least 6 characters' }))
      .toContain('6 caracteres');
  });

  it('traduce errores de red', () => {
    expect(authErrorMessage({ message: 'Failed to fetch' })).toContain('Error de conexión');
    expect(authErrorMessage({ message: 'TypeError: NetworkError when attempting to fetch resource.' }))
      .toContain('Error de conexión');
  });

  it('traduce el cierre del popup de Google', () => {
    expect(authErrorMessage({ message: 'Popup closed by user' })).toContain('Cancelaste');
  });

  it('preserva mensajes que ya están en español', () => {
    expect(authErrorMessage({ message: 'Error al enviar email' })).toBe('Error al enviar email');
  });

  it('usa un fallback genérico en español cuando no hay mensaje', () => {
    expect(authErrorMessage({ code: 'some_unknown_code', message: '' })).toContain('error');
    expect(authErrorMessage(null)).toContain('error');
  });
});