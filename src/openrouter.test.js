import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, generateCutout } from './openrouter.js';

test('cutout prompt targets a transparent foreground and keeps the current request', () => {
  const prompt = buildPrompt('只保留自行车', ['抠出主要主体']);
  assert.match(prompt, /只保留自行车/);
  assert.match(prompt, /Layer 1.*RGBA cutout/);
  assert.match(prompt, /alpha=0/);
  assert.match(prompt, /Layer 2.*background/);
});

test('image request sends one selected reference and preserves every returned image', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let request;
  globalThis.window = { location: { origin: 'http://localhost:5173' } };
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify({ data: [
      { b64_json: 'AAAA', media_type: 'image/png' },
      { b64_json: 'BBBB', media_type: 'image/webp' },
    ] }) };
  };
  try {
    const images = await generateCutout({ apiKey: 'test-key', reference: 'data:image/png;base64,CCCC', instruction: '只保留自行车' });
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://openrouter.ai/api/v1/images');
    assert.equal(body.input_references.length, 1);
    assert.equal(body.input_references[0].image_url.url, 'data:image/png;base64,CCCC');
    assert.equal(body.output_format, 'png');
    assert.deepEqual(images.map((image) => image.extension), ['png', 'webp']);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
