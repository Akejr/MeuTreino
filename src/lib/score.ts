/**
 * Avaliação de cada dia do calendário. Qualquer falha, por menor que seja, aparece.
 * - Cada falha tem um nível: leve (1 ponto), média (2) ou grave (4).
 * - Bom = nenhuma falha. Ruim = alguma falha grave ou 5 pontos ou mais. O resto é "mais ou menos".
 * - Hoje só contam os excessos e o que já terminou; o que ainda dá para fazer aparece como pendente.
 */
import { missedOn } from '../habits/habits';
import { sessionSteps } from '../training/engine';
import { planSessionOf } from '../training/schedule';
import type { AppData, Macros, Meal, Session, SetLog } from '../types';
import { dietDay, type Issue, type Nivel } from './nutrition';
import { todayISO } from './utils';

export type DayStatus = 'good' | 'ok' | 'bad' | 'empty';
export type { Issue, Nivel };

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
  const remarcadas: Session[] = [];
  for (const s of Object.values(data.sessions)) {
    const dia = s.dataReal ?? s.dataAtual;
    if ((s.status === 'concluida' || s.status === 'parcial' || s.status === 'em_andamento') && dia === date) feitas.push(s);
    else if (s.status === 'falta' && s.dataAtual === date) naoFeitas.push(s);
    else if (s.status === 'pendente' && s.dataAtual === date && date < todayISO()) naoFeitas.push(s);
    else if (s.historicoDatas.some((h) => h.motivo === 'falta' && h.de === date)) remarcadas.push(s);
  }
  return { feitas, naoFeitas: [...naoFeitas, ...remarcadas], perdidas: naoFeitas, remarcadas };
}

const setsCache = new WeakMap<object, Map<string, SetLog[]>>();
function setsBySession(sets: Record<string, SetLog>): Map<string, SetLog[]> {
  const hit = setsCache.get(sets);
  if (hit) return hit;
  const m = new Map<string, SetLog[]>();
  for (const s of Object.values(sets)) {
    const arr = m.get(s.sessionId);
    if (arr) arr.push(s);
    else m.set(s.sessionId, [s]);
  }
  setsCache.set(sets, m);
  return m;
}

export interface DayEval {
  status: DayStatus;
  totals: Macros;
  meals: Meal[];
  treinos: Session[];
  faltas: Session[];
  issues: Issue[];
  /** O que ainda falta fazer hoje. */
  pendentes: string[];
  acertos: string[];
  notas: string[];
  pontos: number;
  /** Textos das falhas (compatível com as telas antigas). */
  motivos: string[];
}

const PESO: Record<Nivel, number> = { 1: 1, 2: 2, 3: 4 };

function trainingIssues(data: AppData, date: string, finished: boolean, out: { issues: Issue[]; pendentes: string[]; acertos: string[] }) {
  const { feitas, perdidas, remarcadas } = sessionsOn(data, date);
  const add = (nivel: Nivel, texto: string) => out.issues.push({ area: 'treino', nivel, texto });
  const t = data.settings.training;
  const porSessao = setsBySession(data.sets);

  for (const s of perdidas) add(2, `Treino **${s.key} · ${s.titulo}** não feito.`);
  for (const s of remarcadas) add(1, `Falta no treino **${s.key}**: foi remarcado para outro dia.`);

  for (const s of feitas) {
    const sets = (porSessao.get(s.id) ?? []).filter((x) => x.status === 'feita');
    const trabalho = sets.filter((x) => x.tipo === 'trabalho');
    if (s.status === 'em_andamento') {
      const pausado = s.intervalos.length > 0 && s.intervalos[s.intervalos.length - 1].f != null;
      if (finished) add(1, `Treino **${s.key}** ficou aberto${pausado ? ' (pausado)' : ''} e não foi encerrado.`);
      else out.pendentes.push(`Treino **${s.key}** ${pausado ? 'pausado' : 'em andamento'}: ${trabalho.length} séries feitas.`);
      continue;
    }
    const ps = planSessionOf(data, s);
    // Exercício acrescentado por ele é opcional: não conta para "incompleto".
    const extras = new Set((s.extras ?? []).map((x) => x.id));
    const previstas = ps ? sessionSteps(ps, s, t).filter((x) => x.tipo === 'trabalho' && !extras.has(x.slotId)).length : trabalho.length;
    const daFicha = trabalho.filter((x) => !extras.has(x.slotId)).length;
    if (!trabalho.length) add(2, `Treino **${s.key}** encerrado sem nenhuma série de trabalho.`);
    else if (daFicha < previstas) add(1, `Treino **${s.key}** incompleto: **${daFicha} de ${previstas}** séries de trabalho.`);
    else out.acertos.push(`Treino ${s.key} completo (${trabalho.length} séries).`);

    const semEsforco = trabalho.filter((x) => x.rir == null).length;
    if (semEsforco >= 2 && semEsforco >= trabalho.length / 3) add(1, `Esforço não informado em **${semEsforco} séries**: sem isso a carga não sobe.`);
    const alerta = sets.some((x) => x.dorTipo === 'alerta');
    if (alerta) add(3, 'Sintoma de alerta registrado no treino (dor no peito, desmaio ou falta de ar). Procure avaliação antes de treinar de novo.');
    else if (sets.some((x) => x.dor)) add(1, `Dor registrada no treino **${s.key}**.`);
    if (s.duracaoSeg && s.duracaoSeg / 60 > t.duracaoMin + 20) add(1, `Treino **${s.key}** durou **${Math.round(s.duracaoSeg / 60)} min** (alvo ${t.duracaoMin} min).`);
  }

  if (!finished) {
    const hoje = Object.values(data.sessions).find((s) => s.status === 'pendente' && s.dataAtual === date);
    if (hoje) out.pendentes.push(`Treino **${hoje.key} · ${hoje.titulo}** ainda não feito.`);
  }
}

function habitIssues(data: AppData, date: string, finished: boolean, out: { issues: Issue[]; pendentes: string[]; acertos: string[] }) {
  const { ativos, faltou } = missedOn(data, date);
  if (!ativos.length) return;
  if (!faltou.length) {
    out.acertos.push(`Todos os ${ativos.length} hábitos feitos.`);
    return;
  }
  const nomes = faltou.map((h) => `**${h.nome}**`).join(', ');
  if (!finished) out.pendentes.push(`Hábitos pendentes: ${nomes}.`);
  else out.issues.push({ area: 'habitos', nivel: faltou.length >= 2 && faltou.length >= ativos.length / 2 ? 2 : 1, texto: `Hábitos não feitos: ${nomes} (${faltou.length} de ${ativos.length}).` });
}

export function evaluateDay(data: AppData, date: string): DayEval {
  const today = todayISO();
  const meals = mealsOf(data, date);
  const totals = sumMacros(meals.flatMap((m) => m.itens));
  const { feitas, naoFeitas } = sessionsOn(data, date);
  const base = { totals, meals, treinos: feitas, faltas: naoFeitas };
  const vazio: DayEval = { ...base, status: 'empty', issues: [], pendentes: [], acertos: [], notas: [], pontos: 0, motivos: [] };
  if (date > today) return vazio;

  const temHabitos = missedOn(data, date).ativos.length > 0;
  if (!meals.length && !feitas.length && !naoFeitas.length && !temHabitos) return vazio;

  const finished = date < today;
  const diet = dietDay(data, meals, finished);
  const out = { issues: [...diet.issues], pendentes: [...diet.pendentes], acertos: [...diet.acertos] };
  trainingIssues(data, date, finished, out);
  habitIssues(data, date, finished, out);

  const pontos = out.issues.reduce((n, i) => n + PESO[i.nivel], 0);
  const grave = out.issues.some((i) => i.nivel === 3);
  let status: DayStatus = !out.issues.length ? 'good' : grave || pontos >= 5 ? 'bad' : 'ok';
  // Hoje sem nada registrado nem feito: ainda não há o que avaliar.
  if (!finished && !out.issues.length && !meals.length && !feitas.length && !out.acertos.length) status = 'empty';
  return {
    ...base,
    status,
    issues: out.issues.sort((a, b) => b.nivel - a.nivel),
    pendentes: out.pendentes,
    acertos: out.acertos,
    notas: diet.notas,
    pontos,
    motivos: out.issues.map((i) => i.texto.replace(/\*\*/g, '')),
  };
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  good: 'Bom',
  ok: 'Mais ou menos',
  bad: 'Ruim',
  empty: 'Sem dados',
};
