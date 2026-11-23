import { beforeAll, describe, expect, it } from 'vitest';
import { handleAI, handleSync, type StoredRow, type SyncRow, type SyncStore } from '../../server/api';

// Banco em memória com a mesma regra do gatilho mt_sync_guard: alteração mais antiga é ignorada.
const db: Record<string, Map<string, StoredRow>> = {};
let clock = Date.parse('2026-11-23T10:00:00Z');
const tick = () => new Date(++clock).toISOString();
const table = (t: string) => (db[t] ??= new Map());
const memory: SyncStore = {
  async upsert(t: string, rows: SyncRow[]) {
    for (const r of rows) {
      const old = table(t).get(r.id);
      if (old && r.client_updated_at < old.client_updated_at) continue;
      table(t).set(r.id, { ...r, updated_at: tick() });
    }
  },
  async select(t, since, inclusive, limit) {
    return [...table(t).values()]
      .filter((r) => !since || (inclusive ? r.updated_at >= since : r.updated_at > since))
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(0, limit);
  },
};
const ENV = { APP_ACCESS_CODE: 'abcd-efgh-ijkl' };

let storage: typeof import('./storage');
let sync: typeof import('./sync');

beforeAll(async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  (globalThis as any).__DEV_ACCESS_CODE__ = '';
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const req = new Request(`http://x${url}`, init);
    return handleSync(req, ENV, memory);
  }) as typeof fetch;
  storage = await import('./storage');
  sync = await import('./sync');
});

const meal = (id: string, kcal: number) => ({ id, date: '2026-11-23', refeicao: 'Almoço', hora: '12:00', criadoEm: 1, itens: [{ id: 'i', nome: 'Arroz', quantidade: '100 g', calorias: kcal, proteina: 2, gordura: 0, carboidratos: 28 }] });
const server = (t: string, id: string) => table(t).get(id);
const setCode = (c: string) => storage.setDataRaw((d) => ({ ...d, local: { accessCode: c } }));

describe('servidor', () => {
  it('recusa sem o código de acesso certo', async () => {
    const r = await handleSync(new Request('http://x/api/sync', { method: 'POST', headers: { 'x-app-code': 'errado' }, body: '{"op":"ping"}' }), ENV, memory);
    expect(r.status).toBe(401);
    const ai = await handleAI(new Request('http://x/api/ai', { method: 'POST', body: '{}' }), { ...ENV, OPENROUTER_API_KEY: 'k' });
    expect(ai.status).toBe(401);
  });

  it('recusa coleção ou registros inválidos', async () => {
    const old = await handleSync(new Request('http://x', { method: 'POST', headers: { 'x-app-code': ENV.APP_ACCESS_CODE }, body: '{"op":"ping"}' }), ENV, memory);
    expect(old.status).toBe(426); // versão antiga do app não sincroniza
    const h = { 'x-app-code': ENV.APP_ACCESS_CODE, 'x-app-version': '2' };
    expect((await handleSync(new Request('http://x', { method: 'POST', headers: h, body: '{"op":"push","coll":"auth.users","rows":[]}' }), ENV, memory)).status).toBe(400);
    expect((await handleSync(new Request('http://x', { method: 'POST', headers: h, body: '{"op":"push","coll":"meals","rows":[{"id":1}]}' }), ENV, memory)).status).toBe(400);
  });

  it('a IA usa a chave do servidor e não aceita imagem de fora', async () => {
    let auth = '';
    const fake = (async (_u: string, init: RequestInit) => {
      auth = String((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as typeof fetch;
    const env = { ...ENV, OPENROUTER_API_KEY: 'chave-do-servidor' };
    const h = { 'x-app-code': ENV.APP_ACCESS_CODE };
    const ok = await handleAI(new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }) }), env, fake);
    expect(await ok.json()).toEqual({ content: 'ok' });
    expect(auth).toBe('Bearer chave-do-servidor');
    const img = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://site.com/a.jpg' } }] };
    const bad = await handleAI(new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify({ messages: [img] }) }), env, fake);
    expect(bad.status).toBe(400);
  });
});

describe('sincronização', () => {
  it('sem código não envia nada e as alterações ficam pendentes', async () => {
    storage.setData((d) => ({ ...d, meals: { ...d.meals, m1: meal('m1', 130) as any } }));
    await sync.syncNow();
    expect(table('meals').size).toBe(0);
    expect(storage.pendingCount()).toBeGreaterThan(0);
  });

  it('código errado não envia', async () => {
    setCode('errado');
    await sync.syncNow();
    expect(table('meals').size).toBe(0);
  });

  it('com o código envia tudo e limpa a fila', async () => {
    setCode(ENV.APP_ACCESS_CODE);
    await sync.syncNow();
    expect(server('meals', 'm1')?.data.itens).toBeTruthy();
    expect(server('user_settings', 'settings')?.data.profile).toMatchObject({ nome: 'Evandro Casanova', peso: '87' });
    expect(storage.pendingCount()).toBe(0);
  });

  it('reenviar não duplica', async () => {
    storage.setData((d) => ({ ...d, meals: { ...d.meals, m1: { ...d.meals.m1, hora: '12:30' } } }));
    await sync.syncNow();
    await sync.syncNow();
    expect(table('meals').size).toBe(1);
    expect(server('meals', 'm1')?.data.hora).toBe('12:30');
  });

  it('recebe a alteração mais nova feita em outro aparelho', async () => {
    const r = server('meals', 'm1')!;
    table('meals').set('m1', { ...r, data: { ...r.data, hora: '13:00' }, client_updated_at: r.client_updated_at + 1000, updated_at: tick() });
    await sync.syncNow();
    expect(storage.getData().meals.m1.hora).toBe('13:00');
  });

  it('alteração local mais nova vence uma antiga do servidor', async () => {
    storage.setData((d) => ({ ...d, meals: { ...d.meals, m1: { ...d.meals.m1, hora: '14:00' } } }));
    const r = server('meals', 'm1')!;
    table('meals').set('m1', { ...r, data: { ...r.data, hora: '09:00' }, client_updated_at: 5, updated_at: tick() });
    await sync.syncNow();
    expect(storage.getData().meals.m1.hora).toBe('14:00');
    expect(server('meals', 'm1')?.data.hora).toBe('14:00');
  });

  it('alimentos cadastrados também vão para o servidor; exclusões propagam', async () => {
    storage.setData((d) => ({ ...d, foods: { ...d.foods, f1: { id: 'f1', nome: 'Whey', apelidos: 'whey', porcao: '1 scoop (30 g)', porcaoQtd: 30, porcaoUnidade: 'g', calorias: 120, proteina: 24, gordura: 1.5, carboidratos: 3, obs: '', criadoEm: 1 } } }));
    await sync.syncNow();
    expect(server('foods', 'f1')?.data.nome).toBe('Whey');
    storage.setData((d) => {
      const foods = { ...d.foods };
      delete foods.f1;
      return { ...d, foods };
    });
    await sync.syncNow();
    expect(server('foods', 'f1')?.deleted).toBe(true);
  });

  it('registros gerados automaticamente (_u = 1) não sobrescrevem os do servidor', async () => {
    table('workout_sessions').set('s-A', { id: 's-A', data: { id: 's-A', status: 'concluida', key: 'A' }, client_updated_at: 9e12, deleted: false, updated_at: tick() });
    storage.setData((d) => ({ ...d, sessions: { ...d.sessions, 's-A': { id: 's-A', status: 'pendente', key: 'A', _u: 1 } as any } }));
    await sync.syncNow();
    expect(server('workout_sessions', 's-A')?.data.status).toBe('concluida');
    expect(storage.getData().sessions['s-A'].status).toBe('concluida');
  });
});
