import { describe, expect, it } from 'vitest';
import { checkId, habitStats, perfectStreak } from '../habits/habits';
import { initialPlan } from '../training/initialPlan';
import type { AppData, FoodItem, Habit, Meal, Session, SetLog } from '../types';
import { defaultData } from './defaults';
import { mealChecks } from './nutrition';
import { normalizeNutriItems } from './nutriAI';
import { evaluateDay } from './score';
import { addDays, todayISO } from './utils';

const HOJE = todayISO();
const ONTEM = addDays(HOJE, -1);

let n = 0;
const item = (p: Partial<FoodItem>): FoodItem => ({ id: `i${++n}`, nome: 'x', quantidade: '', calorias: 0, proteina: 0, gordura: 0, carboidratos: 0, ...p });
const boa = () => item({ calorias: 470, proteina: 42, gordura: 13, carboidratos: 50, fibras: 8, acucar: 3, saturada: 3, sodio: 400, nova: 1 });
const meal = (date: string, hora: string, refeicao: string, itens: FoodItem[]): Meal => ({ id: `m${++n}`, date, hora, refeicao, itens, criadoEm: 1 });

function diaPerfeito(date: string): Record<string, Meal> {
  const ms = [meal(date, '08:00', 'Café da manhã', [boa()]), meal(date, '12:00', 'Almoço', [boa()]), meal(date, '16:00', 'Lanche da tarde', [boa()]), meal(date, '20:00', 'Jantar', [boa()])];
  return Object.fromEntries(ms.map((m) => [m.id, m]));
}

const base = (): AppData => ({ ...defaultData() });
const habit = (id: string, inicio: string, extra: Partial<Habit> = {}): Habit => ({ id, nome: id, inicio, criadoEm: 1, ordem: 1, ...extra });
const marcar = (d: AppData, habitId: string, ...datas: string[]) => {
  for (const date of datas) d.habitChecks[checkId(habitId, date)] = { id: checkId(habitId, date), habitId, date, em: 1 };
};

describe('calendário: qualquer falha aparece', () => {
  it('dia completo e equilibrado é bom', () => {
    const d = { ...base(), meals: diaPerfeito(ONTEM) };
    const ev = evaluateDay(d, ONTEM);
    expect(ev.issues).toEqual([]);
    expect(ev.status).toBe('good');
    expect(ev.acertos.length).toBeGreaterThan(3);
  });

  it('2% acima do limite de calorias já tira do "bom"', () => {
    const d = { ...base(), meals: diaPerfeito(ONTEM) };
    const extra = meal(ONTEM, '21:30', 'Ceia', [item({ calorias: 160, proteina: 2, fibras: 1, sodio: 50, nova: 1 })]);
    d.meals[extra.id] = extra;
    const ev = evaluateDay(d, ONTEM);
    expect(ev.status).toBe('ok');
    expect(ev.issues.some((i) => i.texto.includes('Calorias') && i.nivel === 1)).toBe(true);
  });

  it('refeição com muitas calorias é apontada como mal distribuída', () => {
    const d = { ...base(), meals: diaPerfeito(ONTEM) };
    const almoco = Object.values(d.meals).find((m) => m.refeicao === 'Almoço')!;
    almoco.itens = [item({ calorias: 1100, proteina: 60, gordura: 20, carboidratos: 150, fibras: 10, acucar: 2, saturada: 5, sodio: 500, nova: 1 })];
    const ev = evaluateDay(d, ONTEM);
    expect(ev.issues.some((i) => i.texto.includes('Mal distribuído'))).toBe(true);
    const checks = mealChecks(d, almoco);
    expect(checks.some((i) => i.texto.includes('do limite de calorias') && i.nivel === 2)).toBe(true);
  });

  it('fibras, sódio, açúcar e ultraprocessados entram na avaliação', () => {
    const d = { ...base(), meals: diaPerfeito(ONTEM) };
    for (const m of Object.values(d.meals)) m.itens = [{ ...m.itens[0], fibras: 2, sodio: 900, acucar: 12, nova: 4 }];
    const ev = evaluateDay(d, ONTEM);
    const txt = ev.issues.map((i) => i.texto).join(' | ');
    expect(txt).toContain('Fibras baixas');
    expect(txt).toContain('Sódio');
    expect(txt).toContain('Açúcar adicionado');
    expect(txt).toContain('ultraprocessados');
    expect(ev.status).toBe('bad');
  });

  it('dia sem refeições com hábito ativo é ruim; hábito não feito é falha', () => {
    const d = base();
    d.habits = { agua: habit('agua', addDays(HOJE, -10)) };
    const ev = evaluateDay(d, ONTEM);
    expect(ev.status).toBe('bad');
    expect(ev.issues.some((i) => i.area === 'habitos')).toBe(true);
    expect(ev.issues.some((i) => i.texto.includes('Nenhuma refeição') && i.nivel === 3)).toBe(true);
  });

  it('hoje: o que ainda dá para fazer fica como pendente, não como falha', () => {
    const d = base();
    d.habits = { agua: habit('agua', addDays(HOJE, -3)) };
    const m = meal(HOJE, '08:00', 'Café da manhã', [boa()]);
    d.meals = { [m.id]: m };
    const ev = evaluateDay(d, HOJE);
    expect(ev.issues).toEqual([]);
    expect(ev.pendentes.join(' ')).toContain('proteína');
    expect(ev.pendentes.join(' ')).toContain('agua');
  });

  it('treino incompleto e esforço não informado aparecem', () => {
    const d = base();
    const plan = initialPlan(addDays(HOJE, -30));
    d.plans = { [plan.id]: plan };
    d.meals = diaPerfeito(ONTEM);
    const s: Session = { id: 'sx', planId: plan.id, key: 'A', titulo: 'Costas e bíceps', dataOriginal: ONTEM, dataAtual: ONTEM, dataReal: ONTEM, status: 'concluida', intervalos: [], slots: {}, historicoDatas: [], duracaoSeg: 3000 };
    d.sessions = { sx: s };
    const set = (k: number, rir: number | null): SetLog => ({ id: `st${k}`, sessionId: 'sx', slotId: 'A1', exerciseId: 'puxada_neutra_aberta', equipId: 'puxada_alta', tipo: 'trabalho', posicao: k, status: 'feita', cargaSugerida: null, carga: 40, reps: 8, rir, ajuda: false, dor: false, unidade: 'kg', base: 'total', data: ONTEM, confirmadoEm: k });
    d.sets = { st1: set(1, null), st2: set(2, null), st3: set(3, 2) };
    const ev = evaluateDay(d, ONTEM);
    const txt = ev.issues.map((i) => i.texto).join(' | ');
    expect(txt).toContain('incompleto');
    expect(txt).toContain('Esforço não informado');
  });
});

describe('hábitos: ofensiva', () => {
  it('conta dias seguidos; hoje sem marcar não quebra, mas fica em risco', () => {
    const d = base();
    d.habits = { h: habit('h', addDays(HOJE, -10)) };
    marcar(d, 'h', addDays(HOJE, -3), addDays(HOJE, -2), ONTEM);
    let s = habitStats(d, d.habits.h, HOJE);
    expect(s.atual).toBe(3);
    expect(s.emRisco).toBe(true);
    marcar(d, 'h', HOJE);
    s = habitStats(d, d.habits.h, HOJE);
    expect(s.atual).toBe(4);
    expect(s.feitoHoje).toBe(true);
    expect(s.melhor).toBe(4);
  });

  it('um dia sem marcar zera; a melhor sequência fica guardada', () => {
    const d = base();
    d.habits = { h: habit('h', addDays(HOJE, -10)) };
    marcar(d, 'h', addDays(HOJE, -9), addDays(HOJE, -8), addDays(HOJE, -7), addDays(HOJE, -6), addDays(HOJE, -4), ONTEM);
    const s = habitStats(d, d.habits.h, HOJE);
    expect(s.atual).toBe(1);
    expect(s.melhor).toBe(4);
  });

  it('dias arquivados não quebram a sequência', () => {
    const d = base();
    d.habits = { h: habit('h', addDays(HOJE, -6), { pausas: [{ de: addDays(HOJE, -3), ate: ONTEM }] }) };
    marcar(d, 'h', addDays(HOJE, -5), addDays(HOJE, -4), ONTEM);
    expect(habitStats(d, d.habits.h, HOJE).atual).toBe(3);
  });

  it('ofensiva perfeita só conta dias com todos os hábitos', () => {
    const d = base();
    d.habits = { a: habit('a', addDays(HOJE, -5)), b: habit('b', addDays(HOJE, -5)) };
    marcar(d, 'a', addDays(HOJE, -2), ONTEM, HOJE);
    marcar(d, 'b', ONTEM, HOJE);
    expect(perfectStreak(d, HOJE)).toEqual({ atual: 2, hojeCompleto: true });
  });
});

describe('resposta da IA de nutrição', () => {
  it('lê fibras, açúcar, saturada, sódio, NOVA e cadastro; ignora lixo', () => {
    const foods = { f1: { id: 'f1', nome: 'Whey', apelidos: '', porcao: '30 g', porcaoQtd: 30, porcaoUnidade: 'g' as const, calorias: 120, proteina: 24, gordura: 1.5, carboidratos: 3, obs: '', criadoEm: 1 } };
    const [a, b] = normalizeNutriItems(
      [
        { nome: 'Whey', quantidade: '30 g', calorias: 120, proteina: 24, gordura: 1.5, carboidratos: 3, fibras: 0, acucar_adicionado: 0, gordura_saturada: 1, sodio: 50.4, nova: 4, suplemento: true, alimento_id: 'f1' },
        { nome: 'Pão', calorias: '150,5', proteina: -3, fibras: null, nova: 9, alimento_id: 'nao-existe' },
      ],
      foods,
    );
    expect(a).toMatchObject({ fibras: 0, acucar: 0, saturada: 1, sodio: 50, nova: 4, suplemento: true, foodId: 'f1' });
    expect(b.calorias).toBe(150.5);
    expect(b.proteina).toBe(0);
    expect(b.fibras).toBeUndefined();
    expect(b.nova).toBeUndefined();
    expect(b.foodId).toBeUndefined();
  });
});
