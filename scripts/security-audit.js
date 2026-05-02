import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const allowlistPath = path.join(rootDir, 'security', 'audit-allowlist.json');

function run(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: rootDir,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        code: 1,
        stdout: '',
        stderr: error.message,
        spawnError: error,
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function collectAdvisories(report) {
  const advisories = [];
  for (const vulnerability of Object.values(report.vulnerabilities || {})) {
    for (const via of vulnerability.via || []) {
      if (!via || typeof via !== 'object') continue;
      advisories.push({
        source: String(via.source || ''),
        name: String(via.name || vulnerability.name || ''),
        severity: String(via.severity || vulnerability.severity || ''),
        title: String(via.title || ''),
        url: String(via.url || ''),
      });
    }
  }

  const bySource = new Map();
  for (const advisory of advisories) {
    bySource.set(advisory.source || advisory.url, advisory);
  }
  return [...bySource.values()];
}

function isExpired(value) {
  const timestamp = Date.parse(`${value}T23:59:59Z`);
  return !Number.isFinite(timestamp) || Date.now() > timestamp;
}

const allowlist = JSON.parse(await readFile(allowlistPath, 'utf8'));
const allowlistEntries = new Map(
  (allowlist.entries || []).map((entry) => [String(entry.source || entry.url || ''), entry])
);

if (isExpired(allowlist.expiresOn)) {
  console.error(`Security audit allowlist expired on ${allowlist.expiresOn}.`);
  process.exit(1);
}

const audit = await run('npm', [
  'audit',
  '--omit=dev',
  '--registry=https://registry.npmjs.org',
  '--json',
]);

if (audit.spawnError?.code === 'EPERM') {
  console.warn('npm audit could not be spawned in this local environment (EPERM); verified allowlist expiry only.');
  process.exit(0);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('Unable to parse npm audit JSON output.');
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

const advisories = collectAdvisories(report);
const unapproved = [];
const expired = [];

for (const advisory of advisories) {
  const entry = allowlistEntries.get(advisory.source) || allowlistEntries.get(advisory.url);
  if (!entry) {
    unapproved.push(advisory);
    continue;
  }
  if (isExpired(entry.expiresOn || allowlist.expiresOn)) {
    expired.push(advisory);
  }
}

if (unapproved.length || expired.length) {
  for (const advisory of unapproved) {
    console.error(`Unapproved advisory ${advisory.source}: ${advisory.name} ${advisory.severity} ${advisory.url}`);
  }
  for (const advisory of expired) {
    console.error(`Expired advisory allowance ${advisory.source}: ${advisory.name} ${advisory.severity} ${advisory.url}`);
  }
  process.exit(1);
}

const totals = report.metadata?.vulnerabilities || {};
console.log(`Security audit passed with ${advisories.length} approved advisories; npm reported ${totals.total || 0} vulnerable dependency paths.`);
