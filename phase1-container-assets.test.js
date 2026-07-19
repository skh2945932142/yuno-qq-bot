import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('docker build context includes reply style examples without shipping all runtime data', async () => {
  const lines = (await readFile('.dockerignore', 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.equal(lines.includes('data'), false);
  assert.equal(lines.includes('data/*'), true);
  assert.equal(lines.includes('!data/reply-style/'), true);
  assert.equal(lines.includes('!data/reply-style/examples.jsonl'), true);
});
