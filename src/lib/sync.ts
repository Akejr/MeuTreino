/**
 * Sincronização offline primeiro, sem conta: o app fala com /api/sync usando o código de acesso,
 * e o servidor grava no Supabase com a chave secreta.
 * - Toda alteração local fica pendente (storage.ts) e é enviada quando houver internet.
 * - Envio: upsert por registro (id gerado no aparelho, então repetir o envio não duplica).
 * - Recebimento: linhas alteradas desde o último cursor (updated_at do servidor).
 * - Conflito: vence a alteração mais recente (client_updated_at), registro a registro.
 */
import { useSyncExternalStore } from 'react';
import { SYNC_COLLECTIONS, type AppData } from '../types';
import { defaultData, defaultTraining } from './defaults';
import { accessCodeOf } from './openrouter';
import { getData, onLocalChange, pendingCount, setDataRaw } from './storage';

const COLLS = ['settings', ...SYNC_COLLECTIONS] as const;
const OWNER = 'me';
const BATCH = 200;
const PAGE = 500;
/** O servidor recusa versões antigas do app (que não tinham a limpeza dos dados de teste). */
export const CLIENT_VERSION = '2';

export type SyncState = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'denied';
export interface SyncStatus {
  state: SyncState;
  error?: string;
}

let status: SyncStatus = { state: 'off' };
const listeners = new Set<() => void>();
const syncedListeners = new Set<() => void>();
const setStatus = (s: Partial<SyncStatus>) => {
  status = { ...status, ...s };
  listeners.forEach((l) => l());
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export function onSynced(l: () => void) {
  syncedListeners.add(l);
  return () => syncedListeners.delete(l);
}

class Denied extends Error {}

async function api<T>(body: Record<string, unknown>, code = accessCodeOf(getData())): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-code': code, 'x-app-version': CLIENT_VERSION },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new Denied(json.error || 'Código de acesso incorreto.');
  if (!res.ok) throw new Error(json.error || `Erro do servidor (${res.status}).`);
  return json;
}

/** Confere um código de acesso. true = válido; false = incorreto; lança erro se não deu para conferir. */
export async function checkAccessCode(code: string): Promise<boolean> {
  try {
    await api({ op: 'ping' }, code);
    return true;
  } catch (e) {
    if (e instanceof Denied) return false;
    throw e;
  }
}

// ---------- sincronização ----------

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function requestSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export async function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  if (!accessCodeOf(getData())) {
    setStatus({ state: 'off', error: undefined });
    return;
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: undefined });
  try {
    bind();
    await push();
    await pull();
    setDataRaw((d) => ({ ...d, sync: { ...d.sync, lastSyncAt: Date.now(), lastError: undefined } }));
    setStatus({ state: 'idle' });
    syncedListeners.forEach((l) => l());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setDataRaw((d) => ({ ...d, sync: { ...d.sync, lastError: msg } }));
    setStatus({ state: e instanceof Denied ? 'denied' : navigator.onLine ? 'error' : 'offline', error: msg });
  } finally {
    running = false;
    if (again) {
      again = false;
      requestSync(300);
    }
  }
}

/** Na primeira sincronização deste aparelho, marca tudo para envio (o servidor guarda o mais novo). */
function bind() {
  const d = getData();
  if (d.sync.userId === OWNER) return;
  setDataRaw((cur) => {
    const dirty: AppData['sync']['dirty'] = { ...cur.sync.dirty, settings: { settings: cur.settings._u ?? 1 } };
    for (const c of SYNC_COLLECTIONS) {
      const m: Record<string, number> = { ...dirty[c] };
      for (const [id, ent] of Object.entries(cur[c] as Record<string, { _u?: number }>)) m[id] = m[id] ?? ent._u ?? 1;
      dirty[c] = m;
    }
    return { ...cur, sync: { ...cur.sync, userId: OWNER, dirty, cursors: {} } };
  });
}

function entityOf(d: AppData, coll: string, id: string): { _u?: number } | undefined {
  if (coll === 'settings') return d.settings;
  return (d[coll as (typeof SYNC_COLLECTIONS)[number]] as Record<string, { _u?: number }>)[id];
}

async function push() {
  for (const coll of COLLS) {
    const snap = getData();
    const dirty = snap.sync.dirty[coll] ?? {};
    const ids = Object.keys(dirty);
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const rows = batch.map((id) => {
        const ent = entityOf(snap, coll, id);
        const delAt = snap.sync.deleted[coll]?.[id];
        if (ent && delAt === undefined) {
          const { _u, ...data } = ent;
          return { id, data, client_updated_at: _u ?? dirty[id], deleted: false };
        }
        return { id, data: {}, client_updated_at: delAt ?? dirty[id], deleted: true };
      });
      await api({ op: 'push', coll, rows });
      setDataRaw((cur) => {
        const m = { ...cur.sync.dirty[coll] };
        const del = { ...cur.sync.deleted[coll] };
        for (const id of batch) {
          if (m[id] === dirty[id]) {
            delete m[id];
            if (del[id] !== undefined && del[id] === snap.sync.deleted[coll]?.[id]) delete del[id];
          }
        }
        return { ...cur, sync: { ...cur.sync, dirty: { ...cur.sync.dirty, [coll]: m }, deleted: { ...cur.sync.deleted, [coll]: del } } };
      });
    }
  }
}

interface Row {
  id: string;
  data: Record<string, unknown>;
  client_updated_at: number | string;
  deleted: boolean;
  updated_at: string;
}

async function pull() {
  for (const coll of COLLS) {
    let cursor = getData().sync.cursors[coll];
    let first = true;
    for (;;) {
      // Na primeira página volta 5 s para não perder linhas gravadas durante o último recebimento.
      const since = cursor ? (first ? new Date(Date.parse(cursor) - 5000).toISOString() : cursor) : undefined;
      const { rows } = await api<{ rows: Row[] }>({ op: 'pull', coll, since, inclusive: first, limit: PAGE });
      if (rows.length) {
        applyRows(coll, rows);
        const last = rows[rows.length - 1].updated_at;
        if (!cursor || last > cursor) cursor = last;
        const c = cursor;
        setDataRaw((d) => ({ ...d, sync: { ...d.sync, cursors: { ...d.sync.cursors, [coll]: c } } }));
      }
      first = false;
      if (rows.length < PAGE) break;
    }
  }
}

function applyRows(coll: string, rows: Row[]) {
  setDataRaw((d) => {
    let changed = false;
    const target = coll === 'settings' ? null : { ...(d[coll as (typeof SYNC_COLLECTIONS)[number]] as Record<string, unknown>) };
    let settings = d.settings;
    const dirty = { ...d.sync.dirty[coll] };
    const deleted = { ...d.sync.deleted[coll] };
    for (const row of rows) {
      const u = Number(row.client_updated_at);
      const local = entityOf(d, coll, row.id);
      const pend = dirty[row.id];
      if (pend !== undefined && (local?._u ?? pend) > u) continue;
      if (pend === undefined && !row.deleted && local?._u === u) continue;
      if (row.deleted) {
        if (target && row.id in target) {
          delete target[row.id];
          changed = true;
        }
      } else if (coll === 'settings') {
        const def = defaultData().settings;
        const s = row.data as Partial<AppData['settings']>;
        settings = {
          ...def,
          ...s,
          limits: { ...def.limits, ...s.limits },
          nutri: { ...def.nutri, ...s.nutri },
          profile: { ...def.profile, ...s.profile },
          training: { ...defaultTraining(), ...s.training },
          _u: u,
        };
        changed = true;
      } else if (target) {
        target[row.id] = { ...row.data, id: row.id, _u: u };
        changed = true;
      }
      if (pend !== undefined && pend <= u) delete dirty[row.id];
      delete deleted[row.id];
    }
    if (!changed) return d;
    return {
      ...d,
      ...(target ? { [coll]: target } : {}),
      settings,
      sync: { ...d.sync, dirty: { ...d.sync.dirty, [coll]: dirty }, deleted: { ...d.sync.deleted, [coll]: deleted } },
    } as AppData;
  });
}

// ---------- gatilhos ----------

export function initSync() {
  onLocalChange(() => requestSync());
  window.addEventListener('online', () => requestSync(200));
  window.addEventListener('offline', () => status.state !== 'off' && setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && requestSync(200));
  setInterval(() => navigator.onLine && void syncNow(), 60_000);
  void syncNow();
}

export const pendingChanges = () => pendingCount(getData());
