export function makeTurn(instruction) {
  return { id: crypto.randomUUID(), instruction, status: 'queued', stage: '', createdAt: Date.now(),
    startedAt: null, finishedAt: null, error: '', outputs: [] };
}

export function queueBatch(tasks, taskIds, instruction) {
  const ids = new Set(taskIds);
  return tasks.map((task) => ids.has(task.id) && !task.turns.length
    ? { ...task, turns: [makeTurn(instruction)] } : task);
}
