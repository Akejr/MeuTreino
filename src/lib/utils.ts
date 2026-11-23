export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}

/** 0 = domingo … 6 = sábado. */
export const dow = (iso: string) => parseISO(iso).getDay();

/** Segunda-feira da semana da data. */
export function weekStart(iso: string): string {
  const d = dow(iso);
  return addDays(iso, d === 0 ? -6 : 1 - d);
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const weekdayName = (iso: string) => WEEKDAYS[dow(iso)];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const monthKey = (iso: string) => iso.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  return Array.from({ length: total }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function nowHHMM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatLong(iso: string): string {
  const s = parseISO(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatShort(iso: string): string {
  return parseISO(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function formatMonth(month: string): string {
  const s = parseISO(`${month}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dayLabel(iso: string): string {
  const t = todayISO();
  if (iso === t) return 'Hoje';
  if (iso === addDays(t, -1)) return 'Ontem';
  if (iso === addDays(t, 1)) return 'Amanhã';
  return formatShort(iso);
}

export const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10;
export const r0 = (n: number) => Math.round(Number(n) || 0);

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
