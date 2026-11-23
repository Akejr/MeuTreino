/** Ações dos hábitos (gravam no aparelho e entram na sincronização). */
import { setData } from '../lib/storage';
import { daysBetween, todayISO, uid } from '../lib/utils';
import type { Habit, HabitCheck } from '../types';
import { checkId, isActiveOn } from './habits';

export function addHabit(nome: string, hoje = todayISO()) {
  const n = nome.trim();
  if (!n) return;
  setData((d) => {
    const ordem = Math.max(0, ...Object.values(d.habits).map((h) => h.ordem)) + 1;
    const h: Habit = { id: uid(), nome: n.slice(0, 60), inicio: hoje, criadoEm: Date.now(), ordem };
    return { ...d, habits: { ...d.habits, [h.id]: h } };
  });
}

export function renameHabit(id: string, nome: string) {
  const n = nome.trim();
  if (!n) return;
  setData((d) => (d.habits[id] ? { ...d, habits: { ...d.habits, [id]: { ...d.habits[id], nome: n.slice(0, 60) } } } : d));
}

/** Marca ou desmarca um dia (até 7 dias para trás). */
export function toggleHabit(habitId: string, date: string, hoje = todayISO()) {
  if (date > hoje || daysBetween(date, hoje) > 7) return;
  setData((d) => {
    const h = d.habits[habitId];
    if (!h || !isActiveOn(h, date)) return d;
    const id = checkId(habitId, date);
    const habitChecks = { ...d.habitChecks };
    if (habitChecks[id]) delete habitChecks[id];
    else habitChecks[id] = { id, habitId, date, em: Date.now() } satisfies HabitCheck;
    return { ...d, habitChecks };
  });
}

/** Para de contar a partir de hoje, mantendo o histórico. */
export function archiveHabit(id: string, hoje = todayISO()) {
  setData((d) => (d.habits[id] ? { ...d, habits: { ...d.habits, [id]: { ...d.habits[id], arquivadoEm: hoje } } } : d));
}

/** Volta a contar hoje. Os dias em que ficou arquivado não contam como falha. */
export function restoreHabit(id: string, hoje = todayISO()) {
  setData((d) => {
    const h = d.habits[id];
    if (!h?.arquivadoEm) return d;
    const pausas = h.arquivadoEm < hoje ? [...(h.pausas ?? []), { de: h.arquivadoEm, ate: hoje }] : h.pausas;
    const { arquivadoEm: _a, ...rest } = h;
    return { ...d, habits: { ...d.habits, [id]: { ...rest, pausas } } };
  });
}

/** Apaga o hábito e todo o histórico dele. */
export function deleteHabit(id: string) {
  setData((d) => {
    const habits = { ...d.habits };
    delete habits[id];
    const habitChecks = { ...d.habitChecks };
    for (const k of Object.keys(habitChecks)) if (habitChecks[k].habitId === id) delete habitChecks[k];
    return { ...d, habits, habitChecks };
  });
}
