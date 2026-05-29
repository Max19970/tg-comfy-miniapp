import { miniAppUrl } from '../config/loadConfig.js';

export class TelegramBotApi {
  constructor({ config }) {
    this.config = config;
  }

  async call(method, payload) {
    const token = this.config.telegram?.botToken;
    if (!token || token.includes('PUT_TELEGRAM')) throw new Error('Telegram bot token is not configured');
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.ok === false) throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`);
    return json;
  }

  async sendStartMessage(chatId) {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: 'Генератор картинок готов. Жми кнопку ниже, всё управление внутри mini app.',
      reply_markup: {
        inline_keyboard: [[
          { text: 'Открыть генератор', web_app: { url: miniAppUrl(this.config) } }
        ]]
      }
    });
  }
}
