/**
 * Persistência local (offline primeiro), com várias camadas de proteção:
 * 1. localStorage (fonte principal, síncrona)
 * 2. localStorage ":prev" (versão anterior, caso a atual corrompa)
 * 3. IndexedDB "kv" (cópia completa; restaura se o localStorage for apagado)
 * 4. IndexedDB "snapshots" (uma foto por dia, últimos 30 dias)
 * 5. navigator.storage.persist() (pede ao navegador para não apagar)
 * 6. Exportar/importar backup em arquivo
 * 7. Sincronização com o Supabase (lib/sync.ts), quando houver conta e internet
 *
 * Toda alteração passa por setData. Ela compara as coleções sincronizadas com a versão
 * anterior (por referência) e marca o que mudou como pendente de envio.
 */
import { useSyncExternalStore } from 'react';
import { SYNC_COLLECTIONS, type AppData, type Meal, type SyncCollection } from '../types';
import { DEFAULT_LIMITS, DEFAULT_PROFILE, DEFAULT_RESPOSTAS, defaultData, defaultTraining, SEED_VERSION } from './defaults';
import { idbDel, idbGet, idbKeys, idbSet } from './idb';
import { todayISO } from './utils';

const LS_KEY = 'meutreino:data';
const LS_PREV = 'meutreino:data:prev';
const MAX_SNAPSHOTS = 30;
const PREV_MAX_BYTES = 1_500_000;

/** Limites padrão da primeira versão (trocados pelos do perfil na migração). Precisa vir antes de carregar os dados. */
const OLD_DEFAULT_LIMITS = { calorias: 2200, proteina: 160, gordura: 70, carboidratos: 220 };

const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let state: AppData = loadFromLocalStorage();
let saveError: string | null = null;

// ---------- migração ----------

/** Aplica uma vez os dados pré-configurados em aparelhos que já tinham dados antigos. */
function applySeed(d: AppData): AppData {
  if ((d.settings.seed ?? 0) >= SEED_VERSION) return d;
  const s = d.settings;
  const profile = { ...s.profile };
  for (const k of Object.keys(DEFAULT_PROFILE) as (keyof typeof DEFAULT_PROFILE)[]) if (!String(profile[k] ?? '').trim()) profile[k] = DEFAULT_PROFILE[k];
  const oldLimits = (Object.keys(OLD_DEFAULT_LIMITS) as (keyof typeof OLD_DEFAULT_LIMITS)[]).every((k) => s.limits[k] === OLD_DEFAULT_LIMITS[k]);
  const respostas = { ...DEFAULT_RESPOSTAS, ...s.training.respostas };
  return {
    ...d,
    settings: { ...s, seed: SEED_VERSION, profile, limits: oldLimits ? { ...DEFAULT_LIMITS } : s.limits, training: { ...s.training, respostas } },
  };
}

export function migrate(raw: unknown): AppData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, any>;
  const def = defaultData();

  if (d.version === 1) {
    const meals: Record<string, Meal> = {};
    for (const m of Array.isArray(d.meals) ? d.meals : []) if (m?.id) meals[m.id] = m;
    const s = d.settings ?? {};
    return applySeed({
      ...def,
      updatedAt: Number(d.updatedAt) || 0,
      settings: {
        ...def.settings,
        seed: 0,
        limits: { ...def.settings.limits, ...s.limits },
        profile: { ...def.settings.profile, ...s.profile },
        training: { ...defaultTraining(), respostas: {} },
      },
      local: { accessCode: '' },
      meals,
      dietDraft: d.dietDraft ?? null,
      lastExportAt: d.lastExportAt,
      legacy: { workouts: d.workouts, summaryChats: d.summaryChats, equipamentos: s.equipamentos },
    });
  }

  if (d.version !== 2) return null;
  const s = d.settings ?? {};
  const { model: _model, ...settingsRest } = s;
  return applySeed({
    ...def,
    ...d,
    settings: {
      ...def.settings,
      seed: 0,
      ...settingsRest,
      limits: { ...def.settings.limits, ...s.limits },
      profile: { ...def.settings.profile, ...s.profile },
      training: { ...defaultTraining(), respostas: {}, ...s.training },
    },
    local: { accessCode: String(d.local?.accessCode ?? '') },
    meals: d.meals ?? {},
    foods: d.foods ?? {},
    equipment: d.equipment ?? {},
    plans: d.plans ?? {},
    sessions: d.sessions ?? {},
    sets: d.sets ?? {},
    aiChats: d.aiChats ?? {},
    tips: d.tips ?? {},
    sync: { ...def.sync, ...d.sync },
    updatedAt: Number(d.updatedAt) || 0,
  } as AppData);
}

function parse(raw: string | null | undefined): AppData | null {
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadFromLocalStorage(): AppData {
  try {
    return parse(localStorage.getItem(LS_KEY)) ?? parse(localStorage.getItem(LS_PREV)) ?? defaultData();
  } catch {
    return defaultData();
  }
}

// ---------- escrita ----------

const emit = () => listeners.forEach((l) => l());

function writeLocal(raw: string) {
  try {
    const cur = localStorage.getItem(LS_KEY);
    if (cur && cur !== raw && cur.length < PREV_MAX_BYTES) localStorage.setItem(LS_PREV, cur);
    else if (cur && cur.length >= PREV_MAX_BYTES) localStorage.removeItem(LS_PREV);
    localStorage.setItem(LS_KEY, raw);
    saveError = null;
  } catch {
    try {
      localStorage.removeItem(LS_PREV);
      localStorage.setItem(LS_KEY, raw);
      saveError = null;
    } catch {
      saveError = 'Não foi possível salvar no localStorage. Os dados continuam no IndexedDB. Exporte um backup.';
    }
  }
}

async function saveSnapshot(raw: string) {
  await idbSet('snapshots', todayISO(), raw);
  const keys = (await idbKeys('snapshots')).map(String).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) await idbDel('snapshots', k);
}

function write(next: AppData) {
  const raw = JSON.stringify(next);
  writeLocal(raw);
  idbSet('kv', 'data', raw).catch(() => {
    saveError = saveError ?? 'Falha ao gravar a cópia no IndexedDB.';
  });
  saveSnapshot(raw).catch(() => {});
}

/** Marca como pendente tudo o que mudou nas coleções sincronizadas e nas configurações. */
function trackChanges(prev: AppData, next: AppData): AppData {
  const now = Date.now();
  let dirty = next.sync.dirty;
  let deleted = next.sync.deleted;
  let changed = false;
  const out: AppData = { ...next };

  const mark = (coll: string, id: string, u: number, isDelete: boolean) => {
    if (!changed) {
      dirty = { ...dirty };
      deleted = { ...deleted };
      changed = true;
    }
    dirty[coll] = { ...dirty[coll], [id]: u };
    if (isDelete) deleted[coll] = { ...deleted[coll], [id]: u };
    else if (deleted[coll]?.[id]) {
      const { [id]: _x, ...rest } = deleted[coll];
      deleted[coll] = rest;
    }
  };

  for (const coll of SYNC_COLLECTIONS) {
    const a = prev[coll] as Record<string, { _u?: number }>;
    const b = next[coll] as Record<string, { _u?: number }>;
    if (a === b) continue;
    let nb = b;
    for (const id in b) {
      if (a[id] === b[id]) continue;
      // Registro novo com _u explícito (ex.: gerado automaticamente com _u = 1) mantém o valor,
      // para que qualquer versão do servidor vença. Alterações em registros existentes usam agora.
      const keep = b[id]._u !== undefined && !a[id];
      const u = keep ? b[id]._u! : now;
      if (!keep) {
        if (nb === b) nb = { ...b };
        nb[id] = { ...b[id], _u: u };
      }
      mark(coll, id, u, false);
    }
    for (const id in a) if (!(id in b)) mark(coll, id, now, true);
    (out as any)[coll] = nb;
  }

  if (prev.settings !== next.settings) {
    out.settings = { ...next.settings, _u: now };
    mark('settings', 'settings', now, false);
  }

  if (changed) out.sync = { ...next.sync, dirty, deleted };
  return out;
}

export function getData(): AppData {
  return state;
}

/** Alteração feita pelo usuário/app: grava e marca para sincronizar. */
export function setData(updater: (d: AppData) => AppData) {
  const prev = state;
  const raw = updater(prev);
  if (raw === prev) return;
  const next = { ...trackChanges(prev, raw), updatedAt: Date.now() };
  state = next;
  write(next);
  emit();
  changeListeners.forEach((l) => l());
}

/** Alteração vinda do servidor ou de metadados de sync: grava sem marcar pendências. */
export function setDataRaw(updater: (d: AppData) => AppData) {
  const next = updater(state);
  if (next === state) return;
  state = { ...next, updatedAt: Date.now() };
  write(state);
  emit();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Avisado depois de cada alteração local (usado para disparar a sincronização). */
export function onLocalChange(l: () => void) {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
}

export function useData(): AppData {
  return useSyncExternalStore(subscribe, getData);
}

export const getSaveError = () => saveError;

export function pendingCount(d: AppData = state): number {
  return Object.values(d.sync.dirty).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);
}

// ---------- limpeza única dos dados de teste ----------

const RESET_KEY = 'meutreino:reset';
const RESET_ID = 'limpeza-testes-2026-11-23';
/** Tudo o que o usuário alterou antes deste instante foi teste (antes de publicar o app). */
const RESET_CUTOFF = 1795406558421;

function lastUserChange(d: AppData): number {
  let m = d.settings._u ?? 0;
  for (const c of SYNC_COLLECTIONS) for (const e of Object.values(d[c] as Record<string, { _u?: number }>)) m = Math.max(m, e._u ?? 0);
  return m;
}

/** Roda uma vez por aparelho. Só apaga se nenhum dado foi alterado depois do corte (dados reais nunca são apagados). */
async function resetTestData() {
  try {
    if (localStorage.getItem(RESET_KEY) === RESET_ID) return;
    const fromIdb = parse(await idbGet<string>('kv', 'data').catch(() => undefined));
    const todos = [state, fromIdb].filter((x): x is AppData => !!x && x.updatedAt > 0);
    if (todos.length && todos.every((d) => lastUserChange(d) < RESET_CUTOFF)) {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_PREV);
      localStorage.removeItem('meutreino:auth');
      await idbDel('kv', 'data').catch(() => {});
      for (const k of await idbKeys('snapshots').catch(() => [] as IDBValidKey[])) await idbDel('snapshots', String(k)).catch(() => {});
      state = defaultData();
    }
    localStorage.setItem(RESET_KEY, RESET_ID);
  } catch {
    /* ignora */
  }
}

/** Deve terminar antes de renderizar o app, para não sobrescrever dados mais novos do IndexedDB. */
export async function initStorage() {
  await resetTestData();
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* ignora */
  }
  try {
    const raw = await idbGet<string>('kv', 'data');
    const fromIdb = parse(raw);
    if (fromIdb && fromIdb.updatedAt > state.updatedAt) {
      state = fromIdb;
      writeLocal(JSON.stringify(fromIdb));
    } else if (state.updatedAt > 0 && (!fromIdb || fromIdb.updatedAt < state.updatedAt)) {
      await idbSet('kv', 'data', JSON.stringify(state));
    }
  } catch {
    /* IndexedDB indisponível: segue só com localStorage */
  }
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY) return;
    const d = parse(e.newValue);
    if (d) {
      state = d;
      emit();
    }
  });
}

// ---------- backup ----------

export function exportBackup() {
  setDataRaw((d) => ({ ...d, lastExportAt: Date.now() }));
  const blob = new Blob([JSON.stringify({ ...state, local: { accessCode: '' } }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meu-treino-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function keepLocalAndSync(d: AppData): AppData {
  return { ...d, local: state.local, sync: state.sync };
}

export async function importBackup(file: File): Promise<void> {
  const data = parse(await file.text());
  if (!data) throw new Error('Arquivo inválido: não é um backup do Meu Treino.');
  await idbSet('snapshots', `${todayISO()}-antes-importar-${Date.now()}`, JSON.stringify(state)).catch(() => {});
  setData(() => keepLocalAndSync(data));
}

export interface SnapshotInfo {
  key: string;
  updatedAt: number;
  refeicoes: number;
  sessoes: number;
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const keys = (await idbKeys('snapshots')).map(String).sort().reverse();
  const out: SnapshotInfo[] = [];
  for (const key of keys) {
    const d = parse(await idbGet<string>('snapshots', key));
    if (d) out.push({ key, updatedAt: d.updatedAt, refeicoes: Object.keys(d.meals).length, sessoes: Object.keys(d.sessions).length });
  }
  return out;
}

export async function restoreSnapshot(key: string) {
  const d = parse(await idbGet<string>('snapshots', key));
  if (!d) throw new Error('Snapshot corrompido.');
  await idbSet('snapshots', `${todayISO()}-antes-restaurar-${Date.now()}`, JSON.stringify(state)).catch(() => {});
  setData(() => keepLocalAndSync(d));
}

export async function storageInfo() {
  let persisted = false;
  let usage = 0;
  let quota = 0;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch {
    /* ignora */
  }
  return { persisted, usage, quota };
}

export type { SyncCollection };
