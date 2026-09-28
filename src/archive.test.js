import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { addTaskToZip, addWhiteBatchToZip } from './archive.js';

test('archive contains the source, every round output, and the conversation', async () => {
  const task = {
    id: 'abcdef12', name: 'bike.png', createdAt: 1,
    source: { name: 'bike.png', dataUrl: 'data:image/png;base64,YQ==' },
    turns: [
      { instruction: '抠出自行车', status: 'done', createdAt: 2, finishedAt: 3, error: '', outputs: [
        { dataUrl: 'data:image/png;base64,Yg==', extension: 'png', kind: 'cutout' },
        { dataUrl: 'data:image/png;base64,Yw==', extension: 'png', kind: 'white' },
      ] },
      { instruction: '修正车轮', status: 'done', createdAt: 4, finishedAt: 5, error: '', outputs: [
        { dataUrl: 'data:image/png;base64,ZA==', extension: 'png', kind: 'cutout' },
      ] },
    ],
  };
  const zip = new JSZip();
  addTaskToZip(zip, task);
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  const names = Object.keys(archive.files);
  for (const file of ['original-bike.png', 'round-1-1-cutout.png', 'round-1-2-white.png', 'round-2-1-cutout.png', 'conversation.json']) {
    assert.ok(names.includes(`bike-abcdef/${file}`));
  }
  const conversation = JSON.parse(await archive.file('bike-abcdef/conversation.json').async('string'));
  assert.deepEqual(conversation.rounds.map((round) => round.instruction), ['抠出自行车', '修正车轮']);
});

test('white batch archive includes only the latest white result for each image', async () => {
  const zip = new JSZip();
  const tasks = [{ id: 'abcdef12', name: 'bike.png', turns: [
    { status: 'done', outputs: [{ kind: 'white', dataUrl: 'data:image/png;base64,YQ==' }] },
    { status: 'done', outputs: [{ kind: 'cutout', dataUrl: 'data:image/png;base64,Yg==' }, { kind: 'white', dataUrl: 'data:image/png;base64,Yw==' }] },
  ] }];
  assert.equal(addWhiteBatchToZip(zip, tasks), 1);
  const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(Object.keys(archive.files), ['bike-abcdef-white.png']);
  assert.equal(await archive.file('bike-abcdef-white.png').async('string'), 'c');
});
