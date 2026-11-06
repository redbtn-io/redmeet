import 'server-only';

import { createHash } from 'node:crypto';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/log';

/**
 * MCP gateway client (Streamable HTTP, JSON-RPC), the same protocol the
 * fleet's `bin/mcp.py` speaks: initialize, capture the session id, then
 * tools/call.
 *
 * Auth is PER CALL and PER HOST. The gateway promotes each HTTP
 * request's headers into the call's credentials (see the gateway's
 * buildEffectiveMeta), so the bearer on the request is whose redbtn
 * connections the call acts through, and the `x-redbtn-connection-id`
 * header selects which of THAT caller's google connections the call
 * resolves against. The redbtn token exchange enforces ownership: a
 * connection id that is not the caller's own comes back as an error.
 * Sessions are therefore keyed by a fingerprint of the credential, one
 * session per (namespace, credential), never shared across hosts. A
 * credential value is never logged; the fingerprint is a hash prefix.
 */

const PROTOCOL_VERSION = '2025-06-18';

/** Whose credential a gateway call acts under, and which of their
 *  google connections it targets. `connectionId` must only ever be one
 *  that `google_accounts_list` returned under the SAME token. */
export interface GatewayAuth {
  token: string;
  connectionId?: string | null;
}

interface GatewaySession {
  sessionId: string | null;
  nextId: number;
  ready: Promise<void> | null;
  auth: GatewayAuth;
}

const sessions = new Map<string, GatewaySession>();

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function sessionFor(namespace: string, auth: GatewayAuth): GatewaySession {
  const key = `${namespace}:${fingerprint(auth.token)}`;
  let s = sessions.get(key);
  if (!s) {
    s = { sessionId: null, nextId: 0, ready: null, auth };
    sessions.set(key, s);
  }
  return s;
}

interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

async function post(
  namespace: string,
  session: GatewaySession,
  payload: Record<string, unknown>,
): Promise<{ messages: RpcMessage[]; sessionId: string | null }> {
  const config = getConfig();
  const res = await fetch(`${config.mcpGatewayUrl}/${namespace}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      // The gateway's edge refuses non-browser user agents (the fleet's
      // own mcp.py sets the same header for the same reason).
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Authorization: `Bearer ${session.auth.token}`,
      // Per-call account selection: stateless, and the gateway resolves
      // it against the bearer's own connections only. This replaces the
      // old google_account_use call, which mutated the user's account
      // level default connection as a side effect.
      ...(session.auth.connectionId
        ? { 'x-redbtn-connection-id': session.auth.connectionId }
        : {}),
      ...(session.sessionId ? { 'Mcp-Session-Id': session.sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const sessionId = res.headers.get('mcp-session-id');
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`gateway HTTP ${res.status} for ${namespace}: ${text.slice(0, 300)}`);
  }
  if (!text.trim()) return { messages: [], sessionId };
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const messages: RpcMessage[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        messages.push(JSON.parse(data) as RpcMessage);
      } catch {
        // A non-JSON SSE line is not a protocol message; skip it.
      }
    }
    return { messages, sessionId };
  }
  return { messages: [JSON.parse(text) as RpcMessage], sessionId };
}

async function rpc(
  namespace: string,
  session: GatewaySession,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const id = ++session.nextId;
  const payload: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) payload.params = params;
  const { messages, sessionId } = await post(namespace, session, payload);
  if (sessionId) session.sessionId = sessionId;
  const message = messages.find((m) => m.id === id);
  if (!message) throw new Error(`gateway returned no response for ${method}`);
  if (message.error) {
    throw new Error(`gateway error for ${method}: ${message.error.message ?? 'unknown'}`);
  }
  return message.result;
}

async function ensureOpen(namespace: string, session: GatewaySession): Promise<void> {
  if (!session.ready) {
    session.ready = (async () => {
      await rpc(namespace, session, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'redmeet', version: '0.1.0' },
      });
      const payload = { jsonrpc: '2.0', method: 'notifications/initialized' };
      const { sessionId } = await post(namespace, session, payload);
      if (sessionId) session.sessionId = sessionId;
    })().catch((error: unknown) => {
      session.ready = null;
      throw error;
    });
  }
  return session.ready;
}

/**
 * Call one gateway tool and return its parsed payload. Gateway tools
 * answer with content[0].text holding a JSON string; that string is
 * parsed here, and a tool-level error raises.
 *
 * `auth` is REQUIRED: there is no ambient app credential any more.
 * Every call names the host whose credential it acts under.
 */
export async function callGatewayTool<T = unknown>(
  namespace: string,
  tool: string,
  args: Record<string, unknown>,
  auth: GatewayAuth,
): Promise<T> {
  const session = sessionFor(namespace, auth);
  try {
    await ensureOpen(namespace, session);
    const result = (await rpc(namespace, session, 'tools/call', {
      name: tool,
      arguments: args,
    })) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    if (result?.isError) {
      throw new Error(`gateway tool ${tool} failed: ${(text ?? '').slice(0, 300)}`);
    }
    if (text === undefined) return result as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  } catch (error) {
    // Drop the session: a stale session id is the common failure, and
    // the next call should reopen rather than repeat it.
    sessions.delete(`${namespace}:${fingerprint(auth.token)}`);
    logger.error('gateway tool call failed', { namespace, tool, error: String(error) });
    throw error;
  }
}
