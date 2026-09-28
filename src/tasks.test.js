import assert from 'node:assert/strict';
import test from 'node:test';
import { queueBatch } from './tasks.js';

test('one batch instruction queues every selected new image independently', () => {
  const tasks = [
    { id: 'a', turns: [] },
    { id: 'b', turns: [] },
    { id: 'old', turns: [{ status: 'done' }] },
  ];
  const queued = queueBatch(tasks, ['a', 'b', 'old'], '全部抠成白底图');
  assert.equal(queued[0].turns[0].instruction, '全部抠成白底图');
  assert.equal(queued[1].turns[0].instruction, '全部抠成白底图');
  assert.equal(queued[0].turns[0].status, 'queued');
  assert.notEqual(queued[0].turns[0].id, queued[1].turns[0].id);
  assert.equal(queued[2], tasks[2]);
});
