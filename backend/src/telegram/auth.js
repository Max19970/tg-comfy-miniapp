import crypto from 'node:crypto';
import { httpError } from '../utils/errors.js';

function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function timingSafeEqualHex(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function validateTelegramInitData(initData, config) {
  if (!config.telegram?.botToken || config.telegram.botToken.includes('PUT_TELEGRAM')) {
    throw httpError(500, 'Telegram bot token is not configured');
  }
  if (!initData) throw httpError(401, 'Telegram initData is missing');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw httpError(401, 'Telegram initData hash is missing');

  const authDate = Number(params.get('auth_date') || 0);
  const ttl = Number(config.telegram?.authTtlSeconds || 86400);
  if (ttl > 0 && (!authDate || Date.now() / 1000 - authDate > ttl)) {
    throw httpError(401, 'Telegram initData is expired');
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.telegram.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) throw httpError(401, 'Telegram initData signature is invalid');

  const user = safeJsonParse(params.get('user'), null);
  if (!user?.id) throw httpError(401, 'Telegram user is missing in initData');

  const allowed = config.telegram?.allowedUserIds || [];
  if (allowed.length && !allowed.map(String).includes(String(user.id))) {
    throw httpError(403, 'This Telegram user is not allowed');
  }

  return user;
}

export function createAuthMiddleware(config) {
  return function authMiddleware(req, res, next) {
    try {
      if (!config.telegram?.enforceAuth) {
        req.user = { id: 'dev', first_name: 'Dev' };
        return next();
      }
      const initData = req.get('X-Telegram-Init-Data') || req.query.initData;
      req.user = validateTelegramInitData(initData, config);
      next();
    } catch (error) {
      res.status(error.status || 401).json({ error: error.message || 'Unauthorized' });
    }
  };
}
