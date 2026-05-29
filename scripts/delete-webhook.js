import { loadConfig, telegram } from './_config.js';

const config = loadConfig();
const result = await telegram('deleteWebhook', { drop_pending_updates: false }, config);
console.log('Webhook deleted');
console.log(JSON.stringify(result, null, 2));
