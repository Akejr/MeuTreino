/** Hábitos diários: marcação por dia e ofensiva (dias seguidos feitos). */
import { addDays, todayISO } from '../lib/utils';
import type { AppData, Habit } from '../types';

export const checkId = (habitId: string, date: string) => `${habitId}~${date}`;

/** O hábito conta neste dia? (depois do início, fora de pausas e antes de arquivar). */
export function isActiveOn(h: Habit, date: string): boolean {
  if (date < h.inicio) return false;
  if (h.arquivadoEm && date >= h.arquivadoEm) return false;
  return !(h.pausas ?? []).some((p) => date >= p.de && date < p.ate);
}

export const isDone = (d: AppData, habitId: string, date: string) => !!d.habitChecks[checkId(habitId, date)];

export function activeHabits(d: AppData, date = todayISO()): Habit[] {
  return Object.values(d.habits)
    .filter((h) => isActiveOn(h, date))
    .sort((a, b) => a.ordem - b.ordem || a.criadoEm - b.criadoEm);
}

export const archivedHabits = (d: AppData) =>
  Object.values(d.habits)
    .filter((h) => h.arquivadoEm && h.arquivadoEm <= todayISO())
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

export interface HabitStats {
  /** Dias seguidos feitos até hoje (hoje ainda sem marcar não quebra a sequência). */
  atual: number;
  melhor: number;
  feitoHoje: boolean;
  /** Sequência viva, mas hoje ainda não foi marcado. */
  emRisco: boolean;
  /** % dos dias ativos feitos nos últimos 30 dias. */
  taxa30: number;
  totalFeitos: number;
}

export function habitStats(d: AppData, h: Habit, hoje = todayISO()): HabitStats {
  const feitoHoje = isDone(d, h.id, hoje);
  // Atual: conta para trás a partir de hoje (se feito) ou de ontem, pulando dias em que o hábito não contava.
  let atual = 0;
  let dia = feitoHoje ? hoje : addDays(hoje, -1);
  for (let guard = 0; dia >= h.inicio && guard < 4000; guard++, dia = addDays(dia, -1)) {
    if (!isActiveOn(h, dia)) continue;
    if (!isDone(d, h.id, dia)) break;
    atual++;
  }
  // Melhor: maior sequência desde o início.
  let melhor = 0;
  let corrida = 0;
  let totalFeitos = 0;
  const fim = hoje;
  for (let x = h.inicio, guard = 0; x <= fim && guard < 4000; x = addDays(x, 1), guard++) {
    if (!isActiveOn(h, x)) continue;
    if (isDone(d, h.id, x)) {
      corrida++;
      totalFeitos++;
      melhor = Math.max(melhor, corrida);
    } else if (x !== hoje) corrida = 0;
  }
  let ativos = 0;
  let feitos = 0;
  for (let i = 0; i < 30; i++) {
    const x = addDays(hoje, -i);
    if (!isActiveOn(h, x) || (x === hoje && !feitoHoje)) continue;
    ativos++;
    if (isDone(d, h.id, x)) feitos++;
  }
  return { atual, melhor: Math.max(melhor, atual), feitoHoje, emRisco: !feitoHoje && atual > 0, taxa30: ativos ? Math.round((feitos / ativos) * 100) : 0, totalFeitos };
}

/** Dias seguidos com TODOS os hábitos ativos feitos (dias sem hábito ativo não contam nem quebram). */
export function perfectStreak(d: AppData, hoje = todayISO()): { atual: number; hojeCompleto: boolean } {
  const completo = (dia: string) => {
    const hs = Object.values(d.habits).filter((h) => isActiveOn(h, dia));
    return hs.length > 0 ? hs.every((h) => isDone(d, h.id, dia)) : null;
  };
  const hojeCompleto = completo(hoje) === true;
  const primeiro = Object.values(d.habits).reduce((m, h) => (h.inicio < m ? h.inicio : m), hoje);
  let atual = 0;
  let dia = hojeCompleto ? hoje : addDays(hoje, -1);
  for (let guard = 0; dia >= primeiro && guard < 4000; guard++, dia = addDays(dia, -1)) {
    const c = completo(dia);
    if (c === null) continue;
    if (!c) break;
    atual++;
  }
  return { atual, hojeCompleto };
}

/** Hábitos que contavam e não foram feitos num dia. */
export function missedOn(d: AppData, date: string): { ativos: Habit[]; faltou: Habit[] } {
  const ativos = Object.values(d.habits).filter((h) => isActiveOn(h, date));
  return { ativos, faltou: ativos.filter((h) => !isDone(d, h.id, date)) };
}
