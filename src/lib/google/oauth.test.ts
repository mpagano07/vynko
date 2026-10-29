import { describe, expect, it } from 'vitest';
import { GOOGLE_DRIVE_SCOPE, hasDriveFileScope } from './oauth';

describe('google drive oauth scope', () => {
  it('pide sólo el scope no sensible drive.file', () => {
    expect(GOOGLE_DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(GOOGLE_DRIVE_SCOPE).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(GOOGLE_DRIVE_SCOPE).not.toContain('openid');
    expect(GOOGLE_DRIVE_SCOPE).not.toContain('email');
    expect(GOOGLE_DRIVE_SCOPE).not.toContain('profile');
    expect(GOOGLE_DRIVE_SCOPE).not.toMatch(/auth\/drive(?:\s|$)/);
  });

  it('detecta si Google concedió drive.file entre varios scopes', () => {
    expect(hasDriveFileScope('https://www.googleapis.com/auth/drive.file')).toBe(true);
    expect(
      hasDriveFileScope(
        'openid email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email'
      )
    ).toBe(true);
    expect(hasDriveFileScope('openid email profile')).toBe(false);
    expect(hasDriveFileScope(null)).toBe(false);
  });
});
