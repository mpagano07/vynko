import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './route';
import { getReleaseToken } from '@/lib/release-version';

const originalSha = process.env.VERCEL_GIT_COMMIT_SHA;
const originalPublicSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (originalSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalSha;
  if (originalPublicSha === undefined) delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  else process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = originalPublicSha;
});

describe('GET /api/version', () => {
  it('devuelve un token opaco en vez del commit SHA', async () => {
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890abcdef1234567890abcdef12';

    const res = await GET();
    const body = (await res.json()) as { version: string };

    expect(res.status).toBe(200);
    expect(body.version).toBe(getReleaseToken('abcdef1234567890abcdef1234567890abcdef12'));
    expect(body.version).not.toContain('abcdef1234567890');
    expect(body.version).toHaveLength(16);
  });

  it('mantiene "dev" fuera de producción', async () => {
    delete process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.SOURCE_VERSION;

    const res = await GET();
    const body = (await res.json()) as { version: string };

    expect(body.version).toBe('dev');
  });
});
