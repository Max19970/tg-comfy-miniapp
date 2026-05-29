import fs from 'node:fs/promises';

export class PresetsService {
  constructor({ presetsFile, defaultSettings }) {
    this.presetsFile = presetsFile;
    this.defaultSettings = defaultSettings;
    this.cache = null;
    this.loadedAt = 0;
  }

  async listPresets({ refresh = false } = {}) {
    if (this.cache && !refresh && Date.now() - this.loadedAt < 30000) return this.cache;

    try {
      const raw = await fs.readFile(this.presetsFile, 'utf8');
      const parsed = JSON.parse(raw);
      const presets = Array.isArray(parsed) ? parsed : parsed.presets || [];
      this.cache = presets.map((preset) => ({
        id: String(preset.id),
        name: String(preset.name || preset.id),
        description: preset.description || '',
        settings: { ...this.defaultSettings, ...(preset.settings || {}) }
      }));
      this.loadedAt = Date.now();
      return this.cache;
    } catch (error) {
      this.cache = [];
      this.loadedAt = Date.now();
      this.warning = `Presets file unavailable: ${error.message}`;
      return this.cache;
    }
  }
}
