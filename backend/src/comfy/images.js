import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFilename } from '../utils/files.js';

export function parseHistoryImages(history, promptId) {
  const item = history?.[promptId] || history;
  const outputs = item?.outputs || {};
  const images = [];
  for (const output of Object.values(outputs)) {
    for (const image of output.images || []) {
      images.push({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output'
      });
    }
  }
  return images;
}

export class ComfyImageDownloader {
  constructor({ comfyClient, generatedDir }) {
    this.comfyClient = comfyClient;
    this.generatedDir = generatedDir;
  }

  async downloadImages({ jobId, promptId, images }) {
    const jobDir = path.join(this.generatedDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const result = [];

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const url = this.comfyClient.url('/view', image);
      const response = await this.comfyClient.fetch(url);
      if (!response.ok) throw new Error(`Failed to download image from ComfyUI: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const localName = `${index + 1}-${sanitizeFilename(image.filename)}`;
      await fs.writeFile(path.join(jobDir, localName), buffer);
      result.push({
        url: `/api/history/${jobId}/images/${encodeURIComponent(localName)}`,
        localName,
        filename: image.filename,
        subfolder: image.subfolder,
        type: image.type,
        promptId
      });
    }

    return result;
  }
}
