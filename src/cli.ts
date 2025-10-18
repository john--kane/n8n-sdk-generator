#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSDK } from './index.js';

function printHelp() {
  const script = path.basename(process.argv[1] || 'n8n-sdk-generator');
  console.log(`n8n-sdk-generator\n\n` +
    `Generate TypeScript declarations and a runtime SDK client for your n8n instance.\n\n` +
    `Usage:\n` +
    `  ${script} --url <N8N_URL> --token <API_KEY> [--out ./generated] [--timeout 10000]\n\n` +
    `Options:\n` +
    `  -u, --url       Base URL of your n8n instance (e.g., https://example.com)\n` +
    `  -t, --token     n8n API key (sent as X-N8N-API-KEY)\n` +
    `  -o, --out       Output directory (default: ./generated)\n` +
    `      --timeout   Request timeout in ms (env: N8N_FETCH_TIMEOUT_MS)\n` +
    `  -h, --help      Show this help\n\n` +
    `Environment variables as fallback:\n` +
    `  N8N_URL, N8N_TOKEN, N8N_OUTPUT, N8N_FETCH_TIMEOUT_MS\n`);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '-u' || a === '--url') {
      const next = argv[i + 1];
      if (typeof next === 'string') { i++; args.url = next; } else { args.url = ''; }
    } else if (a === '-t' || a === '--token') {
      const next = argv[i + 1];
      if (typeof next === 'string') { i++; args.token = next; } else { args.token = ''; }
    } else if (a === '-o' || a === '--out') {
      const next = argv[i + 1];
      if (typeof next === 'string') { i++; args.out = next; } else { args.out = ''; }
    } else if (a === '--timeout') {
      const next = argv[i + 1];
      if (typeof next === 'string') { i++; args.timeout = next; }
    } else if (a.startsWith('--')) {
      const replaced = a.replace(/^--/, '');
      const eqIdx = replaced.indexOf('=');
      const k = eqIdx >= 0 ? replaced.slice(0, eqIdx) : replaced;
      const v = eqIdx >= 0 ? replaced.slice(eqIdx + 1) : 'true';
      if (k) args[k] = v;
    } else {
      // ignore positional for now
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const url = (args.url as string) || process.env.N8N_URL || '';
  const token = (args.token as string) || process.env.N8N_TOKEN || '';
  const outDir = (args.out as string) || process.env.N8N_OUTPUT || './generated';

  if (!url || !token) {
    console.error('Error: --url and --token are required.');
    printHelp();
    process.exitCode = 1;
    return;
  }

  // Allow timeout override via env; generateSDK already reads env inside for requests,
  // so we only set the env var if provided via CLI
  if (args.timeout && typeof args.timeout === 'string') {
    process.env.N8N_FETCH_TIMEOUT_MS = args.timeout;
  }

  try {
    await generateSDK(url, token, outDir);
  } catch (err: any) {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  }
}

// Only run if executed directly
const isDirect = fileURLToPath(import.meta.url) === (process.argv[1] || '');
if (isDirect) {
  main();
}
