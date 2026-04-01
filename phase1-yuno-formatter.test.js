import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResultAsYuno, normalizeFormatterOutputs } from './src/yuno-formatter.js';

test('formatter renders meme results and preserves image output', () => {
  const toolResult = {
    tool: 'meme_retrieve',
    payload: {
      action: 'send-existing',
      image: { file: 'data:image/png;base64,AAA' },
    },
    summary: '',
  };

  const text = formatToolResultAsYuno(toolResult, { specialUser: null });
  const outputs = normalizeFormatterOutputs(toolResult, text);

  assert.match(text, /这|梗图|合适/);
  assert.equal(outputs.length, 2);
  assert.equal(outputs[1].type, 'image');
});
