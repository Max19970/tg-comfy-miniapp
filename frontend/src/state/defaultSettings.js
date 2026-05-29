export const emptySettings = {
  prompt: '',
  negativePrompt: '',
  checkpoint: '',
  workflowType: 'sd15-text2img',
  width: 512,
  height: 512,
  batchSize: 1,
  steps: 25,
  cfg: 7,
  samplerName: 'euler',
  scheduler: 'normal',
  denoise: 1,
  seed: -1,
  loras: []
};

export function numberValue(value) {
  if (value === '' || value === null || value === undefined) return '';
  return Number(value);
}

export function variationSettings(settings) {
  return { ...settings, seed: -1 };
}
