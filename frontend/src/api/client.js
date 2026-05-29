export function createApiClient(initData) {
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
        ...(options.headers || {})
      }
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return json;
  }

  return {
    getConfig: () => api('/api/config'),
    getResources: (refresh = false) => api(`/api/comfy/resources${refresh ? '?refresh=1' : ''}`),
    getPresets: (refresh = false) => api(`/api/presets${refresh ? '?refresh=1' : ''}`),
    getHistory: ({ search = '', favorite = false, status = '' } = {}) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (favorite) params.set('favorite', '1');
      if (status) params.set('status', status);
      return api(`/api/history${params.size ? `?${params}` : ''}`);
    },
    generate: (settings) => api('/api/generate', { method: 'POST', body: JSON.stringify(settings) }),
    cancelJob: (id) => api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) }),
    setFavorite: (id, favorite) => api(`/api/history/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: JSON.stringify({ favorite }) })
  };
}

export function authorizedImageUrl(url, initData) {
  if (!url || !url.startsWith('/api/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}initData=${encodeURIComponent(initData || '')}`;
}
