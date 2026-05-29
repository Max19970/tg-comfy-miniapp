import fs from 'node:fs/promises';
import path from 'node:path';

const NON_TERMINAL_STATUSES = new Set(['queued', 'submitting', 'running', 'finalizing', 'cancelling']);

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return { generations: [] };
}

export class JsonGenerationRepository {
  constructor({ dbPath, maxHistoryPerUser = 200, flushDelayMs = 250 }) {
    this.dbPath = dbPath;
    this.maxHistoryPerUser = Number(maxHistoryPerUser || 200);
    this.flushDelayMs = Number(flushDelayMs || 250);
    this.db = emptyDb();
    this.flushTimer = null;
    this.flushPromise = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    try {
      const raw = await fs.readFile(this.dbPath, 'utf8');
      this.db = JSON.parse(raw) || emptyDb();
      if (!Array.isArray(this.db.generations)) this.db.generations = [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.db = emptyDb();
      await this.flush();
    }
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((error) => console.error('[storage] failed to flush db:', error));
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushPromise = this.flushPromise.then(async () => {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      const tmp = `${this.dbPath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.db, null, 2));
      await fs.rename(tmp, this.dbPath);
    });

    return this.flushPromise;
  }

  prune() {
    const byUser = new Map();
    this.db.generations = this.db.generations
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .filter((item) => {
        const key = String(item.userId || 'anonymous');
        const count = byUser.get(key) || 0;
        if (count >= this.maxHistoryPerUser) return false;
        byUser.set(key, count + 1);
        return true;
      });
  }

  async upsertGeneration(record, { flush = false } = {}) {
    const index = this.db.generations.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      this.db.generations[index] = { ...this.db.generations[index], ...record, updatedAt: nowIso() };
    } else {
      this.db.generations.unshift({ ...record, createdAt: record.createdAt || nowIso(), updatedAt: nowIso() });
    }
    this.prune();
    if (flush) await this.flush();
    else this.scheduleFlush();
    return this.getGeneration(record.id, record.userId);
  }

  async getGeneration(id, userId) {
    const item = this.db.generations.find((generation) => generation.id === id && String(generation.userId) === String(userId));
    return item ? structuredClone(item) : null;
  }

  async getGenerationAnyUser(id) {
    const item = this.db.generations.find((generation) => generation.id === id);
    return item ? structuredClone(item) : null;
  }

  async listGenerations(userId, { favorite, status, search } = {}) {
    const normalizedSearch = String(search || '').trim().toLowerCase();
    return this.db.generations
      .filter((item) => String(item.userId) === String(userId))
      .filter((item) => favorite === undefined ? true : Boolean(item.favorite) === Boolean(favorite))
      .filter((item) => status ? item.status === status : true)
      .filter((item) => {
        if (!normalizedSearch) return true;
        const haystack = [
          item.settings?.prompt,
          item.settings?.negativePrompt,
          item.settings?.checkpoint,
          item.settings?.samplerName,
          item.settings?.scheduler,
          item.settings?.seed
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map((item) => structuredClone(item));
  }

  async toggleFavorite(id, userId, favorite) {
    const item = await this.getGeneration(id, userId);
    if (!item) return null;
    const nextFavorite = favorite === undefined ? !item.favorite : Boolean(favorite);
    return this.upsertGeneration({ id, userId, favorite: nextFavorite }, { flush: true });
  }

  async markNonTerminalAsFailed(reason = 'Backend restarted before the generation completed') {
    let changed = false;
    for (const item of this.db.generations) {
      if (NON_TERMINAL_STATUSES.has(item.status)) {
        item.status = 'failed';
        item.error = reason;
        item.updatedAt = nowIso();
        changed = true;
      }
    }
    if (changed) await this.flush();
  }

  async findImageForUser(id, userId, filename) {
    const item = await this.getGeneration(id, userId);
    if (!item) return null;
    const image = (item.images || []).find((candidate) => candidate.localName === filename || candidate.filename === filename);
    return image ? { generation: item, image } : null;
  }
}
