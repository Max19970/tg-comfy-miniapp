import React from 'react';
import { History, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { createApiClient } from './api/client.js';
import { useTelegram } from './hooks/useTelegram.js';
import { useJobSocket } from './hooks/useJobSocket.js';
import { emptySettings } from './state/defaultSettings.js';
import { GenerateForm } from './components/GenerateForm.jsx';
import { HistoryList } from './components/HistoryList.jsx';
import { ImageGrid } from './components/ImageGrid.jsx';
import { ParamsModal } from './components/ParamsModal.jsx';
import { ProgressPanel } from './components/ProgressPanel.jsx';

const savedSettingsKey = 'tg-comfy-miniapp:last-settings';

function loadSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem(savedSettingsKey) || 'null');
  } catch {
    return null;
  }
}

function getStudioSummary(settings) {
  const size = `${settings.width || '?'}×${settings.height || '?'}`;
  const sampler = settings.samplerName || 'sampler';
  const model = settings.checkpoint || settings.workflowType || 'model';
  return `${size} · ${settings.steps || '?'} steps · ${sampler} · ${model}`;
}

export function App() {
  const { tg, initData } = useTelegram();
  const api = React.useMemo(() => createApiClient(initData), [initData]);

  const [tab, setTab] = React.useState('generate');
  const [settings, setSettings] = React.useState(emptySettings);
  const [resources, setResources] = React.useState({ checkpoints: [], loras: [], samplers: [], schedulers: [] });
  const [presets, setPresets] = React.useState([]);
  const [job, setJob] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [filters, setFilters] = React.useState({ search: '', status: '', favorite: false });
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [modalItem, setModalItem] = React.useState(null);

  const loadHistory = React.useCallback(async (nextFilters = {}) => {
    const data = await api.getHistory(nextFilters);
    setHistory(data.items || []);
  }, [api]);

  const { connect } = useJobSocket({
    initData,
    onError: setError,
    onPreview: setPreview,
    onJob: (nextJob) => {
      setJob(nextJob);
      if (['done', 'failed', 'cancelled'].includes(nextJob.status)) {
        setBusy(false);
        setPreview(null);
        loadHistory(filters).catch(() => {});
      }
    }
  });

  React.useEffect(() => {
    (async () => {
      try {
        setError('');
        const [cfg, res, presetData] = await Promise.all([
          api.getConfig(),
          api.getResources(),
          api.getPresets()
        ]);
        const defaults = { ...emptySettings, ...(cfg.defaultSettings || {}) };
        setSettings({ ...defaults, ...(loadSavedSettings() || {}) });
        setResources({
          checkpoints: res.checkpoints || [],
          loras: res.loras || [],
          samplers: res.samplers || [],
          schedulers: res.schedulers || [],
          warning: res.warning
        });
        setPresets(presetData.presets || []);
        if (presetData.warning) setError(presetData.warning);
        await loadHistory(filters);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [api, loadHistory]);

  React.useEffect(() => {
    const handle = setTimeout(() => {
      localStorage.setItem(savedSettingsKey, JSON.stringify(settings));
    }, 250);
    return () => clearTimeout(handle);
  }, [settings]);

  React.useEffect(() => {
    loadHistory(filters).catch((e) => setError(e.message || String(e)));
  }, [filters]);

  const patch = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const resultImages = job?.images || [];
  const hasResultImages = resultImages.length > 0;
  const shouldShowStage = job && !(job.status === 'done' && hasResultImages);

  async function refreshResources() {
    try {
      setError('');
      const [res, presetData] = await Promise.all([api.getResources(true), api.getPresets(true)]);
      setResources({ checkpoints: res.checkpoints || [], loras: res.loras || [], samplers: res.samplers || [], schedulers: res.schedulers || [], warning: res.warning });
      setPresets(presetData.presets || []);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  function usePreset(id) {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setSettings({ ...emptySettings, ...preset.settings });
    tg?.HapticFeedback?.selectionChanged?.();
  }

  async function generate(e) {
    e.preventDefault();
    try {
      setError('');
      setPreview(null);
      setBusy(true);
      setTab('generate');
      const data = await api.generate(settings);
      setJob(data.job);
      connect(data.job.id);
      tg?.HapticFeedback?.impactOccurred?.('medium');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setBusy(false);
      setError(e.message || String(e));
    }
  }

  async function cancelJob(id) {
    try {
      setError('');
      setPreview(null);
      const data = await api.cancelJob(id);
      setJob(data.job);
      await loadHistory(filters);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  function useSettings(nextSettings) {
    setSettings({ ...emptySettings, ...nextSettings });
    setModalItem(null);
    setTab('generate');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleFavorite(item) {
    try {
      const data = await api.setFavorite(item.id, !item.favorite);
      setHistory((prev) => prev.map((candidate) => candidate.id === item.id ? data.item : candidate));
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  if (loading) {
    return <main className="app"><div className="center"><Loader2 className="spin" /> Открываю студию…</div></main>;
  }

  return (
    <main className="app">
      <header className="topBar">
        <div>
          <p className="eyebrow">ComfyUI studio</p>
          <h1>Image Lab</h1>
          <span className="studioSummary">{getStudioSummary(settings)}</span>
        </div>
        <button className="ghost iconButton" onClick={() => { loadHistory(filters); tg?.HapticFeedback?.selectionChanged?.(); }} aria-label="Обновить историю">
          <RefreshCw size={18} />
        </button>
      </header>

      {!initData && <div className="notice">Открой приложение из Telegram-бота. Без Telegram initData сервер может не пустить API-запросы.</div>}
      {resources.warning && <div className="notice">{resources.warning}</div>}
      {error && <div className="notice error">{error}</div>}

      <nav className="tabs">
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><Wand2 size={18} /> Студия</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={18} /> Галерея</button>
      </nav>

      {tab === 'generate' && (
        <>
          {shouldShowStage ? (
            <ProgressPanel job={job} preview={preview} onCancel={cancelJob} />
          ) : !hasResultImages ? (
            <section className="stagePanel idle">
              <div className="stageFrame">
                <div className="stageEmpty">
                  <span>Здесь появится результат</span>
                  <small>Опиши кадр ниже и запусти генерацию</small>
                </div>
              </div>
            </section>
          ) : null}

          <ImageGrid images={resultImages} initData={initData} variant="result" />

          <GenerateForm
            settings={settings}
            resources={resources}
            presets={presets}
            busy={busy}
            onSubmit={generate}
            onPatch={patch}
            onUsePreset={usePreset}
            onRefreshResources={refreshResources}
          />
        </>
      )}

      {tab === 'history' && (
        <HistoryList
          history={history}
          initData={initData}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={() => loadHistory(filters)}
          onShowParams={setModalItem}
          onUseSettings={useSettings}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <ParamsModal item={modalItem} onClose={() => setModalItem(null)} onUse={useSettings} />
    </main>
  );
}
