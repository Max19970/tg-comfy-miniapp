import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export function loadConfig() {
  const configPath = process.env.CONFIG_PATH || path.resolve(process.cwd(), 'config.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}. Copy config.example.yaml to config.yaml.`);
  }
  return YAML.parse(fs.readFileSync(configPath, 'utf8'));
}

export async function telegram(method, payload, config) {
  const token = config.telegram?.botToken;
  if (!token || token.includes('PUT_TELEGRAM')) throw new Error('telegram.botToken is not configured in config.yaml');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(`${method} failed: ${JSON.stringify(json, null, 2)}`);
  return json;
}
