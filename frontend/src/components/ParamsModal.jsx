import { Copy } from 'lucide-react';

export function ParamsModal({ item, onClose, onUse }) {
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
