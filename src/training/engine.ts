/**
 * Regras do treino calculadas pelo código (sem IA): progressão dupla, aquecimento,
 * sequência de séries, duração, volume e trocas. A IA nunca decide carga.
 */
import type { AppData, Equipment, PlanSession, PlanSlot, PlanVersion, Session, SetLog, SetTipo, SlotState, TrainingSettings } from '../types';
import { daysBetween, fmtNum } from '../lib/utils';
import { CATALOG, getEx, isActive, resolveExercise, type Grupo } from './catalog';

export const fmtW = (n: number) => fmtNum(n, 2);
export const fmtPct = (p: number) => `${fmtNum(p, 2)}%`;
const wkey = (w: number) => String(Math.round(w * 1000) / 1000);

// ===================== equipamento =====================

/** Próximo peso mais difícil. undefined = desconhecido; null = não existe. */
export function harder(eq: Equipment | undefined, w: number): number | null | undefined {
  const v = eq?.proximo[wkey(w)];
  if (v === undefined) return undefined;
  return v < 0 ? null : v;
}

/** Um peso mais fácil que já se sabe que existe. */
export function easier(eq: Equipment | undefined, w: number): number | undefined {
  const known = eq?.conhecidos ?? [];
  if (eq?.base === 'assistencia') {
    const up = known.filter((k) => k > w);
    return up.length ? Math.min(...up) : undefined;
  }
  const down = known.filter((k) => k < w);
  return down.length ? Math.max(...down) : undefined;
}

/** Peso conhecido mais próximo de um alvo, sem passar dele (para aquecimentos leves). */
function lightKnown(eq: Equipment | undefined, alvo: number): number | undefined {
  const down = (eq?.conhecidos ?? []).filter((k) => k <= alvo);
  return down.length ? Math.max(...down) : undefined;
}

/**
 * Tamanho do salto. Na assistência, o percentual é calculado sobre o peso movido
 * (peso corporal − assistência), nunca sobre a pilha. Sem peso corporal: null.
 */
export function jump(eq: Equipment | undefined, de: number, para: number, pesoCorporal?: number) {
  if (eq?.base === 'assistencia') {
    const kgMenosAjuda = de - para;
    const movido = pesoCorporal && pesoCorporal > de ? pesoCorporal - de : 0;
    return { pct: movido ? (kgMenosAjuda / movido) * 100 : null, kgMenosAjuda };
  }
  return { pct: de > 0 ? ((para - de) / de) * 100 : null };
}

export const unitOf = (eq?: Equipment) => eq?.unidade ?? 'kg';

// ===================== histórico =====================

const idxCache = new WeakMap<object, Map<string, SetLog[]>>();

export function setsByExercise(sets: Record<string, SetLog>): Map<string, SetLog[]> {
  const hit = idxCache.get(sets);
  if (hit) return hit;
  const m = new Map<string, SetLog[]>();
  for (const s of Object.values(sets)) {
    if (s.status !== 'feita') continue;
    const arr = m.get(s.exerciseId);
    if (arr) arr.push(s);
    else m.set(s.exerciseId, [s]);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.confirmadoEm - b.confirmadoEm);
  idxCache.set(sets, m);
  return m;
}

export interface Exposure {
  sessionId: string;
  data: string;
  em: number;
  trabalho: SetLog[];
  aquec: SetLog[];
  aprox: SetLog[];
}

/** Sessões em que o exercício foi feito (mais recente primeiro). Só registros confirmados. */
export function exposures(sets: Record<string, SetLog>, exerciseId: string, lado?: 'D' | 'E', excludeSession?: string): Exposure[] {
  const list = setsByExercise(sets).get(exerciseId) ?? [];
  const by = new Map<string, Exposure>();
  for (const s of list) {
    if (s.sessionId === excludeSession) continue;
    if (s.tipo === 'trabalho' && lado && s.lado !== lado) continue;
    let e = by.get(s.sessionId);
    if (!e) {
      e = { sessionId: s.sessionId, data: s.data, em: s.confirmadoEm, trabalho: [], aquec: [], aprox: [] };
      by.set(s.sessionId, e);
    }
    e.em = Math.max(e.em, s.confirmadoEm);
    (s.tipo === 'trabalho' ? e.trabalho : s.tipo === 'aquecimento' ? e.aquec : e.aprox).push(s);
  }
  return [...by.values()]
    .map((e) => ({ ...e, trabalho: [...e.trabalho].sort((a, b) => a.posicao - b.posicao) }))
    .sort((a, b) => b.em - a.em);
}

// ===================== prescrição e progressão =====================

export interface Presc {
  series: number;
  repMin: number;
  repMax: number;
  rirMin: number;
  rirMax: number;
  descansoSeg: number;
  limitePct: number;
}

export const prescOf = (slot: PlanSlot, t: TrainingSettings): Presc => ({
  series: slot.series,
  repMin: slot.repMin,
  repMax: slot.repMax,
  rirMin: slot.rirMin,
  rirMax: slot.rirMax,
  descansoSeg: slot.descansoSeg,
  limitePct: slot.limitePct ?? t.limitePct,
});

export type Acao = 'calibrar' | 'manter' | 'subir' | 'reduzir' | 'dor' | 'recalibrar' | 'posicao' | 'perguntar';

export interface SidePlan {
  acao: Acao;
  cargas: (number | null)[];
  metas: (number | null)[];
  motivo: string;
  refCarga: number | null;
  ultima?: { cargas: (number | null)[]; reps: (number | null)[]; data: string };
  salto?: { de: number; para: number; pct: number | null; kgMenosAjuda?: number };
  perguntarProximo?: number;
  revisarFaixa?: boolean;
  teto?: number;
  descansoExtraSeg?: number;
}

export interface Ctx {
  sets: Record<string, SetLog>;
  eq?: Equipment;
  presc: Presc;
  hoje: string;
  pesoCorporal?: number;
  excludeSession?: string;
}

const isAssist = (eq?: Equipment) => eq?.base === 'assistencia';

function topWithMargin(e: Exposure, L: number, p: Presc): boolean {
  const ws = e.trabalho;
  return (
    ws.length >= p.series &&
    ws.every((s) => s.carga === L && (s.reps ?? 0) >= p.repMax && s.rir != null && s.rir >= p.rirMin && !s.ajuda && !s.dor)
  );
}

function ceilingStreak(exps: Exposure[], L: number, p: Presc): number {
  let n = 0;
  for (const e of exps) {
    if (!topWithMargin(e, L, p)) break;
    n++;
  }
  return n;
}

/** +1 repetição no total: soma na primeira posição com o menor número abaixo do teto. */
export function plusOne(metas: number[], repMax: number): number[] {
  const out = [...metas];
  let idx = -1;
  for (let i = 0; i < out.length; i++) if (out[i] < repMax && (idx === -1 || out[i] < out[idx])) idx = i;
  if (idx >= 0) out[idx]++;
  return out;
}

const fill = <T,>(n: number, v: T) => Array.from({ length: n }, () => v);

/** Plano da próxima sessão para um exercício (e lado), a partir dos registros confirmados. */
export function suggestNext(exerciseId: string, lado: 'D' | 'E' | undefined, ctx: Ctx): SidePlan {
  const { presc: p, eq } = ctx;
  const n = p.series;
  const u = unitOf(eq);
  const exps = exposures(ctx.sets, exerciseId, lado, ctx.excludeSession).filter((e) => e.trabalho.length);

  if (!exps.length) {
    return {
      acao: 'calibrar',
      cargas: fill(n, null),
      metas: fill(n, null),
      refCarga: null,
      motivo: 'Primeira vez neste exercício. Escolha um peso que deixe cerca de 2 repetições de reserva.',
    };
  }

  const last = exps[0];
  const ws = last.trabalho;
  const loads = ws.map((s) => s.carga);
  const reps = ws.map((s) => s.reps);
  const at = <T,>(arr: T[], i: number) => arr[Math.min(i, arr.length - 1)];
  const metasLast = Array.from({ length: n }, (_, i) => Math.min(at(reps, i) ?? p.repMin, p.repMax));
  const cargasLast = Array.from({ length: n }, (_, i) => at(loads, i));
  const L = loads[0];
  const W = L == null ? 'o mesmo peso' : `${fmtW(L)} ${u}`;
  const repsTxt = reps.map((r) => r ?? '?').join('/');
  const base = { refCarga: L, ultima: { cargas: loads, reps, data: last.data } };
  const dias = daysBetween(last.data, ctx.hoje);

  if (ws.some((s) => s.dor)) {
    return { ...base, acao: 'dor', cargas: cargasLast, metas: metasLast, motivo: 'Na última sessão você marcou dor neste exercício. A progressão fica suspensa.' };
  }
  if (dias > 21) {
    return {
      ...base,
      acao: 'recalibrar',
      cargas: cargasLast,
      metas: fill(n, p.repMin),
      motivo: `Faz ${dias} dias desde a última vez. Recalibre: comece pelo peso anterior e ajuste depois da 1ª série.`,
    };
  }
  if (!loads.every((l) => l === L)) {
    return {
      ...base,
      acao: 'posicao',
      cargas: cargasLast,
      metas: metasLast,
      motivo: 'Na última sessão as cargas mudaram entre as séries. Cada série é comparada com a mesma posição.',
    };
  }
  if (ws.some((s) => s.ajuda)) {
    return { ...base, acao: 'manter', cargas: fill(n, L), metas: metasLast, motivo: `Na última sessão houve ajuda. Mantenha ${W} e repita com a execução completa, sem ajuda.` };
  }
  if (ws.some((s) => s.rir == null)) {
    return { ...base, acao: 'manter', cargas: fill(n, L), metas: metasLast, motivo: `Esforço não informado na última sessão (${repsTxt}). Mantenha ${W} por enquanto.` };
  }

  const allTop = ws.length >= n && ws.every((s) => (s.reps ?? 0) >= p.repMax);
  const margem = ws.every((s) => (s.rir ?? 0) >= p.rirMin);

  if (allTop && margem && L != null) {
    const teto = ceilingStreak(exps, L, p);
    const nx = harder(eq, L);
    const topo = fill(n, p.repMax);
    if (nx === undefined) {
      return {
        ...base,
        acao: 'perguntar',
        cargas: fill(n, L),
        metas: topo,
        teto,
        perguntarProximo: L,
        motivo: isAssist(eq)
          ? `Você fez ${repsTxt} com margem. Para progredir, informe o próximo nível com menos assistência que ${W}.`
          : `Você fez ${repsTxt} com margem. Para subir, informe o próximo peso disponível acima de ${W}.`,
      };
    }
    if (nx === null) {
      return {
        ...base,
        acao: 'manter',
        cargas: fill(n, L),
        metas: topo,
        teto,
        revisarFaixa: teto >= 2,
        motivo: `${W} é o limite deste aparelho. Mantenha a carga${teto >= 2 ? ' e revise a faixa com o personal' : ''}.`,
      };
    }
    const j = jump(eq, L, nx, ctx.pesoCorporal);
    const salto = { de: L, para: nx, ...j };
    if (j.pct == null) {
      return {
        ...base,
        acao: 'manter',
        cargas: fill(n, L),
        metas: topo,
        salto,
        teto,
        revisarFaixa: teto >= 2,
        motivo: isAssist(eq)
          ? `O próximo nível é ${fmtW(nx)} ${u} de assistência (${fmtW(L - nx)} ${u} a menos de ajuda). Preencha seu peso no perfil para o app avaliar esse salto.`
          : `Mantenha ${W}.`,
      };
    }
    const saltoTxt = isAssist(eq) ? `${fmtW(L - nx)} ${u} a menos de ajuda, +${fmtPct(j.pct)} no peso movido` : `+${fmtPct(j.pct)}`;
    if (j.pct <= p.limitePct + 1e-9) {
      return {
        ...base,
        acao: 'subir',
        cargas: fill(n, nx),
        metas: fill(n, p.repMin),
        salto,
        motivo: `Você fez ${repsTxt} com margem. Teste ${fmtW(nx)} ${u} (${saltoTxt}) mirando ${p.repMin} repetições. Se a 1ª série ficar abaixo de ${p.repMin}, volte para ${W}.`,
      };
    }
    const saltoGrande = isAssist(eq)
      ? `O próximo nível é ${fmtW(nx)} ${u} de assistência: ${fmtW(L - nx)} ${u} a menos de ajuda, +${fmtPct(j.pct)} no peso movido.`
      : `O próximo peso é ${fmtW(nx)} ${u}, um aumento de ${fmtPct(j.pct)}.`;
    return {
      ...base,
      acao: 'manter',
      cargas: fill(n, L),
      metas: topo,
      salto,
      teto,
      revisarFaixa: teto >= 2,
      motivo: `${saltoGrande} Mantenha ${W}.${teto >= 2 ? ` Teto da faixa atingido com folga em ${teto} sessões seguidas: revise a faixa.` : ''}`,
    };
  }

  const first = ws[0];
  if ((first.reps ?? 0) < p.repMin && first.rir === 0) {
    const lower = L != null ? easier(eq, L) : undefined;
    return {
      ...base,
      acao: 'reduzir',
      cargas: fill(n, lower ?? L),
      metas: fill(n, p.repMin),
      motivo: `Na última sessão a 1ª série ficou abaixo de ${p.repMin} no limite. Confira o peso e o descanso.${lower != null ? ` Sugestão: ${fmtW(lower)} ${u}.` : ''}`,
    };
  }

  if (ws.length >= 2) {
    const ult = ws[ws.length - 1];
    const antes = ws.slice(0, -1);
    const caiu = antes.every((s) => (s.reps ?? 0) >= p.repMin) && (ult.reps ?? 0) < Math.min(...antes.map((s) => s.reps ?? 0));
    const curto = ult.intervaloSeg != null && ult.descansoPlanejadoSeg != null && ult.intervaloSeg < ult.descansoPlanejadoSeg * 0.8;
    if (caiu && curto) {
      const metas = metasLast.map((m, i) => (i === ws.length - 1 ? Math.min(at(reps, i - 1) ?? m, p.repMax) : m));
      return {
        ...base,
        acao: 'manter',
        cargas: fill(n, L),
        metas,
        descansoExtraSeg: 30,
        motivo: `Só a última série caiu (${repsTxt}) e o descanso antes dela foi curto. Descanse mais antes de mudar a carga.`,
      };
    }
  }

  if (ws.some((s) => s.rir === 0)) {
    return {
      ...base,
      acao: 'manter',
      cargas: fill(n, L),
      metas: metasLast,
      motivo: `Na última sessão: ${repsTxt}, com série no limite. Mantenha ${W} e repita as repetições deixando ${p.rirMin} a ${p.rirMax} de reserva.`,
    };
  }

  const metas = plusOne(metasLast, p.repMax);
  const total = metas.reduce((a, b) => a + b, 0);
  return {
    ...base,
    acao: 'manter',
    cargas: fill(n, L),
    metas,
    motivo: `Na última sessão: ${W} × ${repsTxt}. Mantenha ${W} e tente ${total} repetições no total.`,
  };
}

// ===================== sequência de séries =====================

export interface Step {
  id: string;
  slotId: string;
  slotIndex: number;
  exerciseId: string;
  tipo: SetTipo;
  posicao: number;
  lado?: 'D' | 'E';
  seg: number;
}

export const setIdFor = (sessionId: string, s: Omit<Step, 'id'>) =>
  `${sessionId}~${s.slotId}~${s.exerciseId}~${s.tipo}~${s.posicao}~${s.lado ?? ''}`;

export function emptySlotState(): SlotState {
  return { exibidas: [], trocas: [], status: 'ativo' };
}

export interface Segment {
  exerciseId: string;
  resolvido: boolean;
  from: number;
}

export function slotSegments(slot: PlanSlot, st: SlotState | undefined, t: TrainingSettings): Segment[] {
  const r = resolveExercise(slot.exerciseId, t);
  const segs: Segment[] = [{ exerciseId: r ?? slot.exerciseId, resolvido: !!r, from: 1 }];
  for (const tr of st?.trocas ?? []) segs.push({ exerciseId: tr.para, resolvido: true, from: tr.posicao });
  return segs;
}

export function needsWarmup(slotIndex: number, exerciseId: string, anteriores: string[]): boolean {
  if (slotIndex === 0) return true;
  const e = getEx(exerciseId);
  if (!e.composto) return false;
  const trabalhados = new Set<Grupo>();
  for (const id of anteriores) {
    const a = getEx(id);
    trabalhados.add(a.grupo);
    a.secundarios.forEach((g) => trabalhados.add(g));
  }
  return !trabalhados.has(e.grupo);
}

export const needsAprox = (exerciseId: string, slot: PlanSlot) => getEx(exerciseId).composto && slot.repMax <= 9;

export function sessionSteps(ps: PlanSession, session: Session, t: TrainingSettings): Step[] {
  const steps: Step[] = [];
  const anteriores: string[] = [];
  ps.slots.forEach((slot, slotIndex) => {
    const st = session.slots[slot.id];
    const segs = slotSegments(slot, st, t);
    segs.forEach((seg, j) => {
      const from = seg.from;
      const to = (segs[j + 1]?.from ?? slot.series + 1) - 1;
      if (from > to && j < segs.length - 1) return;
      const exId = seg.exerciseId;
      const push = (tipo: SetTipo, posicao: number, lado?: 'D' | 'E') => {
        const s = { slotId: slot.id, slotIndex, exerciseId: exId, tipo, posicao, lado, seg: j };
        steps.push({ ...s, id: setIdFor(session.id, s) });
      };
      const isLast = j === segs.length - 1;
      const warm = j === 0 ? needsWarmup(slotIndex, exId, anteriores) : true;
      const extra = isLast ? st?.aquecExtra ?? 0 : 0;
      const nWarm = (warm ? 1 : 0) + extra;
      for (let k = 1; k <= nWarm; k++) push('aquecimento', k);
      if (j === 0 && needsAprox(exId, slot)) push('aproximacao', 1);
      const lados: ('D' | 'E' | undefined)[] = getEx(exId).unilateral ? ['D', 'E'] : [undefined];
      for (let p = from; p <= to; p++) for (const l of lados) push('trabalho', p, l);
    });
    const r = resolveExercise(slot.exerciseId, t);
    if (r) anteriores.push(r);
  });
  return steps;
}

export const isResolved = (step: Step, sets: Record<string, SetLog>) => !!sets[step.id];

export function slotActive(session: Session, slotId: string) {
  return (session.slots[slotId]?.status ?? 'ativo') === 'ativo';
}

export function pendingSteps(ps: PlanSession, session: Session, data: AppData): Step[] {
  return sessionSteps(ps, session, data.settings.training).filter((s) => slotActive(session, s.slotId) && !isResolved(s, data.sets));
}

export function currentStep(ps: PlanSession, session: Session, data: AppData): Step | undefined {
  return pendingSteps(ps, session, data)[0];
}

/** Próxima posição de trabalho ainda não feita numa vaga (usada ao trocar de exercício). */
export function nextWorkPosition(ps: PlanSession, session: Session, slotId: string, data: AppData): number {
  const steps = sessionSteps(ps, session, data.settings.training).filter((s) => s.slotId === slotId && s.tipo === 'trabalho');
  const pend = steps.find((s) => !isResolved(s, data.sets));
  return pend ? pend.posicao : (ps.slots.find((s) => s.id === slotId)?.series ?? 0) + 1;
}

// ===================== sugestão da série atual =====================

export interface StepSuggestion {
  carga: number | null;
  reps: number | null;
  motivo: string;
  dica?: string;
  plan?: SidePlan;
  /** Botão "voltar para X" depois de testar um peso novo. */
  voltarPara?: number;
}

export function stepCtx(data: AppData, slot: PlanSlot, exerciseId: string, hoje: string, excludeSession?: string): Ctx {
  const t = data.settings.training;
  const peso = Number(String(data.settings.profile.peso).replace(',', '.'));
  return {
    sets: data.sets,
    eq: data.equipment[getEx(exerciseId).equip],
    presc: prescOf(slot, t),
    hoje,
    pesoCorporal: peso > 0 ? peso : undefined,
    excludeSession,
  };
}

export function suggestForStep(step: Step, session: Session, slot: PlanSlot, data: AppData, hoje: string): StepSuggestion {
  const ctx = stepCtx(data, slot, step.exerciseId, hoje, session.id);
  const { eq, presc } = ctx;
  const u = unitOf(eq);
  const corporal = eq?.base === 'corporal';
  const planD = suggestNext(step.exerciseId, step.lado, ctx);

  if (step.tipo !== 'trabalho') {
    const aq = step.tipo === 'aquecimento';
    const reps = aq ? 8 : 4;
    const prev = exposures(data.sets, step.exerciseId, undefined, session.id).find((e) => (aq ? e.aquec : e.aprox).some((s) => s.posicao === step.posicao));
    const prevSet = prev && (aq ? prev.aquec : prev.aprox).find((s) => s.posicao === step.posicao);
    const motivo = aq
      ? 'Aquecimento leve: 8 repetições com bastante margem.'
      : 'Aproximação: 4 repetições fáceis com carga intermediária.';
    if (corporal) return { carga: null, reps, motivo, plan: planD };
    if (prevSet?.carga != null) return { carga: prevSet.carga, reps, motivo: `${motivo} Da última vez: ${fmtW(prevSet.carga)} ${u}.`, plan: planD };
    const ref = planD.refCarga;
    if (ref != null && eq?.base !== 'assistencia') {
      const alvo = ref * (aq ? 0.5 : 0.75);
      const k = lightKnown(eq, alvo);
      return {
        carga: k ?? null,
        reps,
        motivo,
        dica: `Referência: cerca de ${fmtW(Math.round(alvo * 2) / 2)} ${u} (${aq ? 'metade' : 'três quartos'} de ${fmtW(ref)} ${u}).`,
        plan: planD,
      };
    }
    if (eq?.base === 'assistencia') return { carga: null, reps, motivo, dica: 'Use mais assistência do que na série de trabalho.', plan: planD };
    return { carga: null, reps, motivo: `${motivo} Escolha um peso fácil.`, plan: planD };
  }

  const done = Object.values(data.sets)
    .filter((s) => s.sessionId === session.id && s.exerciseId === step.exerciseId && s.tipo === 'trabalho' && s.status === 'feita' && s.lado === step.lado)
    .sort((a, b) => a.posicao - b.posicao);
  const idx = step.posicao - 1;
  const meta = (i: number) => planD.metas[Math.min(i, planD.metas.length - 1)] ?? null;

  if (!done.length) {
    return {
      carga: corporal ? null : planD.cargas[Math.min(idx, planD.cargas.length - 1)] ?? null,
      reps: meta(idx),
      motivo: planD.motivo,
      plan: planD,
      voltarPara: planD.acao === 'subir' ? planD.salto?.de : undefined,
    };
  }

  const prev = done[done.length - 1];
  const W = (w: number | null) => (w == null ? 'o mesmo peso' : `${fmtW(w)} ${u}`);
  if (planD.acao === 'subir' && planD.salto && done.length === 1 && prev.carga === planD.salto.para && (prev.reps ?? 0) < presc.repMin) {
    const de = planD.salto.de;
    return {
      carga: de,
      reps: planD.ultima?.reps[Math.min(idx, planD.ultima.reps.length - 1)] ?? presc.repMin,
      motivo: `A 1ª série com ${W(prev.carga)} ficou abaixo de ${presc.repMin}. Volte para ${W(de)}.`,
      plan: planD,
    };
  }
  if ((prev.reps ?? 0) < presc.repMin && prev.rir === 0) {
    const lower = prev.carga != null ? easier(eq, prev.carga) : undefined;
    return {
      carga: corporal ? null : lower ?? prev.carga,
      reps: presc.repMin,
      motivo: `A série anterior ficou abaixo de ${presc.repMin} no limite. Confira o peso e o descanso.${lower != null ? ` Sugestão: ${W(lower)}.` : ''}`,
      plan: planD,
    };
  }
  const reps = meta(idx) ?? Math.max(presc.repMin, Math.min(prev.reps ?? presc.repMin, presc.repMax));
  return {
    carga: corporal ? null : prev.carga,
    reps,
    motivo: `Mantenha ${W(prev.carga)} e tente ${reps} repetições com a mesma amplitude.`,
    plan: planD,
  };
}

// ===================== duração =====================

const MIN_PREP = 3;
const MIN_MARGEM = 5;
const MIN_TRANSICAO = 1.5;
const MIN_AQUEC = 1.5;
const MIN_SERIE = 1;
const MIN_TROCA_LADO = 0.25;

/** Estimativa em minutos: preparação, execução, descansos, transições e margem. */
export function estimateSteps(ps: PlanSession, steps: Step[], opts: { inicio?: boolean } = {}): number {
  const slotById = Object.fromEntries(ps.slots.map((s) => [s.id, s]));
  let min = (opts.inicio ?? true ? MIN_PREP : 0) + MIN_MARGEM;
  const slots = new Set<string>();
  for (const s of steps) {
    slots.add(s.slotId);
    if (s.tipo !== 'trabalho') min += MIN_AQUEC;
    else {
      min += MIN_SERIE;
      if (s.lado === 'E') min += MIN_TROCA_LADO;
      if (s.lado !== 'D') min += (slotById[s.slotId]?.descansoSeg ?? 90) / 60;
    }
  }
  return min + slots.size * MIN_TRANSICAO;
}

function pseudoSession(ps: PlanSession): Session {
  return { id: 'x', planId: '', key: ps.key, titulo: ps.titulo, dataOriginal: '', dataAtual: '', status: 'pendente', intervalos: [], slots: {}, historicoDatas: [] };
}

export function estimateSession(ps: PlanSession, t: TrainingSettings, session?: Session, data?: AppData): number {
  const s = session ?? pseudoSession(ps);
  let steps = sessionSteps(ps, s, t).filter((st) => slotActive(s, st.slotId));
  if (data && session) steps = steps.filter((st) => !isResolved(st, data.sets));
  return estimateSteps(ps, steps, { inicio: !session?.inicio });
}

/** Mediana das durações reais da mesma sessão (≥ 2 registros), senão null. */
export function medianDuration(data: AppData, key: string): number | null {
  const ds = Object.values(data.sessions)
    .filter((s) => s.key === key && s.status === 'concluida' && s.duracaoSeg)
    .map((s) => s.duracaoSeg! / 60)
    .sort((a, b) => a - b);
  if (ds.length < 2) return null;
  const m = Math.floor(ds.length / 2);
  return ds.length % 2 ? ds[m] : (ds[m - 1] + ds[m]) / 2;
}

/** Vaga que pode sair primeiro para caber no tempo. */
export function dropCandidate(ps: PlanSession, session: Session | undefined): PlanSlot | undefined {
  const ativos = ps.slots.filter((s) => !session || slotActive(session, s.id));
  return ativos.find((s) => s.sairPrimeiro) ?? [...ativos].reverse().find((s) => s.prioridade === 3);
}

// ===================== volume =====================

export type Volume = Partial<Record<Grupo, { diretas: number; indiretas: number }>>;

function addVol(v: Volume, g: Grupo, k: 'diretas' | 'indiretas', n: number) {
  const cur = v[g] ?? { diretas: 0, indiretas: 0 };
  v[g] = { ...cur, [k]: cur[k] + n };
}

export function planVolume(plan: PlanVersion, t: TrainingSettings): Volume {
  const v: Volume = {};
  for (const ses of plan.sessoes)
    for (const slot of ses.slots) {
      const e = getEx(resolveExercise(slot.exerciseId, t) ?? slot.exerciseId);
      addVol(v, e.grupo, 'diretas', slot.series);
      e.secundarios.forEach((g) => addVol(v, g, 'indiretas', slot.series));
    }
  return v;
}

/** Séries de trabalho feitas no intervalo. Unilateral: cada posição conta uma vez (2 por perna = 2). */
export function realizedVolume(sets: Record<string, SetLog>, from: string, to: string): Volume {
  const v: Volume = {};
  const seen = new Set<string>();
  for (const s of Object.values(sets)) {
    if (s.status !== 'feita' || s.tipo !== 'trabalho' || s.data < from || s.data > to) continue;
    const k = `${s.sessionId}|${s.slotId}|${s.exerciseId}|${s.posicao}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const e = getEx(s.exerciseId);
    addVol(v, e.grupo, 'diretas', 1);
    e.secundarios.forEach((g) => addVol(v, g, 'indiretas', 1));
  }
  return v;
}

// ===================== trocas =====================

/** Alternativas ainda não exibidas para a vaga, na ordem do catálogo (as que cabem no tempo primeiro). */
export function swapCandidates(ps: PlanSession, session: Session, slotId: string, data: AppData): string[] {
  const t = data.settings.training;
  const slot = ps.slots.find((s) => s.id === slotId);
  if (!slot) return [];
  const st = session.slots[slotId];
  if (st && st.status !== 'ativo') return [];
  const orig = getEx(resolveExercise(slot.exerciseId, t) ?? slot.exerciseId);
  const usados = new Set(slotSegments(slot, st, t).map((s) => s.exerciseId));
  usados.add(slot.exerciseId);
  const reservados = new Set<string>();
  for (const other of ps.slots) {
    if (other.id === slotId || !slotActive(session, other.id)) continue;
    const segs = slotSegments(other, session.slots[other.id], t);
    reservados.add(segs[segs.length - 1].exerciseId);
  }
  const exibidas = new Set(st?.exibidas ?? []);
  const lista = CATALOG.filter(
    (e) =>
      isActive(e.id, t) &&
      e.grupo === orig.grupo &&
      e.padrao === orig.padrao &&
      !usados.has(e.id) &&
      !reservados.has(e.id) &&
      !exibidas.has(e.id),
  ).map((e) => e.id);

  const limite = t.duracaoMin;
  const fits = (id: string) => {
    const pos = nextWorkPosition(ps, session, slotId, data);
    const sim: Session = {
      ...session,
      slots: { ...session.slots, [slotId]: { ...(st ?? emptySlotState()), trocas: [...(st?.trocas ?? []), { de: '', para: id, motivo: 'hoje_nao', posicao: pos, exibidas: [], em: 0 }] } },
    };
    return estimateSession(ps, t, sim) <= limite;
  };
  const cabe = lista.filter(fits);
  return [...cabe, ...lista.filter((id) => !cabe.includes(id))];
}
