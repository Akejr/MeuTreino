/**
 * API do Meu Treino (roda na Vercel e no servidor local do Vite).
 * - POST /api/ai    → repassa a conversa para a OpenRouter com a chave do servidor.
 * - POST /api/sync  → envia e recebe registros do Supabase com a chave secreta do servidor.
 * As duas exigem o código de acesso do app (cabeçalho x-app-code). As chaves nunca vão para o navegador.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export interface Env {
  APP_ACCESS_CODE?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Dono fixo dos registros: o app tem um único usuário. */
export const OWNER = '00000000-0000-0000-0000-000000000001';
const DEFAULT_SUPABASE_URL = 'https://rqvhnsjfhfqzykhwvcks.supabase.co';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const MAX_BODY = 4_000_000;
/** Versão mínima do app aceita na sincronização. */
const MIN_CLIENT_VERSION = 2;

export const TABLES: Record<string, string> = {
  settings: 'user_settings',
  meals: 'meals',
  foods: 'foods',
  equipment: 'equipment',
  plans: 'plans',
  sessions: 'workout_sessions',
  sets: 'workout_sets',
  habits: 'habits',
  habitChecks: 'habit_checks',
  cardio: 'cardio_sessions',
};

export interface SyncRow {
  id: string;
  data: Record<string, unknown>;
  client_updated_at: number;
  deleted: boolean;
}
export interface StoredRow extends SyncRow {
  updated_at: string;
}

/** Onde os registros ficam. Em produção é o Supabase; nos testes, a memória. */
export interface SyncStore {
  upsert(table: string, rows: SyncRow[]): Promise<void>;
  select(table: string, since: string | undefined, inclusive: boolean, limit: number): Promise<StoredRow[]>;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

const sha = (s: string) => createHash('sha256').update(s).digest();

function checkCode(req: Request, env: Env): Response | null {
  if (!env.APP_ACCESS_CODE) return json(500, { error: 'O servidor está sem APP_ACCESS_CODE configurado.' });
  const got = req.headers.get('x-app-code') ?? '';
  if (!got || !timingSafeEqual(sha(got), sha(env.APP_ACCESS_CODE))) return json(401, { error: 'Código de acesso incorreto.' });
  return null;
}

async function readJSON(req: Request): Promise<Record<string, unknown> | Response> {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const text = await req.text();
  if (text.length > MAX_BODY) return json(413, { error: 'Requisição grande demais.' });
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : json(400, { error: 'JSON inválido.' });
  } catch {
    return json(400, { error: 'JSON inválido.' });
  }
}

// ---------------------------------------------------------------- IA

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type Msg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

function validMessages(v: unknown): Msg[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 80) return null;
  for (const m of v) {
    if (!m || typeof m !== 'object' || !['system', 'user', 'assistant'].includes(m.role)) return null;
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content) || m.content.length > 6) return null;
    for (const p of m.content) {
      if (p?.type === 'text' && typeof p.text === 'string') continue;
      if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.image_url.url)) continue;
      return null;
    }
  }
  return v as Msg[];
}

export async function handleAI(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const denied = checkCode(req, env);
  if (denied) return denied;
  const body = await readJSON(req);
  if (body instanceof Response) return body;
  const messages = validMessages(body.messages);
  if (!messages) return json(400, { error: 'Mensagens inválidas.' });
  if (!env.OPENROUTER_API_KEY) return json(500, { error: 'O servidor está sem OPENROUTER_API_KEY configurada.' });
  const temperature = Math.min(1.2, Math.max(0, Number(body.temperature ?? 0.4) || 0));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const res = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'Meu Treino',
      },
      body: JSON.stringify({ model: env.OPENROUTER_MODEL || DEFAULT_MODEL, messages, temperature }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
    if (!res.ok) return json(502, { error: `OpenRouter (${res.status})${data.error?.message ? `: ${data.error.message}` : ''}` });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return json(502, { error: 'A IA retornou uma resposta vazia.' });
    return json(200, { content: content.trim() });
  } catch (e) {
    return json(504, { error: ctrl.signal.aborted ? 'A IA demorou demais para responder.' : `Falha ao falar com a IA: ${e instanceof Error ? e.message : e}` });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- sincronização

export function supabaseStore(env: Env): SyncStore | null {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const db = createClient(env.SUPABASE_URL || DEFAULT_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async upsert(table, rows) {
      // O gatilho mt_sync_guard no banco ignora alterações mais antigas que a já gravada.
      const { error } = await db.from(table).upsert(
        rows.map((r) => ({ ...r, user_id: OWNER })),
        { onConflict: 'user_id,id' },
      );
      if (error) throw new Error(error.message);
    },
    async select(table, since, inclusive, limit) {
      let q = db.from(table).select('id,data,client_updated_at,deleted,updated_at').eq('user_id', OWNER).order('updated_at', { ascending: true }).limit(limit);
      if (since) q = inclusive ? q.gte('updated_at', since) : q.gt('updated_at', since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({ ...r, client_updated_at: Number(r.client_updated_at) })) as StoredRow[];
    },
  };
}

function validRows(v: unknown): SyncRow[] | null {
  if (!Array.isArray(v) || v.length > 500) return null;
  const out: SyncRow[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') return null;
    const { id, data, client_updated_at, deleted } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 200) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (typeof client_updated_at !== 'number' || !Number.isFinite(client_updated_at)) return null;
    out.push({ id, data: data as Record<string, unknown>, client_updated_at: Math.round(client_updated_at), deleted: deleted === true });
  }
  return out;
}

export async function handleSync(req: Request, env: Env, store: SyncStore | null = supabaseStore(env)): Promise<Response> {
  const denied = checkCode(req, env);
  if (denied) return denied;
  if (!(Number(req.headers.get('x-app-version')) >= MIN_CLIENT_VERSION)) {
    return json(426, { error: 'Versão antiga do app. Feche e abra o app de novo para atualizar.' });
  }
  const body = await readJSON(req);
  if (body instanceof Response) return body;
  if (body.op === 'ping') return json(200, { ok: true, servidor: !!store });
  if (!store) return json(500, { error: 'O servidor está sem SUPABASE_SERVICE_ROLE_KEY configurada.' });
  const table = TABLES[String(body.coll)];
  if (!table) return json(400, { error: 'Coleção desconhecida.' });
  try {
    if (body.op === 'push') {
      const rows = validRows(body.rows);
      if (!rows) return json(400, { error: 'Registros inválidos.' });
      if (rows.length) await store.upsert(table, rows);
      return json(200, { ok: true });
    }
    if (body.op === 'pull') {
      const limit = Math.min(1000, Math.max(1, Number(body.limit) || 500));
      const since = typeof body.since === 'string' && body.since ? body.since : undefined;
      const rows = await store.select(table, since, body.inclusive === true, limit);
      return json(200, { rows });
    }
    return json(400, { error: 'Operação desconhecida.' });
  } catch (e) {
    return json(502, { error: `Banco: ${e instanceof Error ? e.message : e}` });
  }
}

export async function route(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path === '/api/ai') return handleAI(req, env);
  if (path === '/api/sync') return handleSync(req, env);
  return json(404, { error: 'Rota não encontrada.' });
}
