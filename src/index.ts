import fs from 'fs/promises';
import path from 'path';

import {fetchWithTimeout, getTimeoutMs, isNonEmptyString, normalizeBaseUrl, safeJson} from "./functions.js";
import type {Webhook} from "./interfaces.js";
import * as console from "node:console";

export async function generateSDK(n8nUrl: string, token: string, outputDir: string): Promise<void> {
    // Validate inputs
    if (!isNonEmptyString(n8nUrl)) {
        throw new Error('N8N URL is required (set N8N_URL or pass a non-empty string).');
    }
    if (!isNonEmptyString(token)) {
        throw new Error('N8N token is required (set N8N_TOKEN or pass a non-empty string).');
    }
    if (!isNonEmptyString(outputDir)) {
        throw new Error('Output directory is required.');
    }

    let baseUrl: string;
    try {
        baseUrl = normalizeBaseUrl(n8nUrl);
    } catch (e: any) {
        throw new Error(`Invalid N8N URL: ${e?.message || String(e)}`);
    }

    console.log(`Generating SDK for ${baseUrl}`);

    const headers = {
        // Authorization: `Bearer ${token}`,
        "Accept": 'application/json',
        "X-N8N-API-KEY": token
    } as  const;

    // Fetch workflows list
    let workflowsData: any;
    try {
        // add timeout of 10 seconds (configurable via N8N_FETCH_TIMEOUT_MS)
        const timeoutMs = getTimeoutMs();
        const workflowsRes = await fetchWithTimeout(`${baseUrl}/api/v1/workflows`, { headers }, timeoutMs);
        if (!workflowsRes.ok) {
            throw new Error(`HTTP ${workflowsRes.status} ${workflowsRes.statusText}`);
        }
        workflowsData = await safeJson<{ data: any[] }>(workflowsRes);
    } catch (err: any) {
        if (err?.name === 'AbortError') {
            throw new Error(`Request to ${baseUrl}/api/v1/workflows timed out after ${getTimeoutMs()} ms`);
        }
        throw new Error(`Failed to fetch workflows from ${baseUrl}/api/v1/workflows: ${err?.message || String(err)}`);
    }

    const workflowsArray: any[] = Array.isArray(workflowsData?.data) ? workflowsData.data : [];

    if (!Array.isArray(workflowsData?.data)) {
        console.warn('Warning: Unexpected workflows response shape; proceeding with empty list.');
    }

    const webhooks: Webhook[] = [];
    let detailErrors = 0;

    for (const wf of workflowsArray) {
        const id = wf?.id ?? wf?.workflowId ?? wf?.uid;
        if (id == null) {
            continue;
        }
        try {
            const detailRes = await fetchWithTimeout(`${baseUrl}/api/v1/workflows/${id}`, { headers });
            if (!detailRes.ok) {
                detailErrors++;
                console.warn(`Warning: Failed to fetch workflow ${id}: HTTP ${detailRes.status} ${detailRes.statusText}`);
                continue;
            }
            const detail = await safeJson<any>(detailRes);
            const nodes = Array.isArray(detail?.nodes) ? detail.nodes : [];
            const webhookNodes = nodes.filter((n: any) => n?.type === 'n8n-nodes-base.webhook');

            for (const node of webhookNodes) {
                const webhookPath = node?.parameters?.path || '/';
                const method = node?.parameters?.httpMethod?.toLowerCase?.() || 'post';
                const inputType = node?.parameters?.options?.schema ? '/* TODO: Define specific message type */' : 'any';
                const label = (node?.name && typeof node.name === 'string') ? node.name : '';
                webhooks.push({ path: webhookPath, method, inputType, label });
            }
        } catch (err: any) {
            detailErrors++;
            console.warn(`Warning: Error while processing workflow ${id}: ${err?.message || String(err)}`);
            continue;
        }
    }

    if (webhooks.length === 0) {
        console.warn('No webhook nodes found across workflows. The generated declarations will contain an empty service.');
        // Add a synthetic default endpoint so the service is not empty
        webhooks.push({ path: '/', method: 'post', inputType: 'any', label: 'Root' });
    }

    // Prepare TypeScript declaration generation
    type Endpoint = {
        methodName: string;
        requestTypeName: string;
        responseTypeName: string;
        method: string;
        path: string;
        label: string;
        fullUrl: string;
        baseName: string;
    };

    const endpoints: Endpoint[] = [];

    function normalizeToInterfaceBaseName(input: string): string {
        let s = (input ?? '').trim();
        if (!s) return '';
        try {
            // Remove diacritics
            s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        } catch {}
        const parts = s.replace(/[^A-Za-z0-9]+/g, ' ').split(' ').filter(Boolean);
        if (parts.length === 0) return '';
        let name = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
        // Ensure it starts with a letter or underscore
        name = name.replace(/^[^A-Za-z_]+/, '');
        if (!name) name = 'UnknownWebhook';
        return name;
    }

    for (const wh of webhooks) {
        const sanitizedPath = wh.path === '/' ? 'Root' : wh.path.replace(/^\//, '').replace(/\//g, '_').replace(/-/g, '').replace(/^./, c => c.toUpperCase());
        const methodType = wh.method.charAt(0).toUpperCase() + wh.method.slice(1);
        const methodName = `${methodType}${sanitizedPath}`;

        const interfaceBase = normalizeToInterfaceBaseName(wh.label) || `${methodType}${sanitizedPath}`;
        const methodDisplay = `${interfaceBase}${methodType}`;

        const requestTypeName = `${interfaceBase}${methodType}Request`;
        const responseTypeName = `${interfaceBase}${methodType}Response`;
        const pathWithSlash = wh.path.startsWith('/') ? wh.path : `/${wh.path}`;
        const fullUrl = `${baseUrl}/webhook${pathWithSlash}`;
        endpoints.push({ methodName: methodDisplay, requestTypeName, responseTypeName, method: wh.method, path: wh.path, label: wh.label, fullUrl, baseName: interfaceBase });
    }

    function renderTypesTs(): string {
        let out = '';
        out += `// Auto-generated by n8n-sdk-generator. Do not edit manually.\n`;
        out += `// Request/Response types for n8n webhooks.\n\n`;
        out += `export type AnyJson = unknown;\n\n`;
        const emittedReq = new Set<string>();
        const emittedRes = new Set<string>();
        for (const ep of endpoints) {
            if (!emittedReq.has(ep.requestTypeName)) {
                const labelLine = ep.label ? ` * Label: ${ep.label}\n` : '';
                out += `/**\n${labelLine} * Method: ${ep.method.toUpperCase()}\n * Path: ${ep.path}\n * Full URL: ${ep.fullUrl}\n */\n`;
                out += `export type ${ep.requestTypeName} = {\n  data?: AnyJson;\n};\n\n`;
                emittedReq.add(ep.requestTypeName);
            }
            if (!emittedRes.has(ep.responseTypeName)) {
                const labelLine = ep.label ? ` * Label: ${ep.label}\n` : '';
                out += `/**\n${labelLine} * Method: ${ep.method.toUpperCase()}\n * Path: ${ep.path}\n * Full URL: ${ep.fullUrl}\n */\n`;
                out += `export type ${ep.responseTypeName} = {\n  result?: AnyJson;\n};\n\n`;
                emittedRes.add(ep.responseTypeName);
            }
        }
        return out;
    }

    function renderDts(pkgName = 'n8n'): string {
        let out = '';
        out += `// Auto-generated by n8n-sdk-generator. Do not edit manually.\n`;
        out += `// Package: ${pkgName}\n\n`;
        // Import request/response types from the generated module file
        const typeNames = Array.from(new Set(endpoints.flatMap(ep => [ep.requestTypeName, ep.responseTypeName])));
        if (typeNames.length > 0) {
            out += `import type { ${typeNames.join(', ')} } from './n8n-types';\n\n`;
        }
        // Service interface
        out += `export interface N8nService {\n`;
        for (const ep of endpoints) {
            console.log(ep)
            const labelLine = ep.label ? ` // ${ep.label}` : '';
            out += `  ${ep.methodName}(req: ${ep.requestTypeName}): Promise<${ep.responseTypeName}>;${labelLine}\n`;
        }
        out += `}\n\n`;
        // Endpoint metadata with full URLs
        out += `// Endpoint metadata for this n8n instance (URLs are string literal types)\n`;
        for (const ep of endpoints) {
            out += `export type ${ep.baseName}Endpoint = {\n`;
            out += `  method: '${ep.method.toUpperCase()}';\n`;
            out += `  path: '${ep.path}';\n`;
            out += `  url: '${ep.fullUrl}';\n`;
            out += `  request: ${ep.requestTypeName};\n`;
            out += `  response: ${ep.responseTypeName};\n`;
            out += `};\n\n`;
        }
        if (endpoints.length > 0) {
            out += `export type N8nEndpoints = ${endpoints.map(e => `${e.baseName}Endpoint`).join(' | ')};\n\n`;
        } else {
            out += `export type N8nEndpoints = never;\n\n`;
        }
        out += `export type N8nBaseUrl = '${baseUrl}';\n`;
        return out;
    }

    function renderEndpointsMd(): string {
        let out = '';
        out += `# Endpoints Summary\n\n`;
        out += `This file is auto-generated by n8n-sdk-generator.\n\n`;
        out += `| Method | Path | Label | MethodName | Request Type | Response Type |\n`;
        out += `|-------|------|-------|------------|--------------|---------------|\n`;
        for (const ep of endpoints) {
            const methodUpper = ep.method.toUpperCase();
            out += `| ${methodUpper} | ${ep.path} | ${ep.label || ''} | ${ep.methodName} | ${ep.requestTypeName} | ${ep.responseTypeName} |\n`;
        }
        out += `\n`;
        return out;
    }

    const typesTsCode = renderTypesTs();
    const dtsCode = renderDts('n8n');

    function renderClientTs(): string {
        const typeNames = Array.from(new Set(endpoints.flatMap(ep => [ep.requestTypeName, ep.responseTypeName])));
        let out = '';
        out += `// Auto-generated by n8n-sdk-generator. Do not edit manually.\n`;
        out += `// Runtime client for calling your n8n webhooks.\n\n`;
        if (typeNames.length > 0) {
            out += `import type { ${typeNames.join(', ')} } from './n8n-types';\n\n`;
        }
        out += `export type JsonValue = unknown;\n`;
        out += `export interface N8nClientOptions {\n`;
        out += `  baseUrl?: string; // Defaults to the base URL used at generation time\n`;
        out += `  token?: string;   // n8n API key if required by your instance (sent as X-N8N-API-KEY)\n`;
        out += `  timeoutMs?: number;\n`;
        out += `  defaultHeaders?: Record<string, string>;\n`;
        out += `  fetchImpl?: (url: string, init?: any) => Promise<any>;\n`;
        out += `}\n\n`;
        out += `// Internal helper for the callWebhook function (uses global fetch)\n`;
        out += `async function fetchWithTimeout(url: string, init: any = {}, timeoutMs = ${getTimeoutMs()}): Promise<any> {\n`;
        out += `  const controller = new AbortController();\n`;
        out += `  const timer = setTimeout(() => controller.abort(), timeoutMs);\n`;
        out += `  try {\n`;
        out += `    const res = await fetch(url, { ...init, signal: controller.signal });\n`;
        out += `    return res as any;\n`;
        out += `  } finally {\n`;
        out += `    clearTimeout(timer);\n`;
        out += `  }\n`;
        out += `}\n\n`;
        out += `export class N8nClient {\n`;
        out += `  readonly baseUrl: string = '${baseUrl}';\n`;
        out += `  readonly token?: string;\n`;
        out += `  readonly timeoutMs: number;\n`;
        out += `  readonly defaultHeaders: Record<string, string>;\n`;
        out += `  readonly fetchImpl: (url: string, init?: any) => Promise<any>;\n`;
        out += `\n`;
        out += `  constructor(opts: N8nClientOptions = {}) {\n`;
        out += `    if (opts.baseUrl) this.baseUrl = String(opts.baseUrl).replace(/\\\/+$/, '');\n`;
        out += `    this.token = opts.token;\n`;
        out += `    this.timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : ${getTimeoutMs()};\n`;
        out += `    this.defaultHeaders = { 'Accept': 'application/json', ...(opts.defaultHeaders || {}) };\n`;
        out += `    this.fetchImpl = opts.fetchImpl || (globalThis as any).fetch;\n`;
        out += `  }\n`;
        out += `\n`;
        out += `  private async request(url: string, method: string, body?: any): Promise<any> {\n`;
        out += `    const headers: Record<string, string> = { ...this.defaultHeaders, 'Content-Type': 'application/json' };\n`;
        out += `    if (this.token) headers['X-N8N-API-KEY'] = this.token;\n`;
        out += `    const controller = new AbortController();\n`;
        out += `    const timer = setTimeout(() => controller.abort(), this.timeoutMs);\n`;
        out += `    try {\n`;
        out += `      const res = await this.fetchImpl(url, {\n`;
        out += `        method,\n`;
        out += `        headers,\n`;
        out += `        body: body === undefined ? undefined : JSON.stringify(body),\n`;
        out += `        signal: controller.signal,\n`;
        out += `      } as any);\n`;
        out += `      const text = await (res as any).text();\n`;
        out += `      if (!(res as any).ok) {\n`;
        out += `        throw new Error(\`HTTP \${(res as any).status} \${(res as any).statusText}: \${text}\`);\n`;
        out += `      }\n`;
        out += `      try { return text ? JSON.parse(text) : undefined; } catch { return text; }\n`;
        out += `    } finally {\n`;
        out += `      clearTimeout(timer);\n`;
        out += `    }\n`;
        out += `  }\n`;
        out += `\n`;
        for (const ep of endpoints) {
            out += `  /**\n`;
            if (ep.label) out += `   * ${ep.label}\n`;
            out += `   * ${ep.method.toUpperCase()} ${ep.path}\n`;
            out += `   * Full URL (at generation): ${ep.fullUrl}\n`;
            out += `   */\n`;
            // Build dynamic URL from baseUrl and path to allow overrides
            const pathWithSlash = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
            out += `  async ${ep.methodName}(req: ${ep.requestTypeName}): Promise<${ep.responseTypeName}> {\n`;
            out += `    const url = this.baseUrl + '/webhook${pathWithSlash}';\n`;
            out += `    const data = await this.request(url, '${ep.method.toUpperCase()}', req);\n`;
            out += `    return data as ${ep.responseTypeName};\n`;
            out += `  }\n\n`;
        }
        out += `}\n\n`;
        out += `// Generic helper if you just want to call by full URL\n`;
        out += `export async function callWebhook(url: string, method: string = 'POST', body?: any, timeoutMs: number = ${getTimeoutMs()}): Promise<any> {\n`;
        out += `  const res = await fetchWithTimeout(url, { method, headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, timeoutMs);\n`;
        out += `  const text = await res.text();\n`;
        out += `  if (!res.ok) throw new Error(\`HTTP \${res.status} \${res.statusText}: \${text}\`);\n`;
        out += `  try { return text ? JSON.parse(text) : undefined; } catch { return text; }\n`;
        out += `}\n`;
        return out;
    }

    const typesTsFile = path.join(outputDir, 'n8n-types.ts');
    const dtsFile = path.join(outputDir, 'n8n-sdk.d.ts');
    const endpointsMdFile = path.join(outputDir, 'endpoints.md');
    const clientTsFile = path.join(outputDir, 'n8n-sdk-client.ts');
    try {
        await fs.mkdir(outputDir, { recursive: true });
        await fs.writeFile(typesTsFile, typesTsCode);
        await fs.writeFile(dtsFile, dtsCode);
        await fs.writeFile(endpointsMdFile, renderEndpointsMd());
        await fs.writeFile(clientTsFile, renderClientTs());
    } catch (err: any) {
        throw new Error(`Failed to write output files to ${outputDir}: ${err?.message || String(err)}`);
    }

    if (detailErrors > 0) {
        console.warn(`Completed with ${detailErrors} workflow detail fetch warning(s).`);
    }

    console.log(`Types module generated at ${typesTsFile}`);
    console.log(`TypeScript declarations generated at ${dtsFile}`);
    console.log(`Endpoints summary generated at ${endpointsMdFile}`);
    console.log(`SDK client generated at ${clientTsFile}`);
}
