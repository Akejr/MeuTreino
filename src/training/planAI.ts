/** Validação da ficha proposta pela IA. Nada é exibido como válido sem passar por aqui. */
import { uid } from '../lib/utils';
import type { AppData, PlanSlot, PlanVersion } from '../types';
import { BY_ID, getEx, isActive } from './catalog';
import { estimateSession } from './engine';

export interface AIPlanSlot {
  exercicio?: string;
  series?: number;
  reps_min?: number;
  reps_max?: number;
  rir_min?: number;
  rir_max?: number;
  descanso_seg?: number;
  prioridade?: number;
  dica?: string;
  sair_primeiro?: boolean;
}

export interface AIPlan {
  resumo?: string;
  mudancas?: string[];
  sessoes?: { chave?: string; dia?: number; titulo?: string; slots?: AIPlanSlot[] }[];
}

const int = (v: unknown) => (typeof v === 'number' ? Math.round(v) : Number.parseInt(String(v), 10));

export function validatePlan(raw: AIPlan, d: AppData, versao: number): { plan?: PlanVersion; erros: string[]; avisos: string[]; mudancas: string[] } {
  const t = d.settings.training;
  const erros: string[] = [];
  const avisos: string[] = [];
  const sessoes = Array.isArray(raw.sessoes) ? raw.sessoes : [];
  if (!sessoes.length) erros.push('A IA não devolveu sessões.');
  const dias = new Set<number>();
  const chaves = new Set<string>();

  const out = sessoes.map((s, si) => {
    const chave = String(s.chave ?? String.fromCharCode(65 + si)).toUpperCase().slice(0, 2);
    const dia = int(s.dia);
    if (!(dia >= 1 && dia <= 7)) erros.push(`Sessão ${chave}: dia inválido.`);
    else {
      if (dias.has(dia)) erros.push(`Sessão ${chave}: duas sessões no mesmo dia.`);
      dias.add(dia);
      const tipo = t.dias[dia % 7];
      if (tipo === 'indisponivel') erros.push(`Sessão ${chave}: o dia escolhido está marcado como indisponível.`);
      else if (tipo === 'disponivel') avisos.push(`Sessão ${chave} caiu num dia marcado só como disponível para reposição.`);
    }
    if (chaves.has(chave)) erros.push(`Chave ${chave} repetida.`);
    chaves.add(chave);
    const slotsIn = Array.isArray(s.slots) ? s.slots : [];
    if (!slotsIn.length) erros.push(`Sessão ${chave}: sem exercícios.`);
    if (slotsIn.length > 8) erros.push(`Sessão ${chave}: mais de 8 exercícios.`);
    const usados = new Set<string>();
    const slots: PlanSlot[] = slotsIn.map((sl, i) => {
      const id = String(sl.exercicio ?? '');
      const e = BY_ID[id];
      if (!e || (!isActive(id, t) && !e.pergunta)) erros.push(`Sessão ${chave}: exercício "${id}" não está no catálogo disponível.`);
      if (usados.has(id)) erros.push(`Sessão ${chave}: ${e?.nome ?? id} repetido.`);
      usados.add(id);
      const series = int(sl.series);
      const repMin = int(sl.reps_min);
      const repMax = int(sl.reps_max);
      const rirMin = Number.isFinite(int(sl.rir_min)) ? int(sl.rir_min) : 1;
      const rirMax = Number.isFinite(int(sl.rir_max)) ? int(sl.rir_max) : 3;
      const desc = int(sl.descanso_seg);
      const pr = int(sl.prioridade);
      const nome = e?.nome ?? id;
      if (!(series >= 1 && series <= 5)) erros.push(`${nome}: séries fora de 1–5.`);
      if (!(repMin >= 3 && repMax <= 30 && repMin < repMax)) erros.push(`${nome}: faixa de repetições inválida.`);
      if (!(rirMin >= 0 && rirMax <= 5 && rirMin <= rirMax)) erros.push(`${nome}: reserva inválida.`);
      if (!(desc >= 30 && desc <= 300)) erros.push(`${nome}: descanso fora de 30–300 s.`);
      if (![1, 2, 3].includes(pr)) erros.push(`${nome}: prioridade inválida.`);
      return {
        id: `${chave}${i + 1}`,
        exerciseId: id,
        series,
        repMin,
        repMax,
        rirMin,
        rirMax,
        descansoSeg: desc,
        prioridade: (pr === 1 || pr === 2 ? pr : 3) as 1 | 2 | 3,
        dica: String(sl.dica ?? '').slice(0, 160),
        sairPrimeiro: !!sl.sair_primeiro,
      };
    });
    return { key: chave, dia, titulo: String(s.titulo ?? `Sessão ${chave}`).slice(0, 60), slots };
  });

  if (erros.length) return { erros, avisos, mudancas: [] };

  const plan: PlanVersion = {
    id: uid(),
    nome: `Ficha v${versao} (IA)`,
    versao,
    criadoEm: Date.now(),
    vigenciaInicio: '',
    status: 'proposta',
    origem: 'ia',
    resumo: String(raw.resumo ?? '').slice(0, 600),
    sessoes: out.sort((a, b) => a.dia - b.dia),
  };
  for (const s of plan.sessoes) {
    const min = estimateSession(s, t);
    if (min > t.duracaoMin) avisos.push(`Sessão ${s.key} estimada em ${Math.round(min)} min (alvo ${t.duracaoMin}).`);
    for (const sl of s.slots) if (getEx(sl.exerciseId).pergunta) avisos.push(`${getEx(sl.exerciseId).nome}: a variação será confirmada no primeiro uso.`);
  }
  return { plan, erros, avisos, mudancas: (raw.mudancas ?? []).map(String).slice(0, 12) };
}
