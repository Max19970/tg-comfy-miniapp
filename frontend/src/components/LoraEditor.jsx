import { Plus, Settings2, Trash2 } from 'lucide-react';
import { Field, Select } from './Field.jsx';
import { numberValue } from '../state/defaultSettings.js';

export function LoraEditor({ loras = [], resources, onChange, compact = false }) {
  function addLora() {
    onChange([...loras, { name: resources.loras?.[0] || '', strengthModel: 0.75, strengthClip: 0.75 }]);
  }

  function updateLora(index, key, value) {
    onChange(loras.map((lora, i) => i === index ? { ...lora, [key]: value } : lora));
  }

  function removeLora(index) {
    onChange(loras.filter((_, i) => i !== index));
  }

  return (
    <section className={compact ? 'loraBox compact' : 'loraBox'}>
      <div className="sectionTitle">
        {!compact && <span><Settings2 size={18} /><strong>LoRA</strong></span>}
        <button type="button" className="ghost smallButton" onClick={addLora}><Plus size={18} /> Добавить</button>
      </div>

      {!loras.length && <p className="muted">LoRA не подключены.</p>}

      <div className="loraList">
        {loras.map((lora, index) => (
          <article className="loraCard" key={index}>
            <Field label="Файл">
              <Select value={lora.name} options={resources.loras} onChange={(v) => updateLora(index, 'name', v)} placeholder="Выбрать LoRA" />
            </Field>

            <div className="loraStrengths">
              <label>
                <span>Model {lora.strengthModel}</span>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.05"
                  value={lora.strengthModel}
                  onChange={(e) => updateLora(index, 'strengthModel', numberValue(e.target.value))}
                />
              </label>
              <label>
                <span>CLIP {lora.strengthClip}</span>
                <input
                  type="range"
                  min="-2"
                  max="2"
                  step="0.05"
                  value={lora.strengthClip}
                  onChange={(e) => updateLora(index, 'strengthClip', numberValue(e.target.value))}
                />
              </label>
            </div>

            <button type="button" className="iconDanger" onClick={() => removeLora(index)} aria-label="Удалить LoRA"><Trash2 size={18} /></button>
          </article>
        ))}
      </div>
    </section>
  );
}
