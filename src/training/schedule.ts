/**
 * Agenda como fila: as sessões seguem a ordem da ficha. Cada pendência vai para o próximo
 * dia disponível da semana (dias de treino primeiro, depois sábado e domingo se estiverem
 * disponíveis). O que não couber passa para a semana seguinte. Nunca duas sessões no mesmo dia.
 */
import type { AppData, PlanSession, PlanVersion, Session } from '../types';
import { addDays, dow, todayISO as todayISOLocal, weekStart, weekdayName } from '../lib/utils';
import { getEx, resolveExercise, GRUPO_LABEL, type Grupo } from './catalog';

export function activePlan(d: AppData): PlanVersion | undefined {
  return Object.values(d.plans)
    .filter((p) => p.status === 'ativa')
    .sort((a, b) => b.versao - a.versao || b.criadoEm - a.criadoEm)[0];
}

export const sessionIdFor = (week: string, key: string) => `s-${week}-${key}`;

/** Sessão da ficha, com os exercícios acrescentados só neste dia e na ordem que ele escolheu para hoje. */
export function planSessionOf(d: AppData, s: Session): PlanSession | undefined {
  const ps = d.plans[s.planId]?.sessoes.find((x) => x.key === s.key);
  if (!ps || (!s.extras?.length && !s.ordem?.length)) return ps;
  let slots = s.extras?.length ? [...ps.slots, ...s.extras] : [...ps.slots];
  if (s.ordem?.length) {
    // Vaga fora da lista (ex.: exercício extra acrescentado depois) fica no fim, na ordem original.
    const pos = new Map(s.ordem.map((id, i) => [id, i]));
    slots = slots
      .map((x, i) => ({ x, k: pos.get(x.id) ?? 1e6 + i }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.x);
  }
  return { ...ps, slots };
}

const keyOrder = (k: string) => k.charCodeAt(0);
const byQueueOrder = (a: Session, b: Session) => a.dataOriginal.localeCompare(b.dataOriginal) || keyOrder(a.key) - keyOrder(b.key);

/** Gera (sem duplicar) as sessões da semana atual e da seguinte para a ficha ativa. */
export function ensureSessions(d: AppData, hoje: string): AppData {
  const plan = activePlan(d);
  if (!plan) return d;
  let sessions = d.sessions;
  const w0 = weekStart(hoje);
  for (const w of [w0, addDays(w0, 7)]) {
    for (const ps of plan.sessoes) {
      const date = addDays(w, ps.dia - 1);
      if (date < plan.vigenciaInicio) continue;
      const id = sessionIdFor(w, ps.key);
      if (sessions[id]) continue;
      if (sessions === d.sessions) sessions = { ...d.sessions };
      sessions[id] = {
        id,
        planId: plan.id,
        key: ps.key,
        titulo: ps.titulo,
        dataOriginal: date,
        dataAtual: date,
        status: 'pendente',
        intervalos: [],
        slots: {},
        historicoDatas: [],
        _u: 1,
      };
    }
  }
  return sessions === d.sessions ? d : { ...d, sessions };
}

/** Sessão aberta com o cronômetro parado (pausada para continuar depois). */
export const isPaused = (s: Session) => s.status === 'em_andamento' && s.intervalos.length > 0 && s.intervalos[s.intervalos.length - 1].f != null;

/** Sessão sendo feita agora (aberta e não pausada). */
export function activeSession(d: AppData): Session | undefined {
  return Object.values(d.sessions).find((s) => s.status === 'em_andamento' && !isPaused(s));
}

export const inQueue = (s: Session) => s.status === 'pendente' || (s.status === 'parcial' && !!s.retomar);

export function queue(d: AppData): Session[] {
  return Object.values(d.sessions).filter(inQueue).sort(byQueueOrder);
}

/** Próxima sessão a fazer: a em andamento, ou a primeira da fila. */
export function nextSession(d: AppData): Session | undefined {
  const aberta = Object.values(d.sessions).find((s) => s.status === 'em_andamento');
  if (aberta) return aberta;
  return queue(d).sort((a, b) => a.dataAtual.localeCompare(b.dataAtual) || byQueueOrder(a, b))[0];
}

export function overdue(d: AppData, hoje: string): Session[] {
  return queue(d).filter((s) => s.dataAtual < hoje);
}

export function openFromPast(d: AppData, hoje: string): Session | undefined {
  return Object.values(d.sessions).find((s) => s.status === 'em_andamento' && (s.dataReal ?? s.dataAtual) < hoje);
}

export interface Change {
  id: string;
  de: string;
  para: string;
  motivo: 'falta' | 'reagendado' | 'retomar';
}

export interface ReschedulePlan {
  changes: Change[];
  avisos: string[];
  mensagem: string;
}

function dateScore(d: AppData, iso: string): number {
  const tipo = d.settings.training.dias[dow(iso)];
  if (tipo === 'treino') return 0;
  return dow(iso) === 0 ? 2 : 1;
}

function dateUsable(d: AppData, iso: string) {
  return d.settings.training.dias[dow(iso)] !== 'indisponivel';
}

/**
 * Recalcula as datas das pendências a partir de `from`.
 * `faltaIds`: sessões que o usuário marcou como falta agora (ex.: "hoje não vou treinar").
 */
export function computeReschedule(d: AppData, hoje: string, opts: { from?: string; faltaIds?: string[]; retomarIds?: string[] } = {}): ReschedulePlan {
  const from = opts.from ?? hoje;
  const q = queue(d);
  const ocupadas = new Set<string>();
  for (const s of Object.values(d.sessions)) {
    if (inQueue(s) || s.status === 'falta') continue;
    ocupadas.add(s.dataReal ?? s.dataAtual);
  }

  const assigned = new Map<string, string>();
  let idx = 0;
  let week = weekStart(from);
  for (let guard = 0; idx < q.length && guard < 104; guard++, week = addDays(week, 7)) {
    const datas: string[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(week, i);
      if (iso >= from && dateUsable(d, iso) && !ocupadas.has(iso)) datas.push(iso);
    }
    const elig: Session[] = [];
    for (let j = idx; j < q.length && weekStart(q[j].dataOriginal) <= week; j++) elig.push(q[j]);
    const k = Math.min(elig.length, datas.length);
    const escolhidas = [...datas]
      .sort((a, b) => dateScore(d, a) - dateScore(d, b) || a.localeCompare(b))
      .slice(0, k)
      .sort();
    for (let i = 0; i < k; i++) assigned.set(elig[i].id, escolhidas[i]);
    idx += k;
  }

  const faltas = new Set(opts.faltaIds ?? []);
  const retomar = new Set(opts.retomarIds ?? []);
  const changes: Change[] = [];
  for (const s of q) {
    const para = assigned.get(s.id);
    if (!para || para === s.dataAtual) continue;
    const motivo = retomar.has(s.id) ? 'retomar' : faltas.has(s.id) || s.dataAtual < from ? 'falta' : 'reagendado';
    changes.push({ id: s.id, de: s.dataAtual, para, motivo });
  }

  const avisos = proximityWarnings(d, assigned, from);
  const mensagem = changes.length
    ? changes
        .map((c) => {
          const s = d.sessions[c.id];
          return `${s.key} · ${s.titulo}: ${weekdayName(c.de)} ${c.de.slice(8)}/${c.de.slice(5, 7)} → ${weekdayName(c.para)} ${c.para.slice(8)}/${c.para.slice(5, 7)}`;
        })
        .join('\n')
    : 'Nenhuma data precisa mudar.';
  return { changes, avisos, mensagem };
}

function mainGroups(d: AppData, s: Session): Set<Grupo> {
  const ps = planSessionOf(d, s);
  const count = new Map<Grupo, number>();
  for (const slot of ps?.slots ?? []) {
    const g = getEx(resolveExercise(slot.exerciseId, d.settings.training) ?? slot.exerciseId).grupo;
    count.set(g, (count.get(g) ?? 0) + slot.series);
  }
  return new Set([...count].filter(([, n]) => n >= 3).map(([g]) => g));
}

/** Avisa sessões em dias seguidos que repetem um grupo principal (ex.: costas no sábado e na segunda não; domingo e segunda sim). */
function proximityWarnings(d: AppData, assigned: Map<string, string>, from: string): string[] {
  const timeline: { date: string; s: Session }[] = [];
  for (const s of Object.values(d.sessions)) {
    const date = assigned.get(s.id) ?? (s.status === 'falta' ? undefined : s.dataReal ?? s.dataAtual);
    if (date && date >= addDays(from, -1)) timeline.push({ date, s });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date));
  const avisos: string[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (addDays(a.date, 1) !== b.date) continue;
    const ga = mainGroups(d, a.s);
    const comuns = [...mainGroups(d, b.s)].filter((g) => ga.has(g));
    if (comuns.length) {
      avisos.push(
        `${a.s.key} (${weekdayName(a.date)}) e ${b.s.key} (${weekdayName(b.date)}) ficaram em dias seguidos e repetem ${comuns.map((g) => GRUPO_LABEL[g].toLowerCase()).join(' e ')}.`,
      );
    }
  }
  return avisos;
}

/** Aplica as mudanças numa única operação, guardando o histórico de datas. */
export function applyChanges(d: AppData, changes: Change[]): AppData {
  if (!changes.length) return d;
  const sessions = { ...d.sessions };
  const now = Date.now();
  for (const c of changes) {
    const s = sessions[c.id];
    if (!s) continue;
    sessions[c.id] = { ...s, dataAtual: c.para, historicoDatas: [...s.historicoDatas, { de: c.de, para: c.para, motivo: c.motivo, em: now }] };
  }
  return { ...d, sessions };
}

/** Move uma sessão para outra data; se já houver pendência lá, as duas trocam de data. */
export function moveSession(d: AppData, id: string, para: string): AppData {
  const s = d.sessions[id];
  if (!s || s.dataAtual === para) return d;
  const outra = queue(d).find((x) => x.id !== id && x.dataAtual === para);
  const changes: Change[] = [{ id, de: s.dataAtual, para, motivo: 'reagendado' }];
  if (outra) changes.push({ id: outra.id, de: outra.dataAtual, para: s.dataAtual, motivo: 'reagendado' });
  return applyChanges(d, changes);
}

export interface DayCell {
  date: string;
  sessoes: Session[];
  faltas: Session[];
}

/** Sessões previstas pela ficha ativa numa semana ainda sem sessões criadas (só para mostrar). */
function plannedWeek(d: AppData, w: string): Session[] {
  const plan = activePlan(d);
  if (!plan) return [];
  const fim = addDays(w, 6);
  const temSessao = Object.values(d.sessions).some((s) => s.dataOriginal >= w && s.dataOriginal <= fim);
  if (temSessao) return [];
  return plan.sessoes
    .map((ps) => ({ ps, date: addDays(w, ps.dia - 1) }))
    .filter(({ date }) => date >= plan.vigenciaInicio)
    .map(({ ps, date }) => ({
      id: `v-${w}-${ps.key}`,
      planId: plan.id,
      key: ps.key,
      titulo: ps.titulo,
      dataOriginal: date,
      dataAtual: date,
      status: 'pendente' as const,
      intervalos: [],
      slots: {},
      historicoDatas: [],
      virtual: true,
    }));
}

/** Semana (seg–dom) com as sessões de cada dia e as faltas registradas. */
export function weekView(d: AppData, anyDate: string): DayCell[] {
  const w = weekStart(anyDate);
  const cells: DayCell[] = Array.from({ length: 7 }, (_, i) => ({ date: addDays(w, i), sessoes: [], faltas: [] }));
  const at = new Map(cells.map((c) => [c.date, c]));
  for (const s of Object.values(d.sessions)) {
    const date = s.status === 'falta' ? undefined : s.dataReal ?? s.dataAtual;
    if (date && at.has(date)) at.get(date)!.sessoes.push(s);
    // Parcial a retomar: aparece também no dia em que o restante foi marcado.
    if (s.retomar && s.dataAtual !== date && at.has(s.dataAtual)) at.get(s.dataAtual)!.sessoes.push(s);
    if (s.status === 'falta' && at.has(s.dataAtual)) at.get(s.dataAtual)!.faltas.push(s);
    for (const h of s.historicoDatas) if (h.motivo === 'falta' && at.has(h.de)) at.get(h.de)!.faltas.push(s);
  }
  // Semanas futuras ainda não criadas mostram o que a ficha prevê (as datas reais são criadas quando a semana chega).
  if (w >= weekStart(todayISOLocal())) {
    for (const v of plannedWeek(d, w)) at.get(v.dataAtual)?.sessoes.push(v);
  }
  return cells;
}
