import { Loader2, XCircle } from 'lucide-react';

export function ProgressPanel({ job, onCancel }) {
  if (!job) return null;
  const label = {
    queued: 'В очереди',
    submitting: 'Отправляю в ComfyUI',
    running: 'Генерация',
    finalizing: 'Забираю результат',
    cancelling: 'Отменяю',
    cancelled: 'Отменено',
    done: 'Готово',
    failed: 'Ошибка'
  }[job.status] || job.status;

  const canCancel = ['queued', 'submitting', 'running', 'finalizing'].includes(job.status);

  return (
    <section className="panel progressPanel">
      <div className="progressHeader">
        <strong>{label}{job.queuePosition ? ` #${job.queuePosition}` : ''}</strong>
        <span>{job.progress || 0}%</span>
      </div>
      <div className="progressTrack"><div style={{ width: `${job.progress || 0}%` }} /></div>
      {job.currentNode && <p className="muted">Node: {job.currentNode}</p>}
      {job.error && <p className="error">{job.error}</p>}
      {canCancel && <button className="secondary cancelButton" type="button" onClick={() => onCancel?.(job.id)}><XCircle size={18} /> Отменить</button>}
      {job.status === 'cancelling' && <p className="muted"><Loader2 className="spin" size={16} /> Жду, пока сервер остановит задачу.</p>}
    </section>
  );
}
