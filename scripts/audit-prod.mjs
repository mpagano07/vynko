#!/usr/bin/env node

/**
 * Runs npm audit and filters out known false positives/exceptions that don't
 * affect production runtime (with documented justification).
 *
 * Exceptions:
 * - GHSA-86w9-cpqp-85rv (node-forge 1.4.0): affects RSA PKCS#1 v1.5 signature
 *   verification (CWE-347). We only use node-forge to generate and sign
 *   WSAA TRA (PKCS#7/CMS) - never for verification - so this vector is not
 *   exploitable in our code (see src/lib/arca/client.ts createSignedLoginTicket).
 *   No patched version available.
 */
const { execSync } = await import('node:child_process');

const EXCLUDED_ADVISORIES = new Set(['GHSA-86w9-cpqp-85rv', '1240912']);

function main() {
  try {
    const raw = execSync('npm audit --json --omit=dev', {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    });
    const audit = JSON.parse(raw);
    const vulns = audit.vulnerabilities || {};
    let hasUnexcluded = false;

    for (const [pkg, info] of Object.entries(vulns)) {
      const via = info.via || [];
      for (let i = 0; i < via.length; i++) {
        const v = via[i];
        const advId = String(v.source);
        if (EXCLUDED_ADVISORIES.has(advId)) {
          continue;
        }
        hasUnexcluded = true;
        console.error(`Unexcluded high/critical vuln in ${pkg}:`, v);
      }
    }

    if (hasUnexcluded) {
      console.error('\nProduction audit found unexcluded vulnerabilities.');
      process.exit(1);
    }

    console.log('Production audit passed (known non-exploitable exceptions filtered).');
    process.exit(0);
  } catch (err) {
    const error = err || {};
    if (error.status === 1) {
      try {
        const raw = error.stdout && error.stdout.toString ? error.stdout.toString() : '';
        if (raw) {
          const audit = JSON.parse(raw);
          const vulns = audit.vulnerabilities || {};
          let hasUnexcluded = false;
          for (const [pkg, info] of Object.entries(vulns)) {
            const via = info.via || [];
            for (let i = 0; i < via.length; i++) {
              const v = via[i];
              const advId = String(v.source);
              if (EXCLUDED_ADVISORIES.has(advId)) continue;
              hasUnexcluded = true;
            }
          }
          if (!hasUnexcluded) {
            console.log('Production audit passed (known non-exploitable exceptions filtered).');
            process.exit(0);
          }
        }
      } catch (e) {
        // fall through
      }
    }
    console.error('Audit check failed:', error.message);
    process.exit(1);
  }
}

main();
