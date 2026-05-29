import React from 'react';

export function useTelegram() {
  return React.useMemo(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready?.();
    tg?.expand?.();
    const initData = tg?.initData || new URLSearchParams(window.location.search).get('initData') || '';
    const colorScheme = tg?.colorScheme || 'dark';
    document.documentElement.dataset.theme = colorScheme;
    return { tg, initData, colorScheme };
  }, []);
}
