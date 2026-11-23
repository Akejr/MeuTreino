import type { AppData, Macros, Meal, Session } from '../types';
import { todayISO } from './utils';

export type DayStatus = 'good' | 'ok' | 'bad' | 'empty';

export const emptyMacros = (): Macros => ({ calorias: 0, proteina: 0, gordura: 0, carboidratos: 0 });

export function sumMacros(items: Macros[]): Macros {
  return items.reduce(
    (a, i) => ({
      calorias: a.calorias + (Number(i.calorias) || 0),
      proteina: a.proteina + (Number(i.proteina) || 0),
      gordura: a.gordura + (Number(i.gordura) || 0),
      carboidratos: a.carboidratos + (Number(i.carboidratos) || 0),
    }),
    emptyMacros(),
  );
}

export const mealsOf = (data: AppData, date: string): Meal[] =>
  Object.values(data.meals)
    .filter((m) => m.date === date)
    .sort((a, b) => a.hora.localeCompare(b.hora));

export const dayTotals = (data: AppData, date: string) => sumMacros(mealsOf(data, date).flatMap((m) => m.itens));

/** Sessões que aconteceram (ou estavam marcadas) no dia. */
export function sessionsOn(data: AppData, date: string) {
  const feitas: Session[] = [];
  const naoFeitas: Session[] = [];
  for (const s of Object.values(data.sessions)) {
    const dia = s.dataReal ?? s.dataAtual;
    if ((s.status === 'concluida' || s.status === 'parcial' || s.status === 'em_andamento') && dia === date) feitas.push(s);
    else if (s.status === 'falta' && s.dataAtual === date) naoFeitas.push(s);
    else if (s.historicoDatas.some((h) => h.motivo === 'falta' && h.de === date)) naoFeitas.push(s);
    else if (s.status === 'pendente' && s.dataAtual === date && date < todayISO()) naoFeitas.push(s);
  }
  return { feitas, naoFeitas };
}

export interface DayEval {
  status: DayStatus;
  totals: Macros;
  meals: Meal[];
  treinos: Session[];
  faltas: Session[];
  motivos: string[];
}

/**
 * Regras:
 * - Calorias/gordura/carbo: até 3% acima = ok; 3–15% acima = 1 ponto; >15% = 2 pontos.
 * - Proteína (meta): >= 90% ok; 70–90% = 1 ponto; < 70% = 2 pontos.
 * - Sem refeições registradas = 2 pontos. Treino perdido = 1 ponto.
 * - 0 pontos = bom, 1–2 = mais ou menos, 3+ = ruim.
 * Hoje não é penalizado por "faltar" proteína ou refeições (o dia está em andamento).
 */
export function evaluateDay(data: AppData, date: string): DayEval {
  const meals = mealsOf(data, date);
  const totals = sumMacros(meals.flatMap((m) => m.itens));
  const { feitas, naoFeitas } = sessionsOn(data, date);
  const motivos: string[] = [];
  const base = { totals, meals, treinos: feitas, faltas: naoFeitas, motivos };
  const today = todayISO();

  if (date > today || (meals.length === 0 && !feitas.length && !naoFeitas.length)) return { ...base, status: 'empty' };

  const L = data.settings.limits;
  const emAndamento = date === today;
  let pts = 0;

  if (meals.length === 0) {
    if (!emAndamento) {
      pts += 2;
      motivos.push('Nenhuma refeição registrada');
    }
  } else {
    const maximos = [
      ['calorias', 'Calorias'],
      ['gordura', 'Gordura'],
      ['carboidratos', 'Carboidratos'],
    ] as const;
    for (const [k, label] of maximos) {
      if (!L[k]) continue;
      const r = totals[k] / L[k];
      if (r > 1.15) {
        pts += 2;
        motivos.push(`${label} ${Math.round((r - 1) * 100)}% acima do limite`);
      } else if (r > 1.03) {
        pts += 1;
        motivos.push(`${label} ${Math.round((r - 1) * 100)}% acima do limite`);
      }
    }
    if (L.proteina && !emAndamento) {
      const r = totals.proteina / L.proteina;
      if (r < 0.7) {
        pts += 2;
        motivos.push(`Proteína em ${Math.round(r * 100)}% da meta`);
      } else if (r < 0.9) {
        pts += 1;
        motivos.push(`Proteína em ${Math.round(r * 100)}% da meta`);
      }
    }
  }

  if (naoFeitas.length && !feitas.length) {
    pts += 1;
    motivos.push('Treino perdido');
  }
  if (emAndamento) motivos.push('Dia em andamento');

  return { ...base, status: pts === 0 ? 'good' : pts <= 2 ? 'ok' : 'bad' };
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  good: 'Bom',
  ok: 'Mais ou menos',
  bad: 'Ruim',
  empty: 'Sem dados',
};
