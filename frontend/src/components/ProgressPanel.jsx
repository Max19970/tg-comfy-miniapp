import { Loader2, XCircle } from 'lucide-react';

export function ProgressPanel({ job, preview, onCancel }) {
  if (!job) return null;

  const label = {
    queued: 'В очереди',
    submitting: 'Отправляю в ComfyUI',
    running: 'Рисую',
    finalizing: 'Забираю результат',
    cancelling: 'Отменяю',
    cancelled: 'Отменено',
    done: 'Готово',
    failed: 'Ошибка'
  }[job.status] || job.status;

  const canCancel = ['queued', 'submitting', 'running', 'finalizing'].includes(job.status);
  const nodeLabel = job.currentNodeName || job.currentNode;
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
  const showPreview = preview?.dataUrl && !['done', 'failed', 'cancelled'].includes(job.status);
  const showPreviewHint = !preview?.dataUrl && ['running', 'finalizing'].includes(job.status);

  return (
    <section className={`stagePanel ${job.status}`}>
      <div className="stageFrame">
        {showPreview ? (
          <img src={preview.dataUrl} alt="Черновик генерации" />
        ) : (
          <div className="stageEmpty">
            <Loader2 className="spin" size={24} />
            <span>{showPreviewHint ? 'Жду первые шаги сэмплинга' : label}</span>
          </div>
        )}
      </div>

      <div className="stageInfo">
        <div className="stageHeader">
          <div>
            <span className="stageKicker">Generation stage</span>
            <strong>{label}{job.queuePosition ? ` #${job.queuePosition}` : ''}</strong>
          </div>
          <span className="stagePercent">{progress}%</span>
        </div>

        <div className="progressTrack" aria-label={`Прогресс ${progress}%`}>
          <div style={{ width: `${progress}%` }} />
        </div>

        {nodeLabel && (
          <p className="muted compactLine">
            Сейчас: {nodeLabel}
            {job.currentNodeName && job.currentNode ? ` · node ${job.currentNode}` : ''}
          </p>
        )}

        {job.error && <p className="error">{job.error}</p>}

        {canCancel && (
          <button className="secondary cancelButton" type="button" onClick={() => onCancel?.(job.id)}>
            <XCircle size={18} /> Остановить
          </button>
        )}

        {job.status === 'cancelling' && (
          <p className="muted compactLine"><Loader2 className="spin" size={16} /> Сервер останавливает задачу.</p>
        )}
      </div>
    </section>
  );
}
