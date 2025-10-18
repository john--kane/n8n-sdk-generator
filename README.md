# n8n-sdk-generator

Generate TypeScript declarations and a small runtime SDK client for your n8n instance, discoverable via CLI (and npx once published).

This tool connects to your n8n instance using its REST API, discovers webhook nodes across workflows, and emits:
- generated/n8n-types.ts — exported TypeScript type aliases for request/response payloads per webhook
- generated/n8n-sdk.d.ts — ambient declarations for a typed N8nService interface and endpoint metadata (referencing types from n8n-types.ts)
- generated/endpoints.md — a human‑readable summary of discovered endpoints
- generated/n8n-sdk-client.ts — a lightweight runtime client with one method per discovered webhook and a generic callWebhook helper

## Requirements
- Node.js 18+ (uses the built‑in fetch API)
- An n8n instance reachable from where you run the generator
- An n8n API key (sent as X-N8N-API-KEY)

## Install
You can run the generator without installing globally. From the project root:

- Build from source:
  - pnpm install
  - pnpm run build
  - pnpm start -- --url https://your-n8n.example.com --token YOUR_API_KEY

Once published to npm, you’ll also be able to run:
- npx n8n-sdk-generator --url https://your-n8n.example.com --token YOUR_API_KEY

## CLI Usage
After building, the CLI is available at dist/cli.js and wired via the bin field. Run --help for details:

node dist/cli.js --help

Usage:
  n8n-sdk-generator --url <N8N_URL> --token <API_KEY> [--out ./generated] [--timeout 10000]

Options:
- -u, --url        Base URL of your n8n instance (e.g., https://example.com)
- -t, --token      n8n API key (sent as X-N8N-API-KEY)
- -o, --out        Output directory (default: ./generated)
-     --timeout    Request timeout in ms (also configurable via env)
- -h, --help       Show help

Environment variable fallbacks:
- N8N_URL — base URL of your n8n instance
- N8N_TOKEN — n8n API key
- N8N_OUTPUT — output directory (default: ./generated)
- N8N_FETCH_TIMEOUT_MS (or N8N_TIMEOUT_MS) — request timeout in ms

Examples:
- Basic generation to default ./generated:
  n8n-sdk-generator --url https://example.com --token sk_live_abc123

- Custom output directory and timeout:
  n8n-sdk-generator --url https://example.com --token sk_live_abc123 --out ./sdk --timeout 15000

- Using environment variables:
  export N8N_URL=https://example.com
  export N8N_TOKEN=sk_live_abc123
  export N8N_OUTPUT=./generated
  export N8N_FETCH_TIMEOUT_MS=10000
  n8n-sdk-generator

## What gets generated
Inside the chosen output directory (default ./generated):

1) n8n-types.ts
- Exported type aliases for request/response pairs per webhook (uses `type` instead of `interface`)

2) n8n-sdk.d.ts
- Ambient declarations for a typed N8nService interface with one method per webhook
- A union type enumerating endpoint metadata for your specific instance
- References request/response types from n8n-types.ts

3) endpoints.md
- A simple table summarizing Method, Path, Label, MethodName, and Type names

4) n8n-sdk-client.ts
- A tiny fetch‑based client class N8nClient with one method per webhook
- A helper callWebhook(url, method?, body?, timeoutMs?) for ad‑hoc calls

## Using the generated SDK client
Import the generated client into your app and call your webhooks with types:

import { N8nClient } from './generated/n8n-sdk-client';

// Optionally override baseUrl, add token for protected instances, etc.
const client = new N8nClient({
  // Defaults to the base URL captured at generation time; you can override:
  baseUrl: process.env.N8N_BASE_URL,
  token: process.env.N8N_API_KEY, // sent as X-N8N-API-KEY
  timeoutMs: 10000,
});

// Call a generated method (name depends on your workflow node labels)
const res = await client.WebhookPost({ data: { hello: 'world' } });
console.log(res);

// Or use the generic helper with a full URL
import { callWebhook } from './generated/n8n-sdk-client';
const raw = await callWebhook('https://example.com/webhook/abcd-1234', 'POST', { any: 'json' });

Notes:
- Methods and type names are derived from your webhook node labels and HTTP methods; see generated/endpoints.md for an overview.
- The client sends Content-Type: application/json and Accept: application/json by default.

## Troubleshooting
- Error: --url and --token are required.
  - Provide them as CLI flags or via N8N_URL and N8N_TOKEN env vars.
- Request timed out
  - Increase --timeout or set N8N_FETCH_TIMEOUT_MS to a higher value.
- No webhook nodes found
  - The tool will warn and still generate placeholder types; verify your n8n workflows have webhook nodes and that your token can list workflows.
- Invalid N8N URL
  - Ensure --url is a valid absolute URL including protocol (https://...).

## Development
- Build: pnpm run build
- Dev (TS loader): pnpm run dev
- Start (built CLI): pnpm start

Project structure highlights:
- src/index.ts — core generator (fetches workflows, builds outputs)
- src/cli.ts — CLI entrypoint (parses flags/env and calls generateSDK)
- generated/ — default output directory for artifacts

## License
ISC
