import { expect, it, vi } from 'vitest';

it('carrega dados salvos de versões antigas ao abrir o app (antes do IndexedDB)', async () => {
  const saved = {
    version: 2,
    updatedAt: 123,
    settings: { _u: 5, limits: { calorias: 2200, proteina: 160, gordura: 70, carboidratos: 220 }, profile: {}, training: {} },
    local: { accessCode: 'x' },
    meals: { m1: { id: 'm1', date: '2026-11-23', refeicao: 'Almoço', hora: '12:00', criadoEm: 1, itens: [], _u: 7 } },
    sync: { dirty: {}, deleted: {}, cursors: {} },
  };
  const store: Record<string, string> = { 'meutreino:data': JSON.stringify(saved) };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
  });
  vi.resetModules();
  const { getData } = await import('./storage');
  const d = getData();
  expect(Object.keys(d.meals)).toEqual(['m1']);
  expect(d.settings.profile.nome).toBe('Evandro Casanova'); // perfil pré-configurado aplicado
  expect(d.settings.limits.calorias).toBe(2000); // limites antigos trocados pelos novos
  expect(d.local.accessCode).toBe('x');
  vi.unstubAllGlobals();
});
