import fs from 'node:fs/promises';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findNodeId(workflow, classType) {
  const entry = Object.entries(workflow).find(([, node]) => node.class_type === classType);
  return entry?.[0];
}

function findTextNodes(workflow) {
  return Object.entries(workflow)
    .filter(([, node]) => node.class_type === 'CLIPTextEncode')
    .map(([id]) => id);
}

export class Sd15Text2ImgAdapter {
  constructor({ workflowFile }) {
    this.type = 'sd15-text2img';
    this.workflowFile = workflowFile;
  }

  async loadTemplate() {
    const raw = await fs.readFile(this.workflowFile, 'utf8');
    return JSON.parse(raw);
  }

  async build(settings) {
    const workflow = deepClone(await this.loadTemplate());
    const checkpointNode = findNodeId(workflow, 'CheckpointLoaderSimple');
    const latentNode = findNodeId(workflow, 'EmptyLatentImage');
    const textNodes = findTextNodes(workflow);
    const positiveNode = textNodes[0];
    const negativeNode = textNodes[1] || textNodes[0];
    const samplerNode = findNodeId(workflow, 'KSampler');
    const saveNode = findNodeId(workflow, 'SaveImage');

    for (const [name, id] of Object.entries({ checkpointNode, latentNode, positiveNode, negativeNode, samplerNode, saveNode })) {
      if (!id) throw new Error(`Workflow template does not contain required node: ${name}`);
    }

    workflow[checkpointNode].inputs.ckpt_name = settings.checkpoint;
    workflow[latentNode].inputs.width = settings.width;
    workflow[latentNode].inputs.height = settings.height;
    workflow[latentNode].inputs.batch_size = settings.batchSize;
    workflow[positiveNode].inputs.text = settings.prompt;
    workflow[negativeNode].inputs.text = settings.negativePrompt;

    let currentModel = [checkpointNode, 0];
    let currentClip = [checkpointNode, 1];
    let nextId = Math.max(...Object.keys(workflow).map((id) => Number(id)).filter(Number.isFinite)) + 1;

    for (const lora of settings.loras || []) {
      const id = String(nextId++);
      workflow[id] = {
        class_type: 'LoraLoader',
        inputs: {
          model: currentModel,
          clip: currentClip,
          lora_name: lora.name,
          strength_model: lora.strengthModel,
          strength_clip: lora.strengthClip
        }
      };
      currentModel = [id, 0];
      currentClip = [id, 1];
    }

    workflow[positiveNode].inputs.clip = currentClip;
    workflow[negativeNode].inputs.clip = currentClip;

    Object.assign(workflow[samplerNode].inputs, {
      seed: settings.seed,
      steps: settings.steps,
      cfg: settings.cfg,
      sampler_name: settings.samplerName,
      scheduler: settings.scheduler,
      denoise: settings.denoise,
      model: currentModel
    });

    workflow[saveNode].inputs.filename_prefix = `tg_comfy/${settings.seed}`;
    return workflow;
  }
}
