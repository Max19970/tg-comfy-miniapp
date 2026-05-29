import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findConfigPath() {
  const candidates = [
    process.env.CONFIG_PATH,
    path.resolve(process.cwd(), 'config.yaml'),
    path.resolve(process.cwd(), 'config.yml'),
    path.resolve(process.cwd(), '../config.yaml'),
    path.resolve(process.cwd(), '../config.yml'),
    path.resolve(__dirname, '../../config.yaml'),
    path.resolve(__dirname, '../../../config.yaml')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('config.yaml not found. Copy config.example.yaml to config.yaml or set CONFIG_PATH.');
}

function boolFromConfig(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.server) errors.push('server section is required');
  if (!config.comfy?.httpUrl) errors.push('comfy.httpUrl is required');
  if (!config.comfy?.wsUrl) errors.push('comfy.wsUrl is required');

  const enforceAuth = config.telegram?.enforceAuth !== false;
  const token = config.telegram?.botToken;
  if (enforceAuth && (!token || String(token).includes('PUT_TELEGRAM'))) {
    errors.push('telegram.botToken is required when telegram.enforceAuth is true');
  }

  const publicBaseUrl = String(config.server?.publicBaseUrl || '');
  if (process.env.NODE_ENV === 'production' && publicBaseUrl && !publicBaseUrl.startsWith('https://')) {
    warnings.push('server.publicBaseUrl should be HTTPS in production for Telegram Mini Apps/webhooks');
  }

  const maxHistory = Number(config.storage?.maxHistoryPerUser ?? 200);
  if (!Number.isFinite(maxHistory) || maxHistory < 1) errors.push('storage.maxHistoryPerUser must be a positive number');

  const maxConcurrentGlobal = Number(config.jobs?.maxConcurrentGlobal ?? 1);
  if (!Number.isFinite(maxConcurrentGlobal) || maxConcurrentGlobal < 1) errors.push('jobs.maxConcurrentGlobal must be a positive number');

  const maxQueuePerUser = Number(config.jobs?.maxQueuePerUser ?? 3);
  if (!Number.isFinite(maxQueuePerUser) || maxQueuePerUser < 1) errors.push('jobs.maxQueuePerUser must be a positive number');

  if (errors.length) {
    throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  }

  for (const warning of warnings) console.warn(`[config] ${warning}`);
}

export async function loadRuntimeConfig() {
  const configPath = findConfigPath();
  const appRoot = path.dirname(configPath);
  const rawConfig = await fsPromises.readFile(configPath, 'utf8');
  const config = YAML.parse(rawConfig) || {};
  validateConfig(config);

  function resolveAppPath(value) {
    if (!value) return value;
    return path.isAbsolute(value) ? value : path.resolve(appRoot, value);
  }

  const dataDir = resolveAppPath(config.storage?.dataDir || './backend/data');
  const generatedDir = path.join(dataDir, 'generated');
  const dbPath = path.join(dataDir, 'db.json');
  const frontendDist = resolveAppPath(config.server?.frontendDist || './frontend/dist');
  const presetsFile = resolveAppPath(config.presets?.file || './presets/default.json');

  return {
    config,
    configPath,
    appRoot,
    resolveAppPath,
    dataDir,
    generatedDir,
    dbPath,
    frontendDist,
    presetsFile,
    port: Number(config.server?.port || process.env.PORT || 8080),
    host: config.server?.host || '0.0.0.0',
    boolFromConfig
  };
}

export function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/$/, '');
}

export function publicBaseUrl(config) {
  return trimTrailingSlash(config.server?.publicBaseUrl || '');
}

export function miniAppUrl(config) {
  return trimTrailingSlash(config.server?.miniAppUrl || config.server?.publicBaseUrl || '');
}
