import { ImagePlus, Loader2, RefreshCw } from 'lucide-react';
import { Field, Select } from './Field.jsx';
import { LoraEditor } from './LoraEditor.jsx';
import { numberValue } from '../state/defaultSettings.js';

export function GenerateForm({ settings, resources, presets, busy, onSubmit, onPatch, onUsePreset, onRefreshResources }) {
  return (
    <form onSubmit={onSubmit} className="panel form">
      <div className="grid2">
        <Field label="Пресет">
          <select value="" onChange={(e) => e.target.value && onUsePreset(e.target.value)}>
            <option value="">Выбрать пресет</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </Field>
        <Field label="Workflow">
          <input value={settings.workflowType || 'sd15-text2img'} onChange={(e) => onPatch('workflowType', e.target.value)} />
        </Field>
      </div>

      <Field label="Позитивный промпт">
        <textarea rows="5" value={settings.prompt} onChange={(e) => onPatch('prompt', e.target.value)} placeholder="Что рисуем?" />
      </Field>
      <Field label="Негативный промпт">
        <textarea rows="3" value={settings.negativePrompt} onChange={(e) => onPatch('negativePrompt', e.target.value)} placeholder="Что исключить" />
      </Field>

      <div className="grid2">
        <Field label="Checkpoint">
          <Select value={settings.checkpoint} options={resources.checkpoints} onChange={(v) => onPatch('checkpoint', v)} />
        </Field>
        <Field label="Sampler">
          <Select value={settings.samplerName} options={resources.samplers} onChange={(v) => onPatch('samplerName', v)} />
        </Field>
        <Field label="Scheduler">
          <Select value={settings.scheduler} options={resources.schedulers} onChange={(v) => onPatch('scheduler', v)} />
        </Field>
        <Field label="Seed" hint="-1 = случайный">
          <input type="number" value={settings.seed} onChange={(e) => onPatch('seed', numberValue(e.target.value))} />
        </Field>
        <Field label="Width">
          <input type="number" min="64" step="8" value={settings.width} onChange={(e) => onPatch('width', numberValue(e.target.value))} />
        </Field>
        <Field label="Height">
          <input type="number" min="64" step="8" value={settings.height} onChange={(e) => onPatch('height', numberValue(e.target.value))} />
        </Field>
        <Field label="Steps">
          <input type="number" min="1" max="150" value={settings.steps} onChange={(e) => onPatch('steps', numberValue(e.target.value))} />
        </Field>
        <Field label="CFG">
          <input type="number" min="0" max="30" step="0.1" value={settings.cfg} onChange={(e) => onPatch('cfg', numberValue(e.target.value))} />
        </Field>
        <Field label="Denoise">
          <input type="number" min="0" max="1" step="0.01" value={settings.denoise} onChange={(e) => onPatch('denoise', numberValue(e.target.value))} />
        </Field>
        <Field label="Batch size">
          <input type="number" min="1" max="8" value={settings.batchSize} onChange={(e) => onPatch('batchSize', numberValue(e.target.value))} />
        </Field>
      </div>

      <LoraEditor loras={settings.loras || []} resources={resources} onChange={(loras) => onPatch('loras', loras)} />

      <div className="rowActions formActions">
        <button className="secondary" type="button" onClick={onRefreshResources}><RefreshCw size={18} /> Обновить ресурсы</button>
        <button className="primary submit" disabled={busy} type="submit">
          {busy ? <Loader2 className="spin" size={18} /> : <ImagePlus size={18} />}
          {busy ? 'Генерирую…' : 'Сгенерировать'}
        </button>
      </div>
    </form>
  );
}
