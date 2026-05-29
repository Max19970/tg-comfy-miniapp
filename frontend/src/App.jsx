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

export function App() {
  const { tg, initData } = useTelegram();
  const api = React.useMemo(() => createApiClient(initData), [initData]);

  const [tab, setTab] = React.useState('generate');
  const [settings, setSettings] = React.useState(emptySettings);
  const [resources, setResources] = React.useState({ checkpoints: [], loras: [], samplers: [], schedulers: [] });
  const [presets, setPresets] = React.useState([]);
  const [job, setJob] = React.useState(null);
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
    onJob: (nextJob) => {
      setJob(nextJob);
      if (['done', 'failed', 'cancelled'].includes(nextJob.status)) {
        setBusy(false);
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
      setBusy(true);
      const data = await api.generate(settings);
      setJob(data.job);
      connect(data.job.id);
      tg?.HapticFeedback?.impactOccurred?.('medium');
    } catch (e) {
      setBusy(false);
      setError(e.message || String(e));
    }
  }

  async function cancelJob(id) {
    try {
      setError('');
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
    return <main className="app"><div className="center"><Loader2 className="spin" /> Загружаю mini app…</div></main>;
  }

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Telegram Mini App + ComfyUI</p>
          <h1>Генератор картинок</h1>
        </div>
        <button className="ghost" onClick={() => { loadHistory(filters); tg?.HapticFeedback?.selectionChanged?.(); }}><RefreshCw size={18} /></button>
      </header>

      {!initData && <div className="notice">Открывай приложение из Telegram-бота. Без Telegram initData сервер не пустит API-запросы, если включена проверка.</div>}
      {resources.warning && <div className="notice">{resources.warning}</div>}
      {error && <div className="notice error">{error}</div>}

      <nav className="tabs">
        <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}><Wand2 size={18} /> Генерация</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={18} /> История</button>
      </nav>

      {tab === 'generate' && (
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
      )}

      {tab === 'generate' && <ProgressPanel job={job} onCancel={cancelJob} />}
      {tab === 'generate' && <ImageGrid images={job?.images || []} initData={initData} />}

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
