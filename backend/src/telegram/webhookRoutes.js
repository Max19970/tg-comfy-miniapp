import express from 'express';
import { asyncRoute } from '../utils/errors.js';

export function createTelegramWebhookRouter({ config, telegramBotApi }) {
  const router = express.Router();

  router.post('/webhook', asyncRoute(async (req, res) => {
    const expected = config.telegram?.webhookSecret;
    if (expected && req.get('X-Telegram-Bot-Api-Secret-Token') !== expected) {
      console.warn('[telegram] rejected webhook: bad X-Telegram-Bot-Api-Secret-Token');
      return res.status(401).json({ error: 'Bad webhook secret' });
    }

    const update = req.body;
    const message = update.message || update.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text || '';
    console.log(`[telegram] update=${update.update_id ?? 'unknown'} chat=${chatId ?? 'unknown'} text=${JSON.stringify(text)}`);

    if (chatId && text.startsWith('/start')) {
      await telegramBotApi.sendStartMessage(chatId);
      console.log(`[telegram] sent mini app button to chat=${chatId}`);
    }

    res.json({ ok: true });
  }));

  return router;
}
