/** Registros de cardio: leitura (sem dependências) e alterações. */
import { getData, setData } from '../lib/storage';
import { nowHHMM, todayISO, uid } from '../lib/utils';
import type { AppData, Cardio } from '../types';

export const cardioOn = (d: AppData, date: string): Cardio[] =>
  Object.values(d.cardio ?? {})
    .filter((c) => c.date === date)
    .sort((a, b) => a.hora.localeCompare(b.hora));

export const cardioBetween = (d: AppData, de: string, ate: string): Cardio[] =>
  Object.values(d.cardio ?? {})
    .filter((c) => c.date >= de && c.date <= ate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.hora.localeCompare(b.hora));

/** Último cardio registrado (para sugerir tipo, duração e intensidade iguais). */
export function lastCardio(d: AppData): Cardio | undefined {
  return Object.values(d.cardio ?? {}).sort((a, b) => b.date.localeCompare(a.date) || b.hora.localeCompare(a.hora))[0];
}

/** Hora de início sugerida: agora menos a duração (ele costuma registrar ao terminar). */
export function inicioSugerido(minutos: number): string {
  const [h, m] = nowHHMM().split(':').map(Number);
  const t = Math.max(0, h * 60 + m - minutos);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function novoCardio(d: AppData, date = todayISO()): Cardio {
  const ult = lastCardio(d);
  const minutos = ult?.minutos ?? 30;
  return {
    id: uid(),
    date,
    hora: inicioSugerido(minutos),
    tipo: ult?.tipo ?? 'caminhada',
    minutos,
    intensidade: ult?.intensidade ?? 'moderada',
    inclinacao: ult?.tipo === 'esteira_inclinada' ? ult.inclinacao : undefined,
    criadoEm: Date.now(),
  };
}

const limpo = (c: Cardio): Cardio => {
  const out: Cardio = { ...c, minutos: Math.max(1, Math.round(c.minutos)) };
  for (const k of ['distanciaKm', 'inclinacao', 'watts', 'fcMedia', 'kcalAparelho'] as const) if (!(Number(out[k]) > 0)) delete out[k];
  if (!out.obs?.trim()) delete out.obs;
  return out;
};

export function saveCardio(c: Cardio) {
  setData((d) => ({ ...d, cardio: { ...d.cardio, [c.id]: limpo(c) } }));
}

export function deleteCardio(id: string) {
  setData((d) => {
    if (!d.cardio[id]) return d;
    const { [id]: _x, ...cardio } = d.cardio;
    return { ...d, cardio };
  });
}

export const getCardio = (id: string) => getData().cardio[id];
