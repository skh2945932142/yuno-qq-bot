import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildAuditPayload,
  collectAdvisories,
  runSecurityAudit,
} from './scripts/security-audit.js';

test('buildAuditPayload includes runtime and development packages', () => {
  const payload = buildAuditPayload({
    packages: {
      '': { name: 'root', version: '1.0.0' },
      'node_modules/axios': { version: '1.18.1' },
      'node_modules/a/node_modules/axios': { version: '1.18.1' },
      'node_modules/@scope/runtime': { version: '2.0.0' },
      'node_modules/dev-only': { version: '3.0.0', dev: true },
    },
  });

  assert.deepEqual(payload, {
    axios: ['1.18.1'],
    '@scope/runtime': ['2.0.0'],
    'dev-only': ['3.0.0'],
  });
});

test('collectAdvisories normalizes and deduplicates bulk advisory results', () => {
  const advisories = collectAdvisories({
    axios: [
      { id: 1, severity: 'high', title: 'first', url: 'https://example.test/1', vulnerable_versions: '<1.18.2' },
      { id: 1, severity: 'high', title: 'duplicate', url: 'https://example.test/1', vulnerable_versions: '<1.18.2' },
    ],
  }, { axios: ['1.18.1'] });

  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].source, '1');
  assert.equal(advisories[0].name, 'axios');
});

test('runSecurityAudit separates approved and unapproved advisories', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'yuno-security-audit-'));
  const allowlistPath = path.join(directory, 'allowlist.json');
  const lockfilePath = path.join(directory, 'package-lock.json');
  try {
    await writeFile(allowlistPath, JSON.stringify({
      expiresOn: '2099-12-31',
      entries: [{ source: '1', expiresOn: '2099-12-31' }],
    }));
    await writeFile(lockfilePath, JSON.stringify({
      packages: { 'node_modules/runtime': { version: '1.0.0' } },
    }));

    const result = await runSecurityAudit({
      allowlistPath,
      lockfilePath,
      requestAdvisories: async () => ({
        runtime: [
          { id: 1, severity: 'moderate', url: 'https://example.test/1', vulnerable_versions: '<=1.0.0' },
          { id: 2, severity: 'high', url: 'https://example.test/2', vulnerable_versions: '<=1.0.0' },
          { id: 3, severity: 'high', url: 'https://example.test/3', vulnerable_versions: '>1.0.0' },
        ],
      }),
    });

    assert.equal(result.advisories.length, 2);
    assert.equal(result.unapproved.length, 1);
    assert.equal(result.unapproved[0].source, '2');
    assert.equal(result.expired.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

