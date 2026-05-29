import crypto from 'node:crypto';
import { clampNumber, multipleOfEight } from '../utils/numbers.js';

export function createDefaultSettings(config) {
  return {
    prompt: 'a cinematic photo of a cozy robot artist, highly detailed',
    negativePrompt: 'low quality, blurry, watermark, text',
    checkpoint: config.comfy?.fallback?.checkpoints?.[0] || '',
    workflowType: config.comfy?.defaultWorkflowType || 'sd15-text2img',
    width: 512,
    height: 512,
    batchSize: 1,
    steps: 25,
    cfg: 7,
    samplerName: config.comfy?.fallback?.samplers?.[0] || 'euler',
    scheduler: config.comfy?.fallback?.schedulers?.[0] || 'normal',
    denoise: 1,
    seed: -1,
    loras: []
  };
}

export function normalizeSettings(input = {}, defaultSettings) {
  const seedInput = Number(input.seed);
  const seed = Number.isFinite(seedInput) && seedInput >= 0
    ? Math.floor(seedInput)
    : crypto.randomInt(0, 2 ** 32 - 1);

  const loras = Array.isArray(input.loras)
    ? input.loras
      .filter((lora) => lora && String(lora.name || '').trim())
      .slice(0, 12)
      .map((lora) => ({
        name: String(lora.name).trim(),
        strengthModel: clampNumber(lora.strengthModel, -5, 5, 0.75),
        strengthClip: clampNumber(lora.strengthClip, -5, 5, 0.75)
      }))
    : [];

  return {
    workflowType: String(input.workflowType || defaultSettings.workflowType || 'sd15-text2img'),
    prompt: String(input.prompt || defaultSettings.prompt).slice(0, 8000),
    negativePrompt: String(input.negativePrompt ?? defaultSettings.negativePrompt).slice(0, 8000),
    checkpoint: String(input.checkpoint || defaultSettings.checkpoint),
    width: multipleOfEight(input.width, defaultSettings.width),
    height: multipleOfEight(input.height, defaultSettings.height),
    batchSize: Math.floor(clampNumber(input.batchSize, 1, 8, defaultSettings.batchSize)),
    steps: Math.floor(clampNumber(input.steps, 1, 150, defaultSettings.steps)),
    cfg: clampNumber(input.cfg, 0, 30, defaultSettings.cfg),
    samplerName: String(input.samplerName || defaultSettings.samplerName),
    scheduler: String(input.scheduler || defaultSettings.scheduler),
    denoise: clampNumber(input.denoise, 0, 1, defaultSettings.denoise),
    seed,
    loras
  };
}

export function makeVariationSettings(settings) {
  return { ...settings, seed: -1 };
}
