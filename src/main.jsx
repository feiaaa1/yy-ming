import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { addTaskToZip, addWhiteBatchToZip } from './archive.js';
import {
  ArrowDownToLine, Check, ChevronRight, Clock3, Eye, EyeOff, FileImage,
  ImagePlus, KeyRound, LoaderCircle, Plus, RotateCcw, Send, Trash2, X,
} from 'lucide-react';
import { generateCutout } from './openrouter.js';
import { makeWhiteBackground } from './image.js';
import { makeTurn, queueBatch } from './tasks.js';
import { loadTasks, saveTasks } from './storage.js';
import './styles.css';

const KEY_STORAGE = 'ming-layers-openrouter-key';
const MAX_CONCURRENT = 3;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('图片格式无法识别'));
      image.onload = () => resolve({ name: file.name, dataUrl: reader.result, width: image.naturalWidth, height: image.naturalHeight });
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function taskState(task) {
  if (task.turns.some((turn) => turn.status === 'running')) return 'running';
  if (task.turns.some((turn) => turn.status === 'failed')) return 'failed';
  if (task.turns.some((turn) => turn.status === 'queued')) return 'queued';
  return task.turns.length ? 'done' : 'new';
}

const stateLabels = { new: '待开始', queued: '排队中', running: '处理中', done: '已完成', failed: '失败' };
const outputLabels = { cutout: '透明抠图', white: '白底成品', background: '原背景' };

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const inputRef = useRef(null);
  const importingRef = useRef(false);
  const activeRequests = useRef(new Set());
  const controllers = useRef(new Map());
  const [tasks, setTasks] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) || '');
  const [showKey, setShowKey] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [batchDraft, setBatchDraft] = useState(null);
  const [batchInstruction, setBatchInstruction] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const selected = tasks.find((task) => task.id === selectedId) || null;
  const activeCount = tasks.filter((task) => taskState(task) === 'running').length;
  const queuedCount = tasks.filter((task) => taskState(task) === 'queued').length;
  const selectedReference = selected?.reference?.turnId
    ? selected.turns.find((turn) => turn.id === selected.reference.turnId)?.outputs[selected.reference.outputIndex]
    : null;
  const referenceTurn = selected?.turns.find((turn) => turn.id === selected?.reference?.turnId);
  const whitePreview = selectedReference?.kind === 'cutout' ? referenceTurn?.outputs.find((output) => output.kind === 'white') : null;
  const preview = whitePreview || selectedReference || selected?.source;
  const batchTasks = tasks.filter((task) => task.batchId && task.batchId === selectedBatchId);
  const batchDone = batchTasks.filter((task) => taskState(task) === 'done').length;
  const batchPending = batchTasks.some((task) => ['new', 'queued', 'running'].includes(taskState(task)));

  useEffect(() => {
    loadTasks().then((saved) => {
      const restored = saved.map((task) => ({ ...task, turns: task.turns.map((turn) => turn.status === 'running'
        ? { ...turn, status: 'failed', stage: '', error: '页面刷新中断了本轮请求，请重试。', finishedAt: Date.now() } : turn) }));
      setTasks(restored);
      setSelectedId(restored[0]?.id || null);
      const latestBatch = restored.find((task) => task.batchId)?.batchId;
      setSelectedBatchId(latestBatch || null);
      if (latestBatch) {
        const draftIds = restored.filter((task) => task.batchId === latestBatch && !task.turns.length).map((task) => task.id);
        if (draftIds.length) setBatchDraft({ id: latestBatch, taskIds: draftIds });
      }
      setHydrated(true);
    }).catch(() => { setNotice('无法读取本地任务记录，当前会话仍可继续使用。'); setHydrated(true); });
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => saveTasks(tasks).catch(() => {
      setNotice('浏览器存储空间不足，任务可能无法在刷新后恢复；请及时下载全部内容。');
    }), 500);
    return () => clearTimeout(timer);
  }, [tasks, hydrated]);

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  function updateTurn(taskId, turnId, changes) {
    setTasks((items) => items.map((task) => task.id === taskId
      ? { ...task, turns: task.turns.map((turn) => turn.id === turnId ? { ...turn, ...changes } : turn) } : task));
  }

  async function runTurn(task, turn) {
    activeRequests.current.add(task.id);
    const controller = new AbortController();
    controllers.current.set(task.id, controller);
    updateTurn(task.id, turn.id, { status: 'running', stage: '正在发送图片', startedAt: Date.now(), error: '' });
    try {
      const turnIndex = task.turns.findIndex((item) => item.id === turn.id);
      const previous = task.turns.slice(0, turnIndex).filter((item) => item.status === 'done');
      const preferred = task.reference?.turnId ? previous.find((item) => item.id === task.reference.turnId) : null;
      const referenceTurn = task.reference?.original ? null : preferred || previous.at(-1);
      const reference = referenceTurn?.outputs[preferred ? task.reference.outputIndex : 0]?.dataUrl || task.source.dataUrl;
      const context = task.reference?.original ? [] : preferred ? previous.slice(0, previous.indexOf(preferred) + 1) : previous;
      updateTurn(task.id, turn.id, { stage: '模型正在处理' });
      const generated = await generateCutout({ apiKey: apiKey.trim(), reference, instruction: turn.instruction,
        history: context.map((item) => item.instruction), signal: controller.signal });
      updateTurn(task.id, turn.id, { stage: '正在合成白底图' });
      const cutout = { ...generated[0], kind: 'cutout' };
      const white = await makeWhiteBackground(cutout.dataUrl);
      const outputs = [cutout, white, ...generated.slice(1).map((output) => ({ ...output, kind: 'background' }))];
      setTasks((items) => items.map((item) => item.id === task.id ? { ...item,
        reference: { turnId: turn.id, outputIndex: 0 },
        turns: item.turns.map((entry) => entry.id === turn.id
          ? { ...entry, status: 'done', stage: '', outputs, finishedAt: Date.now(), error: '' } : entry) } : item));
    } catch (error) {
      updateTurn(task.id, turn.id, { status: 'failed', stage: '', error: error.message || '生成失败，请重试。', finishedAt: Date.now() });
    } finally { activeRequests.current.delete(task.id); controllers.current.delete(task.id); }
  }

  useEffect(() => {
    if (!hydrated || !apiKey.trim()) return;
    let available = MAX_CONCURRENT - activeRequests.current.size;
    for (const task of tasks) {
      if (available <= 0) break;
      if (activeRequests.current.has(task.id)) continue;
      const next = task.turns.find((turn) => turn.status === 'queued');
      if (!next) continue;
      if (task.turns.slice(0, task.turns.indexOf(next)).some((turn) => turn.status === 'failed')) continue;
      available -= 1;
      runTurn(task, next);
    }
  }, [tasks, apiKey, hydrated]);

  async function addImages(files) {
    if (!files?.length || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    setNotice('');
    const batchId = batchDraft?.id || crypto.randomUUID();
    const added = [];
    let skipped = 0;
    for (const file of Array.from(files)) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
        skipped += 1;
        continue;
      }
      try {
        const source = await readImage(file);
        added.push({ id: crypto.randomUUID(), batchId, name: file.name, source,
          createdAt: Date.now(), turns: [], reference: null });
      } catch { skipped += 1; }
    }
    if (added.length) {
      setTasks((items) => [...added, ...items]);
      setSelectedId(added[0].id);
      setSelectedBatchId(batchId);
      setBatchDraft((current) => ({ id: batchId, taskIds: [...(current?.taskIds || []), ...added.map((task) => task.id)] }));
      setInstruction('');
    }
    if (skipped) setNotice(`已导入 ${added.length} 张，跳过 ${skipped} 张。仅支持不超过 12 MB 的 PNG、JPG 或 WebP。`);
    importingRef.current = false;
    setImporting(false);
  }

  function submitBatch() {
    if (!batchDraft?.taskIds.length) return;
    if (!apiKey.trim()) return setNotice('请先填写 OpenRouter API Key。');
    const text = batchInstruction.trim() || '抠出图片中的主要主体，制作白底图';
    setTasks((items) => queueBatch(items, batchDraft.taskIds, text));
    setSelectedBatchId(batchDraft.id);
    setBatchDraft(null);
    setBatchInstruction('');
    setNotice('');
  }

  function submitTurn() {
    if (!selected) return;
    if (!apiKey.trim()) return setNotice('请先填写 OpenRouter API Key。');
    if (selected.turns.length && !instruction.trim()) return setNotice('请描述这一轮需要修改的内容。');
    setNotice('');
    const turn = makeTurn(instruction.trim() || '抠出图片中的主要主体，制作白底图');
    setTasks((items) => items.map((task) => task.id === selected.id ? { ...task, turns: [...task.turns, turn] } : task));
    setBatchDraft((current) => {
      if (!current?.taskIds.includes(selected.id)) return current;
      const taskIds = current.taskIds.filter((id) => id !== selected.id);
      return taskIds.length ? { ...current, taskIds } : null;
    });
    setInstruction('');
  }

  function chooseReference(taskId, turnId, outputIndex) {
    setTasks((items) => items.map((task) => task.id === taskId ? { ...task, reference: { turnId, outputIndex } } : task));
  }

  function deleteTask(taskId) {
    controllers.current.get(taskId)?.abort();
    setTasks((items) => items.filter((task) => task.id !== taskId));
    setBatchDraft((current) => {
      if (!current) return null;
      const taskIds = current.taskIds.filter((id) => id !== taskId);
      return taskIds.length ? { ...current, taskIds } : null;
    });
    if (selectedId === taskId) setSelectedId(tasks.find((task) => task.id !== taskId)?.id || null);
    setDeletingId(null);
  }

  async function downloadAll(task = null, batchId = null) {
    setExporting(true);
    setNotice('');
    try {
      const zip = new JSZip();
      (task ? [task] : batchId ? tasks.filter((item) => item.batchId === batchId) : tasks).forEach((item) => addTaskToZip(zip, item));
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, task ? `cutout-${task.id.slice(0, 6)}.zip` : batchId ? `cutout-batch-${batchId.slice(0, 6)}.zip` : `cutout-all-${Date.now()}.zip`);
    } catch (error) { setNotice(`打包失败：${error.message}`); }
    finally { setExporting(false); }
  }

  async function downloadWhiteBatch() {
    if (!selectedBatchId) return;
    setExporting(true);
    setNotice('');
    try {
      const zip = new JSZip();
      const count = addWhiteBatchToZip(zip, batchTasks);
      if (!count) throw new Error('当前批次还没有白底成品。');
      downloadBlob(await zip.generateAsync({ type: 'blob' }), `white-background-${selectedBatchId.slice(0, 6)}.zip`);
    } catch (error) { setNotice(`下载失败：${error.message}`); }
    finally { setExporting(false); }
  }

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><FileImage size={19} /></span><span>MING <b>CUTOUT</b></span></div>
      <div className="header-status"><span className="live-dot" />{activeCount} 处理中 <span className="status-divider">/</span> {queuedCount} 排队</div>
      <button className="button header-export" onClick={() => downloadAll()} disabled={!tasks.length || exporting}><ArrowDownToLine size={15} /> 下载全部</button></header>
    <main className="workspace"><aside className="sidebar">
      <div className="sidebar-heading"><div><span className="eyebrow">WORKSPACE</span><h1>抠图任务</h1></div><span className="task-total">{tasks.length}</span></div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addImages(event.target.files); event.target.value = ''; }} />
      <button className={`upload-zone ${dragging ? 'dragging' : ''}`} disabled={importing} onClick={() => inputRef.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addImages(event.dataTransfer.files); }}>
        <ImagePlus size={22} /><strong>{importing ? '正在读取图片' : '添加图片'}</strong><span>一次选择或拖入多张</span>{importing ? <LoaderCircle size={16} className="upload-plus spin" /> : <Plus size={16} className="upload-plus" />}</button>
      {batchDraft?.taskIds.length > 0 && <div className="batch-composer">
        <div className="batch-heading"><strong>批量处理 · {batchDraft.taskIds.length} 张</strong></div>
        <textarea value={batchInstruction} onChange={(event) => setBatchInstruction(event.target.value)} rows={3} placeholder="例如：全部抠成白底图，只保留商品主体" />
        <button className="batch-submit" onClick={submitBatch}><Send size={14} /> 开始批量抠图</button>
      </div>}
      {batchTasks.length > 0 && !batchDraft && <div className="batch-summary">
        <div><strong>当前批次</strong><span>{batchDone} / {batchTasks.length} 完成</span></div>
        <button onClick={downloadWhiteBatch} disabled={batchPending || exporting || !batchDone}><ArrowDownToLine size={14} /> 下载白底图 ZIP</button>
        <button className="batch-secondary" onClick={() => downloadAll(null, selectedBatchId)} disabled={batchPending || exporting}><ArrowDownToLine size={14} /> 下载完整批次</button>
      </div>}
      <div className="task-list-heading"><span>任务列表</span><span>{tasks.length} 项</span></div>
      <div className="task-list">{!tasks.length && <div className="empty-list">上传第一张图片，开始抠图。</div>}
        {tasks.map((task) => { const state = taskState(task); const finished = task.turns.filter((turn) => turn.status === 'done').length;
          const runningTurn = task.turns.find((turn) => turn.status === 'running');
          return <button key={task.id} className={`task-item ${selectedId === task.id ? 'selected' : ''}`} onClick={() => { setSelectedId(task.id); setSelectedBatchId(task.batchId || null); setInstruction(''); setNotice(''); }}>
            <img src={task.source.dataUrl} alt="" /><span className="task-item-copy"><strong title={task.name}>{task.name}</strong><small>{runningTurn ? `${runningTurn.stage} · ${Math.floor((now - runningTurn.startedAt) / 1000)} 秒` : `${finished} 轮完成 · ${task.source.width} × ${task.source.height}`}</small></span>
            <span className={`state-badge ${state}`}>{stateLabels[state]}</span></button>; })}</div>
      <div className="key-settings"><label htmlFor="api-key"><KeyRound size={15} /> OpenRouter API Key</label><div className="key-field">
        <input id="api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onBlur={() => { if (apiKey.trim()) localStorage.setItem(KEY_STORAGE, apiKey.trim()); else localStorage.removeItem(KEY_STORAGE); }} type={showKey ? 'text' : 'password'} placeholder="sk-or-v1-..." autoComplete="off" />
        <button onClick={() => setShowKey((value) => !value)} title={showKey ? '隐藏密钥' : '显示密钥'} aria-label={showKey ? '隐藏密钥' : '显示密钥'}>{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
        <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">获取 Key <ChevronRight size={12} /></a></div>
    </aside><section className="detail-panel">
      {notice && <div className="notice" role="alert"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
      {!selected ? <div className="no-task"><FileImage size={33} /><h2>选择一张图片开始</h2><p>新建任务后，抠图结果和后续修改会保存在同一条对话中。</p></div> : <>
        <div className="detail-header"><div><span className="eyebrow">TASK DETAIL / {new Date(selected.createdAt).toLocaleString('zh-CN')}</span><h2 title={selected.name}>{selected.name}</h2><span className="image-meta">{selected.source.width} × {selected.source.height} <span>·</span> {selected.turns.length} 轮对话</span></div>
          <div className="detail-actions"><button className="button" onClick={() => downloadAll(selected)} disabled={exporting}><ArrowDownToLine size={15} /> 下载本任务</button><button className="icon-action danger" onClick={() => setDeletingId(selected.id)} title="删除任务" aria-label="删除任务"><Trash2 size={16} /></button></div></div>
        <div className="detail-body"><section className="preview-panel"><div className="section-title"><strong>预览</strong><span>{whitePreview ? '白底成品' : selectedReference ? '当前参考结果' : '原图'}</span></div>
          <div className="preview-stage"><img src={preview.dataUrl} alt={whitePreview ? '白底成品' : selectedReference ? '当前抠图结果' : '原图'} /></div>
          {selectedReference && <button className="text-action" onClick={() => setTasks((items) => items.map((task) => task.id === selected.id ? { ...task, reference: { original: true } } : task))}><RotateCcw size={13} /> 改用原图作为参考</button>}</section>
          <section className="conversation-panel"><div className="section-title"><strong>修改记录</strong><span>{selected.turns.length} 轮</span></div><div className="conversation-scroll">
            <div className="source-message"><img src={selected.source.dataUrl} alt="原图缩略图" /><div><strong>原始图片</strong><small>{selected.source.name}</small></div></div>
            {selected.turns.map((turn, index) => <div className="turn" key={turn.id}><div className="turn-heading"><span className="round-number">{String(index + 1).padStart(2, '0')}</span><strong>{turn.instruction}</strong><span className={`state-badge ${turn.status}`}>{stateLabels[turn.status]}</span></div>
              {turn.status === 'running' && <div className="turn-progress"><LoaderCircle size={15} className="spin" /><span>{turn.stage} · {Math.floor((now - turn.startedAt) / 1000)} 秒</span><div className="indeterminate" /></div>}
              {turn.status === 'queued' && <div className="turn-queued"><Clock3 size={14} /> {selected.turns.slice(0, index).some((item) => item.status === 'failed') ? '等待前一轮重试' : '等待空闲任务位'}</div>}
              {turn.status === 'failed' && <div className="turn-error"><span>{turn.error}</span><button onClick={() => updateTurn(selected.id, turn.id, { status: 'queued', error: '', finishedAt: null })}><RotateCcw size={13} /> 重试</button></div>}
              {turn.status === 'done' && <div className="output-grid">{turn.outputs.map((output, outputIndex) => { const isReference = selected.reference?.turnId === turn.id && selected.reference.outputIndex === outputIndex;
                return <div className={`output-item ${isReference ? 'current' : ''}`} key={outputIndex}><button className="output-preview" onClick={() => chooseReference(selected.id, turn.id, outputIndex)} title="设为下一轮参考图"><span className="output-label">{outputLabels[output.kind] || `结果 ${outputIndex + 1}`}</span><img src={output.dataUrl} alt={`第 ${index + 1} 轮${outputLabels[output.kind] || `结果 ${outputIndex + 1}`}`} /></button>
                  <div className="output-foot"><button onClick={() => chooseReference(selected.id, turn.id, outputIndex)}>{isReference ? <><Check size={12} /> 当前参考</> : '设为参考'}</button><button className="icon-action" onClick={() => downloadBlob(new Blob([Uint8Array.from(atob(output.dataUrl.split(',')[1]), (char) => char.charCodeAt(0))], { type: output.mime }), `round-${index + 1}-${outputIndex + 1}-${output.kind || 'result'}.${output.extension}`)} title="下载图片" aria-label="下载图片"><ArrowDownToLine size={14} /></button></div></div>; })}</div>}
            </div>)}{!selected.turns.length && <p className="conversation-empty">输入需要抠出的主体，也可以直接开始，自动提取主要主体。</p>}</div>
            <div className="composer"><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitTurn(); } }} placeholder={selected.turns.length ? '描述下一轮调整，例如：只保留自行车，去掉骑行的人' : '描述要抠出的主体，例如：只保留自行车'} rows={3} /><button onClick={submitTurn}><Send size={16} /> {selected.turns.length ? '发送修改' : '开始抠图'}</button></div>
          </section></div></>}
    </section></main>
    {deletingId && <div className="modal-backdrop"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <h2 id="delete-title">删除任务？</h2><p>此任务的原图、修改记录和所有结果都会从当前浏览器移除，无法撤销。</p>
      <div><button className="button" onClick={() => setDeletingId(null)}>取消</button><button className="button delete-confirm" onClick={() => deleteTask(deletingId)}>删除任务</button></div>
    </div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
