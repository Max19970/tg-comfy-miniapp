import React from 'react';
import { ChevronDown, ImagePlus, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Field, Select } from './Field.jsx';
import { LoraEditor } from './LoraEditor.jsx';
import { numberValue } from '../state/defaultSettings.js';

const ratios = [
  { label: '1:1', width: 512, height: 512 },
  { label: '3:4', width: 768, height: 1024 },
  { label: '4:3', width: 1024, height: 768 },
  { label: '16:9', width: 1024, height: 576 }
];

const qualityModes = [
  { label: 'Draft', steps: 12, cfg: 6 },
  { label: 'Balanced', steps: 25, cfg: 7 },
  { label: 'Detail', steps: 36, cfg: 7.5 }
];

function isActiveRatio(settings, ratio) {
  return Number(settings.width) === ratio.width && Number(settings.height) === ratio.height;
}

function isActiveQuality(settings, mode) {
  return Number(settings.steps) === mode.steps && Number(settings.cfg) === mode.cfg;
}

export function GenerateForm({ settings, resources, presets, busy, onSubmit, onPatch, onUsePreset, onRefreshResources }) {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  function applyRatio(ratio) {
    onPatch('width', ratio.width);
    onPatch('height', ratio.height);
  }

  function applyQuality(mode) {
    onPatch('steps', mode.steps);
    onPatch('cfg', mode.cfg);
  }

  const selectedPreset = presets.find((preset) => preset.id === settings.presetId);

  return (
    <form onSubmit={onSubmit} className="composer">
      <section className="promptCard">
        <div className="promptTopline">
          <span>Новый кадр</span>
          <button className="ghost smallButton" type="button" onClick={onRefreshResources} aria-label="Обновить модели и пресеты">
            <RefreshCw size={16} />
          </button>
        </div>

        <label className="promptField">
          <span>Что рисуем</span>
          <textarea
            rows="6"
            value={settings.prompt}
            onChange={(e) => onPatch('prompt', e.target.value)}
            placeholder="Например: quiet sunlit kitchen, warm morning light, film still..."
          />
        </label>

        <details className="negativePrompt">
          <summary>
            Чего избегать
            <ChevronDown size={16} />
          </summary>
          <textarea
            rows="3"
            value={settings.negativePrompt}
            onChange={(e) => onPatch('negativePrompt', e.target.value)}
            placeholder="blur, bad anatomy, extra fingers..."
          />
        </details>
      </section>

      <section className="quickPanel">
        <div className="quickGroup">
          <span className="quickLabel">Формат</span>
          <div className="chipRow">
            {ratios.map((ratio) => (
              <button
                key={ratio.label}
                className={isActiveRatio(settings, ratio) ? 'chip active' : 'chip'}
                type="button"
                onClick={() => applyRatio(ratio)}
              >
                {ratio.label}
              </button>
            ))}
          </div>
        </div>

        <div className="quickGroup">
          <span className="quickLabel">Качество</span>
          <div className="chipRow">
            {qualityModes.map((mode) => (
              <button
                key={mode.label}
                className={isActiveQuality(settings, mode) ? 'chip active' : 'chip'}
                type="button"
                onClick={() => applyQuality(mode)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <button className="chip ghostChip" type="button" onClick={() => onPatch('seed', -1)}>
          Random seed
        </button>
      </section>

      <section className="advancedCard">
        <button className="advancedToggle" type="button" onClick={() => setAdvancedOpen((value) => !value)}>
          <span><SlidersHorizontal size={18} /> Лаборатория</span>
          <small>{settings.checkpoint || selectedPreset?.name || 'Модель и сэмплинг'}</small>
          <ChevronDown className={advancedOpen ? 'chevron open' : 'chevron'} size={18} />
        </button>

        {advancedOpen && (
          <div className="advancedBody">
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

            <div className="settingsBlock">
              <h3>Модель</h3>
              <div className="grid2">
                <Field label="Checkpoint">
                  <Select value={settings.checkpoint} options={resources.checkpoints} onChange={(v) => onPatch('checkpoint', v)} />
                </Field>
                <Field label="Seed" hint="-1 = случайный">
                  <input type="number" value={settings.seed} onChange={(e) => onPatch('seed', numberValue(e.target.value))} />
                </Field>
              </div>
            </div>

            <div className="settingsBlock">
              <h3>Сэмплинг</h3>
              <div className="grid2">
                <Field label="Sampler">
                  <Select value={settings.samplerName} options={resources.samplers} onChange={(v) => onPatch('samplerName', v)} />
                </Field>
                <Field label="Scheduler">
                  <Select value={settings.scheduler} options={resources.schedulers} onChange={(v) => onPatch('scheduler', v)} />
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
                <Field label="Количество">
                  <input type="number" min="1" max="8" value={settings.batchSize} onChange={(e) => onPatch('batchSize', numberValue(e.target.value))} />
                </Field>
              </div>
            </div>

            <div className="settingsBlock">
              <h3>Размер</h3>
              <div className="grid2">
                <Field label="Width">
                  <input type="number" min="64" step="8" value={settings.width} onChange={(e) => onPatch('width', numberValue(e.target.value))} />
                </Field>
                <Field label="Height">
                  <input type="number" min="64" step="8" value={settings.height} onChange={(e) => onPatch('height', numberValue(e.target.value))} />
                </Field>
              </div>
            </div>

            <LoraEditor loras={settings.loras || []} resources={resources} onChange={(loras) => onPatch('loras', loras)} />
          </div>
        )}
      </section>

      <button className="primary submitButton" disabled={busy} type="submit">
        {busy ? <Loader2 className="spin" size={19} /> : <ImagePlus size={19} />}
        {busy ? 'Рисую…' : 'Запустить генерацию'}
      </button>
    </form>
  );
}
