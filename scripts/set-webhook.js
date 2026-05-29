import { loadConfig, telegram } from './_config.js';

const config = loadConfig();
const publicBaseUrl = String(config.server?.publicBaseUrl || '').replace(/\/$/, '');
if (!publicBaseUrl.startsWith('https://')) {
  throw new Error('server.publicBaseUrl must be a public HTTPS URL for Telegram Web Apps/webhooks.');
}

const url = `${publicBaseUrl}/telegram/webhook`;
const result = await telegram('setWebhook', {
  url,
  secret_token: config.telegram?.webhookSecret || undefined,
  allowed_updates: ['message', 'edited_message']
}, config);

console.log(`Webhook set: ${url}`);
console.log(JSON.stringify(result, null, 2));
