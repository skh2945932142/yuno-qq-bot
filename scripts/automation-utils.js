import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'deploy/astrbot/data',
  'reports',
]);

export function isCliEntrypoint(importMetaUrl) {
  return process.argv[1] && importMetaUrl === pathToFileURL(process.argv[1]).href;
}

export function collectRepoFiles(dir = rootDir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const normalizedPath = relativePath.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(normalizedPath) || SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectRepoFiles(path.join(dir, entry.name), normalizedPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(normalizedPath);
    }
  }
  return files;
}

export function readTextFile(relativePath, fallback = '') {
  try {
    const absolutePath = path.join(rootDir, relativePath);
    if (statSync(absolutePath).size > 1024 * 1024) return fallback;
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function readJsonFile(relativePath, fallback = null) {
  try {
    return JSON.parse(readTextFile(relativePath));
  } catch {
    return fallback;
  }
}

export function countMatches(files, pattern) {
  let count = 0;
  for (const file of files) {
    const text = readTextFile(file);
    count += [...text.matchAll(pattern)].length;
  }
  return count;
}

export function writeReport(relativePath, content) {
  const absolutePath = path.resolve(rootDir, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
  return absolutePath;
}

export function parseWriteArg(argv = process.argv.slice(2)) {
  const writeIndex = argv.indexOf('--write');
  if (writeIndex >= 0) {
    return argv[writeIndex + 1] || '';
  }
  return '';
}
