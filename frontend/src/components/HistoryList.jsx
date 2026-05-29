import React from 'react';
import { Copy, RefreshCw, Settings2, Shuffle, Star } from 'lucide-react';
import { ImageGrid } from './ImageGrid.jsx';
import { variationSettings } from '../state/defaultSettings.js';

const galleryViewKey = 'tg-comfy-miniapp:gallery-view-mode';
const galleryModes = [
  { id: 'large', label: 'Большие', columns: 1 },
  { id: 'medium', label: '2', columns: 2 },
  { id: 'small', label: '3', columns: 3 },
  { id: 'micro', label: '4', columns: 4 }
];

function loadGalleryViewMode() {
  try {
    const saved = localStorage.getItem(galleryViewKey);
    return galleryModes.some((mode) => mode.id === saved) ? saved : 'large';
  } catch {
    return 'large';
  }
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  return {
    done: 'Готово',
    failed: 'Ошибка',
    cancelled: 'Отменено',
    queued: 'В очереди',
    running: 'Рисуется'
  }[status] || status;
}

export function HistoryList({ history, initData, filters, onFiltersChange, onRefresh, onShowParams, onUseSettings, onToggleFavorite }) {
  const [viewMode, setViewMode] = React.useState(loadGalleryViewMode);

  function changeViewMode(nextMode) {
    setViewMode(nextMode);
    try {
      localStorage.setItem(galleryViewKey, nextMode);
    } catch {
      // localStorage can be unavailable in some embedded contexts.
    }
  }

  return (
    <section className="historyList">
      <div className="galleryHeader">
        <div>
          <p className="eyebrow">Gallery</p>
          <h2>Твои генерации</h2>
        </div>
        <button className="ghost iconButton" onClick={onRefresh} type="button" aria-label="Обновить галерею"><RefreshCw size={18} /></button>
      </div>

      <div className="panel historyFilters">
        <input value={filters.search} onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })} placeholder="Найти по промпту" />
        <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}>
          <option value="">Все статусы</option>
          <option value="done">Готовые</option>
          <option value="failed">Ошибки</option>
          <option value="cancelled">Отменённые</option>
        </select>
        <button className={filters.favorite ? 'secondary activeSoft' : 'secondary'} onClick={() => onFiltersChange({ ...filters, favorite: !filters.favorite })} type="button"><Star size={16} /> Избранное</button>

        <div className="viewSwitch" role="group" aria-label="Размер карточек галереи">
          {galleryModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={viewMode === mode.id ? 'active' : ''}
              onClick={() => changeViewMode(mode.id)}
              aria-label={`${mode.columns} ${mode.columns === 1 ? 'столбец' : 'столбца'}`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {!history.length && <div className="panel muted emptyHistory">Здесь будут твои генерации.</div>}

      <div className={`historyGrid ${viewMode}`}>
        {history.map((item) => (
          <article className="historyItem" key={item.id}>
            <ImageGrid images={item.images || []} initData={initData} variant="history" />
            <div className="historyBody">
              <div className="historyTop">
                <strong>{formatDate(item.createdAt)}</strong>
                <button className={item.favorite ? 'starButton active' : 'starButton'} onClick={() => onToggleFavorite(item)} aria-label="Переключить избранное">
                  <Star size={16} />
                </button>
              </div>
              <p>{item.settings?.prompt || 'Без промпта'}</p>
              <div className="chips">
                <span className={`badge ${item.status}`}>{statusLabel(item.status)}</span>
                <span>{item.settings?.width}×{item.settings?.height}</span>
                <span>{item.settings?.steps} steps</span>
                <span>seed {item.settings?.seed}</span>
              </div>
              <div className="rowActions compactActions">
                <button className="secondary" onClick={() => onUseSettings(item.settings)}><Copy size={16} /> Повторить</button>
                <button className="secondary" onClick={() => onUseSettings(variationSettings(item.settings))}><Shuffle size={16} /> Новый seed</button>
                <button className="secondary" onClick={() => onShowParams(item)}><Settings2 size={16} /> Детали</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
