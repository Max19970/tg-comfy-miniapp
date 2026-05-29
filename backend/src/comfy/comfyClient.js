export class ComfyClient {
  constructor({ httpUrl, wsUrl, requestTimeoutMs = 120000 }) {
    this.httpUrl = String(httpUrl || '').replace(/\/$/, '');
    this.wsUrl = String(wsUrl || '').replace(/\/$/, '');
    this.requestTimeoutMs = Number(requestTimeoutMs || 120000);
  }

  url(pathname, query = {}) {
    const url = new URL(`${this.httpUrl}${pathname}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    return url;
  }

  webSocketUrl(clientId) {
    const separator = this.wsUrl.includes('?') ? '&' : '?';
    return `${this.wsUrl}${separator}clientId=${encodeURIComponent(clientId)}`;
  }

  async fetch(pathnameOrUrl, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const url = pathnameOrUrl instanceof URL ? pathnameOrUrl : this.url(pathnameOrUrl);
      return await globalThis.fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async json(pathname, options = {}) {
    const response = await this.fetch(pathname, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI ${pathname} failed: ${response.status} ${text}`);
    }
    return response.json();
  }

  async submitPrompt({ workflow, clientId }) {
    const response = await this.json('/prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });
    if (!response.prompt_id) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(response)}`);
    return response.prompt_id;
  }

  async history(promptId) {
    return this.json(`/history/${encodeURIComponent(promptId)}`);
  }

  async interrupt() {
    return this.json('/interrupt', { method: 'POST', body: JSON.stringify({}) });
  }
}
