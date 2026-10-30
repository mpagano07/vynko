import { beforeEach, describe, expect, it } from 'vitest';
import { clearDriveIntent, rememberDriveIntent, takeDriveIntent } from './drive-intent';

const KEY = 'vynko:drive-intent';

describe('drive-intent', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('guarda y devuelve el export pendiente una sola vez', () => {
    rememberDriveIntent({ kind: 'export', platform: 'tiendanube', format: 'csv' });

    expect(takeDriveIntent()).toEqual({
      kind: 'export',
      platform: 'tiendanube',
      format: 'csv',
    });
    // Se consume: un segundo intento no debe reanudar nada.
    expect(takeDriveIntent()).toBeNull();
  });

  it('guarda el import pendiente', () => {
    rememberDriveIntent({ kind: 'import' });
    expect(takeDriveIntent()).toEqual({ kind: 'import' });
  });

  it('descarta intenciones vencidas', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({
        kind: 'export',
        platform: 'generico',
        format: 'xls',
        savedAt: Date.now() - 11 * 60 * 1000,
      })
    );

    expect(takeDriveIntent()).toBeNull();
  });

  it('descarta payloads inválidos', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ kind: 'export', platform: 'otra', format: 'pdf', savedAt: Date.now() })
    );

    expect(takeDriveIntent()).toBeNull();
  });

  it('clearDriveIntent borra lo pendiente', () => {
    rememberDriveIntent({ kind: 'import' });
    clearDriveIntent();
    expect(takeDriveIntent()).toBeNull();
  });
});
