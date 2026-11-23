import type { Equipment, PlanSlot, SetLog } from '../../types';
import { BASE_LABEL, getEx } from '../../training/catalog';
import { fmtW, type Step } from '../../training/engine';

export function stepLabel(step: Step, slot: PlanSlot): string {
  if (step.tipo === 'aquecimento') return step.posicao > 1 ? 'Aquecimento extra · 8 repetições' : 'Aquecimento · 8 repetições';
  if (step.tipo === 'aproximacao') return 'Aproximação · 4 repetições fáceis';
  return `Trabalho · série ${step.posicao} de ${slot.series} · ${slot.repMin}–${slot.repMax} repetições`;
}

export const ladoLabel = (l?: 'D' | 'E') => (l === 'D' ? 'Lado direito' : l === 'E' ? 'Lado esquerdo' : '');

export function loadUnit(eq?: Equipment): string {
  if (!eq) return 'kg';
  if (eq.base === 'corporal') return 'peso corporal';
  return `${eq.unidade} ${BASE_LABEL[eq.base]}`;
}

export function setLine(s: SetLog): string {
  if (s.status === 'pulada') return 'pulada';
  const carga = s.carga == null ? '' : `${fmtW(s.carga)} ${s.unidade} × `;
  const rir = s.tipo === 'trabalho' ? ` · reserva ${s.rir == null ? 'não sei' : s.rir >= 4 ? '4+' : s.rir}` : '';
  const flags = [s.ajuda && 'ajuda', s.dor && 'dor'].filter(Boolean).join(', ');
  return `${carga}${s.reps ?? '-'}${rir}${flags ? ` · ${flags}` : ''}`;
}

export const tipoCurto = (s: SetLog) =>
  s.tipo === 'aquecimento' ? 'Aquec.' : s.tipo === 'aproximacao' ? 'Aprox.' : `Série ${s.posicao}${s.lado ? ` ${s.lado}` : ''}`;

export function exName(id: string) {
  return getEx(id).nome;
}

export function minutes(n: number) {
  return `${Math.round(n)} min`;
}
