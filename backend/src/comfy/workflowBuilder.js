import { Sd15Text2ImgAdapter } from './workflows/sd15Text2ImgAdapter.js';

export class WorkflowBuilder {
  constructor({ config, resolveAppPath }) {
    const sd15WorkflowFile = resolveAppPath(config.comfy?.workflowFile || './workflows/sd15-basic.json');
    this.adapters = new Map([
      ['sd15-text2img', new Sd15Text2ImgAdapter({ workflowFile: sd15WorkflowFile })]
    ]);
  }

  listWorkflowTypes() {
    return Array.from(this.adapters.keys());
  }

  async build(settings) {
    const type = settings.workflowType || 'sd15-text2img';
    const adapter = this.adapters.get(type);
    if (!adapter) throw new Error(`Unsupported workflow type: ${type}`);
    return adapter.build(settings);
  }
}
