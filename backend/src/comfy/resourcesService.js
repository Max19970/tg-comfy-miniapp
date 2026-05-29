export class ResourcesService {
  constructor({ comfyClient, config }) {
    this.comfyClient = comfyClient;
    this.config = config;
    this.cache = null;
    this.cacheUntil = 0;
  }

  async getResources({ refresh = false } = {}) {
    if (this.cache && !refresh && Date.now() < this.cacheUntil) return this.cache;

    const fallback = this.config.comfy?.fallback || {};
    const resources = {
      checkpoints: fallback.checkpoints || [],
      loras: fallback.loras || [],
      samplers: fallback.samplers || [],
      schedulers: fallback.schedulers || []
    };

    try {
      const [checkpointInfo, loraInfo, samplerInfo] = await Promise.all([
        this.comfyClient.json('/object_info/CheckpointLoaderSimple'),
        this.comfyClient.json('/object_info/LoraLoader'),
        this.comfyClient.json('/object_info/KSampler')
      ]);
      resources.checkpoints = checkpointInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || resources.checkpoints;
      resources.loras = loraInfo?.LoraLoader?.input?.required?.lora_name?.[0] || resources.loras;
      resources.samplers = samplerInfo?.KSampler?.input?.required?.sampler_name?.[0] || resources.samplers;
      resources.schedulers = samplerInfo?.KSampler?.input?.required?.scheduler?.[0] || resources.schedulers;
    } catch (error) {
      resources.warning = `ComfyUI object_info unavailable, fallback config is used: ${error.message}`;
    }

    this.cache = resources;
    this.cacheUntil = Date.now() + Number(this.config.comfy?.resourcesCacheTtlMs || 30000);
    return resources;
  }
}
