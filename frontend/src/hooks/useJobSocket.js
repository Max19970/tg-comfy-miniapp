import React from 'react';

function wsUrl(jobId, initData) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws?jobId=${encodeURIComponent(jobId)}&initData=${encodeURIComponent(initData)}`;
}

export function useJobSocket({ initData, onJob, onPreview, onError }) {
  const wsRef = React.useRef(null);
  const reconnectTimer = React.useRef(null);
  const currentJobId = React.useRef(null);

  React.useEffect(() => () => {
    wsRef.current?.close?.();
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
  }, []);

  const connect = React.useCallback((jobId) => {
    currentJobId.current = jobId;
    wsRef.current?.close?.();

    const open = () => {
      const socket = new WebSocket(wsUrl(jobId, initData));
      wsRef.current = socket;

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'job') onJob?.(message.job);
        if (message.type === 'preview') onPreview?.(message.preview);
      };

      socket.onerror = () => onError?.('WebSocket прогресса отвалился. Генерация может продолжаться на сервере.');

      socket.onclose = () => {
        if (currentJobId.current !== jobId) return;
        reconnectTimer.current = setTimeout(open, 1500);
      };
    };

    open();
  }, [initData, onError, onJob, onPreview]);

  const disconnect = React.useCallback(() => {
    currentJobId.current = null;
    wsRef.current?.close?.();
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
  }, []);

  return { connect, disconnect };
}
