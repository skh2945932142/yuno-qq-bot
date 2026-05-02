import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const patterns = [
  { name: 'private-key', regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: 'openai-style-key', regex: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'mongodb-uri-with-password', regex: /mongodb(?:\+srv)?:\/\/[^/\s:@]+:[^@\s]+@/i },
];

const ignoredPaths = new Set([
  '.env',
  'package-lock.json',
  'deploy/astrbot/.env',
]);

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'deploy/astrbot/data',
]);

function collectFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (ignoredPaths.has(relativePath)) continue;
    if (entry.isDirectory()) {
      if (ignoredDirs.has(relativePath) || ignoredDirs.has(entry.name)) continue;
      files.push(...collectFiles(path.join(dir, entry.name), relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

const findings = [];
for (const relativePath of collectFiles(rootDir)) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (ignoredPaths.has(normalizedPath)) continue;

  const absolutePath = path.join(rootDir, relativePath);
  if (statSync(absolutePath).size > 1024 * 1024) continue;

  let content;
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      findings.push({ path: normalizedPath, pattern: pattern.name });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`Potential secret: ${finding.path} (${finding.pattern})`);
  }
  process.exit(1);
}

console.log('Secret scan passed for repository files.');
