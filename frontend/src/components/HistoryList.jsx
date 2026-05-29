import { Copy, RefreshCw, Settings2, Shuffle, Star } from 'lucide-react';
import { ImageGrid } from './ImageGrid.jsx';
import { variationSettings } from '../state/defaultSettings.js';

export function HistoryList({ history, initData, filters, onFiltersChange, onRefresh, onShowParams, onUseSettings, onToggleFavorite }) {
  return (
    <section className="historyList">
      <div className="panel historyFilters">
        <input value={filters.search} onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })} placeholder="Поиск по истории" />
        <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}>
          <option value="">Все статусы</option>
          <option value="done">Готовые</option>
          <option value="failed">Ошибки</option>
          <option value="cancelled">Отменённые</option>
        </select>
        <button className={filters.favorite ? 'secondary activeSoft' : 'secondary'} onClick={() => onFiltersChange({ ...filters, favorite: !filters.favorite })} type="button"><Star size={16} /> Избранное</button>
        <button className="secondary" onClick={onRefresh} type="button"><RefreshCw size={16} /> Обновить</button>
      </div>

      {!history.length && <div className="panel muted emptyHistory">История пока пустая.</div>}
      {history.map((item) => (
        <article className="historyItem" key={item.id}>
          <ImageGrid images={item.images || []} initData={initData} />
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
              <button className="secondary" onClick={() => onShowParams(item)}><Settings2 size={16} /> Параметры</button>
              <button className="secondary" onClick={() => onUseSettings(item.settings)}><Copy size={16} /> В форму</button>
              <button className="secondary" onClick={() => onUseSettings(variationSettings(item.settings))}><Shuffle size={16} /> Вариация</button>
              <button className={item.favorite ? 'secondary activeSoft' : 'secondary'} onClick={() => onToggleFavorite(item)}><Star size={16} /> {item.favorite ? 'В избранном' : 'В избранное'}</button>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
