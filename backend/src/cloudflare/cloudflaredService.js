import { spawn } from 'node:child_process';

function maskSecret(value) {
  if (!value) return value;
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function resolveCloudflaredToken(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (text.startsWith('env:')) return process.env[text.slice(4)] || '';
  return text;
}

export class CloudflaredService {
  constructor({ config, appRoot, resolveAppPath, boolFromConfig }) {
    this.config = config;
    this.appRoot = appRoot;
    this.resolveAppPath = resolveAppPath;
    this.boolFromConfig = boolFromConfig;
    this.process = null;
    this.stopping = false;
  }

  buildCommand() {
    const cf = this.config.cloudflare || {};
    const executable = cf.executable || process.env.CLOUDFLARED_BIN || 'cloudflared';
    const args = ['tunnel'];

    if (cf.configFile) args.push('--config', this.resolveAppPath(cf.configFile));
    if (cf.logLevel) args.push('--loglevel', String(cf.logLevel));
    if (Array.isArray(cf.extraArgsBeforeRun)) args.push(...cf.extraArgsBeforeRun.map(String));

    args.push('run');

    const token = resolveCloudflaredToken(cf.token || process.env.CLOUDFLARED_TOKEN);
    if (token) args.push('--token', token);
    if (Array.isArray(cf.extraArgsAfterRun)) args.push(...cf.extraArgsAfterRun.map(String));
    if (cf.tunnelName && !token) args.push(String(cf.tunnelName));

    const safeArgs = args.map((arg, index) => args[index - 1] === '--token' ? maskSecret(arg) : arg);
    return { executable, args, safeArgs };
  }

  start() {
    const cf = this.config.cloudflare || {};
    const autoStart = this.boolFromConfig(cf.autoStart, false);
    if (!autoStart) {
      console.log('[cloudflared] autostart disabled');
      return;
    }
    if (this.process) return;

    const { executable, args, safeArgs } = this.buildCommand();
    console.log(`[cloudflared] starting: ${executable} ${safeArgs.join(' ')}`);

    this.process = spawn(executable, args, {
      cwd: this.appRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.stdout?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) console.log(`[cloudflared] ${line}`);
    });

    this.process.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) console.error(`[cloudflared] ${line}`);
    });

    this.process.on('error', (error) => {
      console.error(`[cloudflared] failed to start: ${error.message}`);
      console.error('[cloudflared] Check cloudflare.executable in config.yaml or add cloudflared to PATH.');
      this.process = null;
    });

    this.process.on('exit', (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.log(`[cloudflared] exited with ${reason}`);
      this.process = null;
      if (!this.stopping && this.boolFromConfig(cf.restartOnExit, false)) {
        const delayMs = Number(cf.restartDelayMs || 5000);
        console.log(`[cloudflared] restarting in ${delayMs}ms`);
        setTimeout(() => {
          if (!this.stopping) this.start();
        }, delayMs);
      }
    });
  }

  stop() {
    this.stopping = true;
    if (!this.process) return;
    console.log('[cloudflared] stopping...');
    try {
      this.process.kill('SIGTERM');
    } catch (error) {
      console.error(`[cloudflared] failed to stop gracefully: ${error.message}`);
    }

    const processToKill = this.process;
    setTimeout(() => {
      if (processToKill && !processToKill.killed) {
        try {
          console.log('[cloudflared] force stopping...');
          processToKill.kill('SIGKILL');
        } catch {}
      }
    }, 5000).unref?.();
  }
}
