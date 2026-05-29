import React from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, History, ImagePlus, Loader2, Plus, RefreshCw, Settings2, Trash2, Wand2 } from 'lucide-react';
import './styles.css';

const tg = window.Telegram?.WebApp;
tg?.ready?.();
tg?.expand?.();

const initData = tg?.initData || new URLSearchParams(window.location.search).get('initData') || '';
const colorScheme = tg?.colorScheme || 'dark';
document.documentElement.dataset.theme = colorScheme;

const emptySettings = {
  prompt: '',
  negativePrompt: '',
  checkpoint: '',
  width: 512,
  height: 512,
  batchSize: 1,
  steps: 25,
  cfg: 7,
  samplerName: 'euler',
  scheduler: 'normal',
  denoise: 1,
  seed: -1,
  loras: []
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': initData,
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

function wsUrl(jobId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws?jobId=${encodeURIComponent(jobId)}&initData=${encodeURIComponent(initData)}`;
}

function numberValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  return Number(value);
}

function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <em>{hint}</em>}</label>;
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="">{placeholder || 'Выбрать'}</option>}
      {options.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  );
}

function Progress({ job }) {
  if (!job) return null;
  const label = {
    queued: 'В очереди',
    running: 'Генерация',
    finalizing: 'Забираю результат',
    done: 'Готово',
    failed: 'Ошибка'
  }[job.status] || job.status;

  return (
    <section className="panel progressPanel">
      <div className="progressHeader">
        <strong>{label}</strong>
        <span>{job.progress || 0}%</span>
      </div>
      <div className="progressTrack"><div style={{ width: `${job.progress || 0}%` }} /></div>
      {job.currentNode && <p className="muted">Node: {job.currentNode}</p>}
      {job.error && <p className="error">{job.error}</p>}
    </section>
  );
}

function Images({ images = [] }) {
  if (!images.length) return null;
  return (
    <section className="imageGrid">
      {images.map((image, index) => (
        <a key={`${image.url}-${index}`} href={image.url} target="_blank" rel="noreferrer" className="imageCard">
          <img src={image.url} alt={image.filename || `generation-${index + 1}`} loading="lazy" />
        </a>
      ))}
    </section>
  );
}

function ParamsModal({ item, onClose, onUse }) {
  if (!item) return null;
  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalTop">
          <h3>Параметры генерации</h3>
          <button className="ghost" onClick={onClose}>Закрыть</button>
        </div>
        <pre>{JSON.stringify(item.settings, null, 2)}</pre>
        <button className="primary" onClick={() => onUse(item.settings)}><Copy size={18} /> Скопировать в форму</button>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = React.useState('generate');
  const [settings, setSettings] = React.useState(emptySettings);
  const [resources, setResources] = React.useState({ checkpoints: [], loras: [], samplers: [], schedulers: [] });
  const [job, setJob] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [modalItem, setModalItem] = React.useState(null);
  const wsRef = React.useRef(null);

  const patch = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

  const loadHistory = React.useCallback(async () => {
    const data = await api('/api/history');
    setHistory(data.items || []);
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        setError('');
        const [cfg, res] = await Promise.all([
          api('/api/config'),
          api('/api/comfy/resources')
        ]);
        const defaults = { ...emptySettings, ...(cfg.defaultSettings || {}) };
        setSettings(defaults);
        setResources({
          checkpoints: res.checkpoints || [],
          loras: res.loras || [],
          samplers: res.samplers || [],
          schedulers: res.schedulers || [],
          warning: res.warning
        });
        await loadHistory();
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadHistory]);

  function connectJob(nextJob) {
    wsRef.current?.close?.();
    const socket = new WebSocket(wsUrl(nextJob.id));
    wsRef.current = socket;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'job') {
        setJob(message.job);
        if (['done', 'failed'].includes(message.job.status)) {
          setBusy(false);
          loadHistory().catch(() => {});
        }
      }
    };
    socket.onerror = () => setError('WebSocket прогресса отвалился. Генерация может продолжаться на сервере.');
  }

  async function generate(e) {
    e.preventDefault();
    try {
      setError('');
      setBusy(true);
      const data = await api('/api/generate', { method: 'POST', body: JSON.stringify(settings) });
      setJob(data.job);
      connectJob(data.job);
      tg?.HapticFeedback?.impactOccurred?.('medium');
    } catch (e) {
      setBusy(false);
      setError(e.message || String(e));
    }
  }

  function addLora() {
    setSettings((prev) => ({
      ...prev,
      loras: [...(prev.loras || []), { name: resources.loras?.[0] || '', strengthModel: 0.75, strengthClip: 0.75 }]
    }));
  }

  function updateLora(index, key, value) {
    setSettings((prev) => ({
      ...prev,
      loras: prev.loras.map((lora, i) => i === index ? { ...lora, [key]: value } : lora)
    }));
  }

  function removeLora(index) {
    setSettings((prev) => ({ ...prev, loras: prev.loras.filter((_, i) => i !== index) }));
  }

  function useSettings(nextSettings) {
    setSettings({ ...emptySettings, ...nextSettings });
    setModalItem(null);
    setTab('generate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (loading) {
    return <main className="app"><div className="center"><Loader2 className="spin" /> Загружаю mini app…</div></main>;
  }

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Telegram Mini App + ComfyUI</p>
          <h1>Генератор картинок</h1>
        </div>
        <button className="ghost" onClick={() => { loadHistory(); tg?.HapticFeedback?.selectionChanged?.(); }}><RefreshCw size={18} /></button>
      </header>

      {!initData && <div className="notice">Открывай приложение из Telegram-бота. Без Telegram initData сервер не пустит API-запросы, если включена проверка.</div>}
      {resources.warning && <div className="notice">{resources.warning}</div>}
      {error && <div className="notice error">{error}</div>}

      <nav className="tabs">
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><Wand2 size={18} /> Генерация</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={18} /> История</button>
      </nav>

      {tab === 'generate' && (
        <form onSubmit={generate} className="panel form">
          <Field label="Позитивный промпт">
            <textarea rows="5" value={settings.prompt} onChange={(e) => patch('prompt', e.target.value)} placeholder="Что рисуем?" />
          </Field>
          <Field label="Негативный промпт">
            <textarea rows="3" value={settings.negativePrompt} onChange={(e) => patch('negativePrompt', e.target.value)} placeholder="Что исключить" />
          </Field>

          <div className="grid2">
            <Field label="Checkpoint">
              <Select value={settings.checkpoint} options={resources.checkpoints} onChange={(v) => patch('checkpoint', v)} />
            </Field>
            <Field label="Sampler">
              <Select value={settings.samplerName} options={resources.samplers} onChange={(v) => patch('samplerName', v)} />
            </Field>
            <Field label="Scheduler">
              <Select value={settings.scheduler} options={resources.schedulers} onChange={(v) => patch('scheduler', v)} />
            </Field>
            <Field label="Seed" hint="-1 = случайный">
              <input type="number" value={settings.seed} onChange={(e) => patch('seed', numberValue(e.target.value))} />
            </Field>
            <Field label="Width">
              <input type="number" min="64" step="8" value={settings.width} onChange={(e) => patch('width', numberValue(e.target.value))} />
            </Field>
            <Field label="Height">
              <input type="number" min="64" step="8" value={settings.height} onChange={(e) => patch('height', numberValue(e.target.value))} />
            </Field>
            <Field label="Steps">
              <input type="number" min="1" max="150" value={settings.steps} onChange={(e) => patch('steps', numberValue(e.target.value))} />
            </Field>
            <Field label="CFG">
              <input type="number" min="0" max="30" step="0.1" value={settings.cfg} onChange={(e) => patch('cfg', numberValue(e.target.value))} />
            </Field>
            <Field label="Denoise">
              <input type="number" min="0" max="1" step="0.01" value={settings.denoise} onChange={(e) => patch('denoise', numberValue(e.target.value))} />
            </Field>
            <Field label="Batch size">
              <input type="number" min="1" max="8" value={settings.batchSize} onChange={(e) => patch('batchSize', numberValue(e.target.value))} />
            </Field>
          </div>

          <section className="loraBox">
            <div className="sectionTitle"><Settings2 size={18} /><strong>LoRA</strong><button type="button" className="ghost" onClick={addLora}><Plus size={18} /> Добавить</button></div>
            {!settings.loras?.length && <p className="muted">LoRA не подключены.</p>}
            {settings.loras?.map((lora, index) => (
              <div className="loraRow" key={index}>
                <Field label="Файл LoRA">
                  <Select value={lora.name} options={resources.loras} onChange={(v) => updateLora(index, 'name', v)} placeholder="LoRA" />
                </Field>
                <Field label="Model">
                  <input type="number" step="0.05" value={lora.strengthModel} onChange={(e) => updateLora(index, 'strengthModel', numberValue(e.target.value))} />
                </Field>
                <Field label="CLIP">
                  <input type="number" step="0.05" value={lora.strengthClip} onChange={(e) => updateLora(index, 'strengthClip', numberValue(e.target.value))} />
                </Field>
                <button type="button" className="iconDanger" onClick={() => removeLora(index)} aria-label="Удалить LoRA"><Trash2 size={18} /></button>
              </div>
            ))}
          </section>

          <button className="primary submit" disabled={busy} type="submit">
            {busy ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}
            {busy ? 'Генерирую…' : 'Сгенерировать'}
          </button>
        </form>
      )}

      {tab === 'generate' && <Progress job={job} />}
      {tab === 'generate' && <Images images={job?.images || []} />}

      {tab === 'history' && (
        <section className="historyList">
          {!history.length && <div className="panel muted">История пока пустая.</div>}
          {history.map((item) => (
            <article className="historyItem" key={item.id}>
              <Images images={item.images || []} />
              <div className="historyBody">
                <div className="historyTop">
                  <strong>{new Date(item.createdAt).toLocaleString()}</strong>
                  <span className={`badge ${item.status}`}>{item.status}</span>
                </div>
                <p>{item.settings?.prompt}</p>
                <div className="chips">
                  <span>{item.settings?.width}×{item.settings?.height}</span>
                  <span>{item.settings?.steps} steps</span>
                  <span>{item.settings?.samplerName}</span>
                  <span>seed {item.settings?.seed}</span>
                </div>
                <div className="rowActions">
                  <button className="secondary" onClick={() => setModalItem(item)}><Settings2 size={16} /> Параметры</button>
                  <button className="secondary" onClick={() => useSettings(item.settings)}><Copy size={16} /> В форму</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <ParamsModal item={modalItem} onClose={() => setModalItem(null)} onUse={useSettings} />
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
