import { describe, expect, it } from 'vitest';
import { checkId } from '../habits/habits';
import { defaultData } from '../lib/defaults';
import { evaluateDay } from '../lib/score';
import { addDays, todayISO } from '../lib/utils';
import { initialPlan } from '../training/initialPlan';
import type { AppData, Cardio, FoodItem, Meal, Session } from '../types';
import { coachReport, coachText } from './coach';
import { bodyOf, estimateCardio } from './energy';

const HOJE = todayISO();
const ONTEM = addDays(HOJE, -1);
let n = 0;
const item = (p: Partial<FoodItem>): FoodItem => ({ id: `i${++n}`, nome: 'x', quantidade: '', calorias: 0, proteina: 0, gordura: 0, carboidratos: 0, ...p });
const meal = (date: string, hora: string, refeicao: string, itens: FoodItem[]): Meal => ({ id: `m${++n}`, date, hora, refeicao, itens, criadoEm: 1 });
const cardio = (date: string, p: Partial<Cardio>): Cardio => ({ id: `c${++n}`, date, hora: '18:00', tipo: 'caminhada', minutos: 30, intensidade: 'moderada', criadoEm: 1, ...p });
const comMeals = (d: AppData, ms: Meal[]) => ({ ...d, meals: Object.fromEntries(ms.map((m) => [m.id, m])) });
const ids = (d: AppData, date: string) => coachReport(d, date).insights.map((i) => i.id);

/** 4 refeições boas: ~1.900 kcal, 168 g de proteína, 200 g de carboidrato. */
const diaBom = (date: string) =>
  ['08:00', '12:00', '16:00', '20:00'].map((h, k) =>
    meal(date, h, ['Café da manhã', 'Almoço', 'Lanche da tarde', 'Jantar'][k], [item({ calorias: 470, proteina: 42, gordura: 13, carboidratos: 50, fibras: 8, acucar: 2, saturada: 3, sodio: 400, nova: 1 })]),
  );

describe('estimativas de gasto (perfil 87 kg, 180 cm, 27 anos)', () => {
  const b = bodyOf(defaultData().settings.profile)!;

  it('metabolismo basal, gordura pelo IMC e FC máxima', () => {
    expect(Math.round(b.tmb)).toBe(1865);
    expect(b.gorduraPct).toBeCloseTo(22.2, 0);
    expect(Math.round(b.fcMax)).toBe(189);
  });

  it('equações do ACSM: caminhada inclinada, corrida e bicicleta', () => {
    const inclinada = estimateCardio(cardio(HOJE, { tipo: 'esteira_inclinada', minutos: 30, distanciaKm: 3, inclinacao: 10 }), b);
    expect(inclinada.metodo).toBe('acsm_caminhada');
    expect(inclinada.met).toBeCloseTo(9, 1);
    expect(inclinada.kcal).toBeCloseTo(391.5, 0);
    const corrida = estimateCardio(cardio(HOJE, { tipo: 'corrida', minutos: 30, distanciaKm: 5 }), b);
    expect(corrida.metodo).toBe('acsm_corrida');
    expect(corrida.met).toBeCloseTo(10.52, 1);
    const bike = estimateCardio(cardio(HOJE, { tipo: 'bike', minutos: 40, watts: 150 }), b);
    expect(bike.metodo).toBe('acsm_bike');
    expect(bike.met).toBeCloseTo(7.43, 1);
  });

  it('frequência cardíaca (Keytel) define gasto e intensidade relativa', () => {
    const e = estimateCardio(cardio(HOJE, { tipo: 'eliptico', minutos: 30, intensidade: 'leve', fcMedia: 150 }), b);
    expect(e.metodo).toBe('fc');
    expect(e.met).toBeCloseTo(10.27, 1);
    expect(e.intensidade).toBe('intensa');
  });

  it('sem detalhes usa a tabela do Compêndio; vigoroso conta em dobro para a OMS', () => {
    const e = estimateCardio(cardio(HOJE, { tipo: 'esteira_inclinada', minutos: 30 }), b);
    expect(e.metodo).toBe('tabela');
    expect(e.kcal).toBeCloseTo(282.75, 1);
    expect(e.kcalLiquida).toBeCloseTo(239.25, 1);
    expect(e.minutosOms).toBe(60);
  });
});

describe('coach: cardio junto com alimentação e treino', () => {
  it('muito cardio e comeu mal: alerta com os problemas', () => {
    let d = comMeals(defaultData(), [
      meal(ONTEM, '08:00', 'Café da manhã', [item({ nome: 'Biscoito recheado', calorias: 500, proteina: 5, carboidratos: 70, gordura: 22, nova: 4 })]),
      meal(ONTEM, '13:00', 'Almoço', [item({ calorias: 450, proteina: 25, carboidratos: 50, gordura: 15, nova: 4 })]),
      meal(ONTEM, '20:00', 'Jantar', [item({ calorias: 300, proteina: 20, carboidratos: 30, gordura: 10, nova: 1 })]),
    ]);
    d = { ...d, cardio: { x: cardio(ONTEM, { id: 'x', tipo: 'corrida', minutos: 60, intensidade: 'moderada' }) } };
    const r = coachReport(d, ONTEM);
    const a = r.insights.find((i) => i.id === 'cardio_dieta')!;
    expect(a.tipo).toBe('alerta');
    expect(a.texto).toContain('metabolismo basal');
    expect(a.texto).toContain('proteína baixa');
    expect(a.texto).toContain('ultraprocessados');
    expect(r.insights[0].tipo).toBe('alerta');
    expect(ids(d, ONTEM)).toContain('energia_deficit_grande');
  });

  it('muito cardio e comeu bem: ponto positivo', () => {
    let d = comMeals(defaultData(), diaBom(ONTEM));
    d = { ...d, cardio: { x: cardio(ONTEM, { id: 'x', tipo: 'bike', minutos: 45, intensidade: 'moderada' }) } };
    expect(ids(d, ONTEM)).toContain('cardio_dieta_ok');
    expect(ids(d, ONTEM)).not.toContain('cardio_dieta');
  });

  it('cardio intenso antes da musculação e na véspera do treino de pernas', () => {
    const plan = initialPlan(addDays(HOJE, -30));
    const inicio = new Date(`${ONTEM}T10:00:00`).getTime();
    const s: Session = { id: 'sA', planId: plan.id, key: 'A', titulo: 'Costas e bíceps', dataOriginal: ONTEM, dataAtual: ONTEM, dataReal: ONTEM, status: 'concluida', inicio, fim: inicio + 50 * 60000, intervalos: [{ i: inicio, f: inicio + 50 * 60000 }], duracaoSeg: 3000, slots: {}, historicoDatas: [] };
    const b: Session = { ...s, id: 'sB', key: 'B', titulo: 'Pernas', dataOriginal: HOJE, dataAtual: HOJE, dataReal: undefined, status: 'pendente', inicio: undefined, fim: undefined, intervalos: [], duracaoSeg: undefined };
    let d: AppData = { ...comMeals(defaultData(), diaBom(ONTEM)), plans: { [plan.id]: plan }, sessions: { sA: s, sB: b } };
    d = { ...d, cardio: { h: cardio(ONTEM, { id: 'h', tipo: 'hiit', minutos: 25, intensidade: 'intensa', hora: '09:20' }) } };
    const got = ids(d, ONTEM);
    expect(got).toContain('cardio_antes_h');
    expect(got).toContain('cardio_vespera_pernas');
    // cardio leve depois do treino é a ordem certa
    d = { ...d, cardio: { w: cardio(ONTEM, { id: 'w', tipo: 'caminhada', minutos: 30, intensidade: 'leve', hora: '11:00' }) } };
    expect(ids(d, ONTEM)).toContain('cardio_depois_w');
    expect(ids(d, ONTEM)).not.toContain('cardio_vespera_pernas');
  });

  it('hoje: muito cardio com o limite de calorias sugere repor metade', () => {
    const d = { ...comMeals(defaultData(), [meal(HOJE, '08:00', 'Café da manhã', [item({ calorias: 400, proteina: 30, carboidratos: 40, gordura: 10 })])]), cardio: { x: cardio(HOJE, { id: 'x', tipo: 'esteira_inclinada', minutos: 90 }) } };
    const i = coachReport(d, HOJE).insights.find((x) => x.id === 'energia_hoje_cardio')!;
    expect(i.texto).toContain('350 kcal');
  });

  it('hábitos que não batem com os registros', () => {
    const d = comMeals(defaultData(), [...diaBom(ONTEM), meal(ONTEM, '17:00', 'Lanche da tarde', [item({ nome: 'Capuccino em pó', calorias: 65, carboidratos: 9, acucar: 4, nova: 4 })])]);
    d.habits = {
      a: { id: 'a', nome: 'Sem açúcar refinado', inicio: addDays(HOJE, -10), criadoEm: 1, ordem: 1 },
      e: { id: 'e', nome: 'Esteira 30min', inicio: addDays(HOJE, -10), criadoEm: 1, ordem: 2 },
    };
    for (const h of ['a', 'e']) d.habitChecks[checkId(h, ONTEM)] = { id: checkId(h, ONTEM), habitId: h, date: ONTEM, em: 1 };
    const r = coachReport(d, ONTEM);
    expect(r.insights.find((i) => i.id === 'habito_acucar')?.texto).toContain('Capuccino em pó (4 g)');
    expect(r.insights.some((i) => i.id === 'habito_cardio_e')).toBe(true);
    expect(r.insights.find((i) => i.id === 'cafeina_tarde')?.texto).toContain('17:00');
  });

  it('o texto para a IA traz cardio, energia, fontes e o que o app não mede', () => {
    const d = { ...comMeals(defaultData(), diaBom(ONTEM)), cardio: { x: cardio(ONTEM, { id: 'x', tipo: 'bike', minutos: 45, watts: 150 }) } };
    const t = coachText(coachReport(d, ONTEM));
    expect(t).toContain('CARDIO DO DIA');
    expect(t).toContain('Bicicleta, 45 min');
    expect(t).toContain('equação de bicicleta do ACSM');
    expect(t).toContain('ENERGIA: gasto estimado');
    expect(t).toContain('fonte:');
    expect(t).toContain('Sono');
    // o cardio aparece no dia do calendário sem mudar a nota
    expect(evaluateDay(d, ONTEM).status).toBe('good');
    expect(evaluateDay(d, ONTEM).acertos.join(' ')).toContain('Cardio: 45 min');
  });
});
