import { loadConfig, telegram } from './_config.js';

function trimSlash(value = '') {
  return String(value || '').replace(/\/$/, '');
}

function resolveToken(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.startsWith('env:')) return process.env[text.slice(4)] || '';
  return text;
}

function buildCloudflaredPreview(config) {
  const cf = config.cloudflare || {};
  const executable = cf.executable || process.env.CLOUDFLARED_BIN || 'cloudflared';
  const args = ['tunnel'];
  if (cf.configFile) args.push('--config', cf.configFile);
  if (cf.logLevel) args.push('--loglevel', String(cf.logLevel));
  if (Array.isArray(cf.extraArgsBeforeRun)) args.push(...cf.extraArgsBeforeRun.map(String));
  args.push('run');
  const token = resolveToken(cf.token || process.env.CLOUDFLARED_TOKEN);
  if (token) args.push('--token', '<hidden>');
  if (Array.isArray(cf.extraArgsAfterRun)) args.push(...cf.extraArgsAfterRun.map(String));
  if (cf.tunnelName && !token) args.push(String(cf.tunnelName));
  return `${executable} ${args.join(' ')}`;
}

async function tryFetch(label, url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    const shortText = text.length > 500 ? `${text.slice(0, 500)}...` : text;
    console.log(`\n[${label}] ${response.status} ${response.statusText}`);
    console.log(shortText || '(empty response)');
    return response.ok;
  } catch (error) {
    console.log(`\n[${label}] FAILED`);
    console.log(error.message);
    return false;
  }
}

const config = loadConfig();
const publicBaseUrl = trimSlash(config.server?.publicBaseUrl);
const localUrl = `http://127.0.0.1:${Number(config.server?.port || process.env.PORT || 8080)}`;

console.log('tg-comfy-miniapp setup check');
console.log('----------------------------');
console.log(`publicBaseUrl: ${publicBaseUrl || '(missing)'}`);
console.log(`miniAppUrl:    ${trimSlash(config.server?.miniAppUrl || config.server?.publicBaseUrl) || '(missing)'}`);
console.log(`localUrl:      ${localUrl}`);
console.log(`comfy.httpUrl: ${config.comfy?.httpUrl || '(missing)'}`);
console.log(`comfy.wsUrl:   ${config.comfy?.wsUrl || '(missing)'}`);
console.log(`enforceAuth:   ${config.telegram?.enforceAuth !== false}`);
console.log(`cf.autoStart:  ${config.cloudflare?.autoStart === true}`);
if (config.cloudflare?.autoStart) {
  console.log(`cf.command:    ${buildCloudflaredPreview(config)}`);
}

if (!publicBaseUrl.startsWith('https://')) {
  console.log('\n[config] WARNING: server.publicBaseUrl must be public HTTPS for Telegram webhook and Mini App.');
}

await tryFetch('local backend /api/health', `${localUrl}/api/health`);
if (publicBaseUrl) await tryFetch('public backend /api/health', `${publicBaseUrl}/api/health`);

try {
  const info = await telegram('getWebhookInfo', {}, config);
  console.log('\n[telegram getWebhookInfo]');
  console.log(JSON.stringify(info.result, null, 2));
  const expectedUrl = `${publicBaseUrl}/telegram/webhook`;
  if (info.result?.url && publicBaseUrl && info.result.url !== expectedUrl) {
    console.log(`\n[telegram] WARNING: webhook URL is ${info.result.url}, expected ${expectedUrl}`);
  }
  if (info.result?.last_error_message) {
    console.log(`\n[telegram] LAST ERROR: ${info.result.last_error_message}`);
  }
} catch (error) {
  console.log('\n[telegram getWebhookInfo] FAILED');
  console.log(error.message);
}

if (config.comfy?.httpUrl) {
  await tryFetch('ComfyUI /object_info/KSampler', `${trimSlash(config.comfy.httpUrl)}/object_info/KSampler`);
}
