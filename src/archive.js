export function addTaskToZip(zip, task) {
  const safeName = task.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
  const folder = zip.folder(`${safeName}-${task.id.slice(0, 6)}`);
  folder.file(`original-${task.source.name.replace(/[\\/:*?"<>|]/g, '_')}`, task.source.dataUrl.split(',')[1], { base64: true });
  task.turns.forEach((turn, index) => turn.outputs.forEach((output, outputIndex) => {
    folder.file(`round-${index + 1}-${outputIndex + 1}-${output.kind || 'result'}.${output.extension}`, output.dataUrl.split(',')[1], { base64: true });
  }));
  folder.file('conversation.json', JSON.stringify({ name: task.name, createdAt: task.createdAt,
    rounds: task.turns.map((turn) => ({ instruction: turn.instruction, status: turn.status,
      createdAt: turn.createdAt, finishedAt: turn.finishedAt, error: turn.error, outputCount: turn.outputs.length })) }, null, 2));
}

export function addWhiteBatchToZip(zip, tasks) {
  let count = 0;
  for (const task of tasks) {
    const latest = [...task.turns].reverse().find((turn) => turn.status === 'done' && turn.outputs.some((output) => output.kind === 'white'));
    const white = latest?.outputs.find((output) => output.kind === 'white');
    if (!white) continue;
    const safeName = task.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    zip.file(`${safeName}-${task.id.slice(0, 6)}-white.png`, white.dataUrl.split(',')[1], { base64: true });
    count += 1;
  }
  return count;
}
