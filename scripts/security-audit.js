import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { satisfies } from 'semver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const allowlistPath = path.join(rootDir, 'security', 'audit-allowlist.json');
const lockfilePath = path.join(rootDir, 'package-lock.json');
const auditEndpoint = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

function packageNameFromLocation(location, entry = {}) {
  if (entry.name) return String(entry.name);
  const marker = 'node_modules/';
  const index = String(location || '').lastIndexOf(marker);
  return index >= 0 ? String(location).slice(index + marker.length) : '';
}

export function buildAuditPayload(lockfile = {}) {
  const payload = {};
  for (const [location, entry] of Object.entries(lockfile.packages || {})) {
    if (!location || !entry.version) continue;
    const name = packageNameFromLocation(location, entry);
    if (!name) continue;
    if (!payload[name]) payload[name] = [];
    payload[name].push(String(entry.version));
  }
  for (const name of Object.keys(payload)) {
    payload[name] = [...new Set(payload[name])];
  }
  return payload;
}

function decodeResponseBody(buffer, contentEncoding = '') {
  const encoding = String(contentEncoding || '').toLowerCase();
  if (encoding.includes('gzip') || (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    return gunzipSync(buffer);
  }
  if (encoding.includes('br')) return brotliDecompressSync(buffer);
  if (encoding.includes('deflate')) return inflateSync(buffer);
  return buffer;
}

export function collectAdvisories(report = {}, payload = {}) {
  const advisories = [];
  for (const [name, entries] of Object.entries(report || {})) {
    for (const entry of entries || []) {
      const versions = payload[name] || [];
      const vulnerableRange = String(entry.vulnerable_versions || entry.range || '*');
      if (!versions.some((version) => satisfies(version, vulnerableRange, {
        includePrerelease: true,
        loose: true,
      }))) continue;
      advisories.push({
        source: String(entry.id || entry.source || ''),
        name: String(name || entry.name || ''),
        severity: String(entry.severity || ''),
        title: String(entry.title || ''),
        url: String(entry.url || ''),
      });
    }
  }
  const bySource = new Map();
  for (const advisory of advisories) {
    bySource.set(advisory.source || advisory.url, advisory);
  }
  return [...bySource.values()];
}

export function requestBulkAdvisories(payload, options = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const endpoint = options.endpoint || auditEndpoint;
  const requestImpl = options.request || request;
  return new Promise((resolve, reject) => {
    const req = requestImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'identity',
        'content-length': body.length,
        'content-type': 'application/json',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const raw = decodeResponseBody(Buffer.concat(chunks), res.headers['content-encoding']);
          const text = raw.toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`npm advisory endpoint returned HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
          }
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function isExpired(value) {
  const timestamp = Date.parse(`${value}T23:59:59Z`);
  return !Number.isFinite(timestamp) || Date.now() > timestamp;
}

export async function runSecurityAudit(options = {}) {
  const [allowlistText, lockfileText] = await Promise.all([
    readFile(options.allowlistPath || allowlistPath, 'utf8'),
    readFile(options.lockfilePath || lockfilePath, 'utf8'),
  ]);
  const allowlist = JSON.parse(allowlistText);
  const lockfile = JSON.parse(lockfileText);
  if (isExpired(allowlist.expiresOn)) {
    throw new Error(`Security audit allowlist expired on ${allowlist.expiresOn}.`);
  }

  const payload = buildAuditPayload(lockfile);
  const report = await (options.requestAdvisories || requestBulkAdvisories)(payload);
  const advisories = collectAdvisories(report, payload);
  const allowlistEntries = new Map(
    (allowlist.entries || []).map((entry) => [String(entry.source || entry.url || ''), entry]),
  );
  const unapproved = [];
  const expired = [];
  for (const advisory of advisories) {
    const entry = allowlistEntries.get(advisory.source) || allowlistEntries.get(advisory.url);
    if (!entry) {
      unapproved.push(advisory);
    } else if (isExpired(entry.expiresOn || allowlist.expiresOn)) {
      expired.push(advisory);
    }
  }
  return { advisories, unapproved, expired };
}

async function main() {
  const result = await runSecurityAudit();
  for (const advisory of result.unapproved) {
    console.error(`Unapproved advisory ${advisory.source}: ${advisory.name} ${advisory.severity} ${advisory.url}`);
  }
  for (const advisory of result.expired) {
    console.error(`Expired advisory allowance ${advisory.source}: ${advisory.name} ${advisory.severity} ${advisory.url}`);
  }
  if (result.unapproved.length || result.expired.length) process.exit(1);
  console.log(`Security audit passed with ${result.advisories.length} approved advisories.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
