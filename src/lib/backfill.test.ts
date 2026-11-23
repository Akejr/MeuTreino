import { describe, expect, it } from 'vitest';
import type { AppData, Food, FoodItem, Meal } from '../types';
import { applyBackfill, pendingMeals } from './backfill';
import { defaultData } from './defaults';

const item = (id: string, patch: Partial<FoodItem> = {}): FoodItem => ({
  id,
  nome: id,
  quantidade: '1',
  calorias: 100,
  proteina: 10,
  gordura: 4,
  carboidratos: 8,
  ...patch,
});
const meal = (id: string, itens: FoodItem[], patch: Partial<Meal> = {}): Meal => ({ id, date: '2026-11-23', refeicao: 'Almoço', hora: '12:00', itens, criadoEm: 1, ...patch });

describe('qualidade de refeições antigas', () => {
  it('completa só o que falta, sem mudar macros, usando o cadastro primeiro, e marca a refeição', () => {
    const whey: Food = { id: 'f1', nome: 'Whey', apelidos: '', porcao: '1 scoop', porcaoQtd: 30, porcaoUnidade: 'g', obs: '', criadoEm: 1, calorias: 120, proteina: 24, gordura: 2, carboidratos: 3, sodio: 60, acucar: 0 };
    const d: AppData = {
      ...defaultData(),
      foods: { f1: whey },
      meals: {
        m1: meal('m1', [item('pao'), item('maca', { fibras: 2.4, nova: 1 }), item('whey', { foodId: 'f1', calorias: 240, proteina: 48, gordura: 4, carboidratos: 6 })]),
        m2: meal('m2', [item('ok', { fibras: 1, acucar: 0, saturada: 1, sodio: 10, nova: 1 })]),
        m3: meal('m3', [item('x')], { qualidadeEstimada: 5 }),
      },
    };
    expect(pendingMeals(d).map((m) => m.id)).toEqual(['m1']);
    const res = {
      refeicoes: [
        {
          id: 'm1',
          itens: [
            { id: 'pao', fibras: 2.3, acucar_adicionado: 1.5, gordura_saturada: 9, sodio: 250, nova: 4 },
            { id: 'maca', fibras: 9, acucar_adicionado: 0, gordura_saturada: 0, sodio: 1, nova: 1 },
            { id: 'whey', fibras: 0, acucar_adicionado: 0, gordura_saturada: 1, sodio: 999, nova: 4, suplemento: true },
          ],
        },
      ],
    };
    const out = applyBackfill(d, ['m1'], res, 123);
    const [pao, maca, w] = out.meals.m1.itens;
    expect(pao).toMatchObject({ calorias: 100, proteina: 10, fibras: 2.3, acucar: 1.5, saturada: 4, sodio: 250, nova: 4 }); // saturada limitada à gordura
    expect(maca.fibras).toBe(2.4); // já tinha: não muda
    expect(maca.nova).toBe(1);
    expect(w.sodio).toBe(120); // do cadastro: 60 mg por 120 kcal × 240 kcal
    expect(w.acucar).toBe(0);
    expect(w.saturada).toBe(1);
    expect(w.suplemento).toBe(true);
    expect(out.meals.m1.qualidadeEstimada).toBe(123);
    expect(pendingMeals(out)).toEqual([]);
    expect(out.meals.m2).toBe(d.meals.m2);
  });
});
