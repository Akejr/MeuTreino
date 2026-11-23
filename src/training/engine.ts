/**
 * Regras do treino calculadas pelo código (sem IA): progressão dupla, aquecimento,
 * sequência de séries, duração, volume e trocas. A IA nunca decide carga.
 */
import type { AppData, Equipment, PlanSession, PlanSlot, PlanVersion, Session, SetLog, SetTipo, SlotState, TrainingSettings } from '../types';
import { daysBetween, fmtDur, fmtNum } from '../lib/utils';
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

/** validar = peso ajustado na sessão anterior: começa pelo último peso válido e confirma na 1ª série. */
export type Acao = 'calibrar' | 'manter' | 'subir' | 'reduzir' | 'dor' | 'recalibrar' | 'posicao' | 'perguntar' | 'validar';

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
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ===================== esforço, capacidade e próximo peso =====================

/**
 * Reserva informada. `minimo` = sabe-se só que sobraram pelo menos N ("4+" sem saber quanto, "10+").
 * Registros antigos com 4 vinham do botão "4+" e contam como mínimo.
 */
export function rirOf(s: Pick<SetLog, 'rir' | 'rirAprox' | 'rirMais'>): { v: number | null; minimo: boolean } {
  if (s.rir == null) return { v: null, minimo: false };
  if (s.rirMais) return { v: s.rir, minimo: true };
  if (s.rir === 4 && !s.rirAprox) return { v: 4, minimo: true };
  return { v: s.rir, minimo: false };
}

export function rirTexto(s: Pick<SetLog, 'rir' | 'rirAprox' | 'rirMais'>): string {
  const r = rirOf(s);
  if (r.v == null) return 'reserva não informada';
  if (r.v === 0) return 'nenhuma repetição de reserva';
  const n = r.minimo ? `${r.v} ou mais` : s.rirAprox ? `cerca de ${r.v}` : String(r.v);
  return `${n} ${r.v === 1 && !r.minimo ? 'repetição' : 'repetições'} de reserva`;
}

/** Reserva em poucas letras, para listas: 2, ≈8, 4+, 10+, não sei. */
export function rirCurto(s: Pick<SetLog, 'rir' | 'rirAprox' | 'rirMais'>): string {
  const r = rirOf(s);
  if (r.v == null) return 'não sei';
  if (r.minimo) return `${r.v}+`;
  return s.rirAprox ? `≈${r.v}` : String(r.v);
}

/** Reserva alvo: o meio da faixa prescrita (1–3 → 2). */
export const alvoRir = (p: Presc) => Math.round((p.rirMin + p.rirMax) / 2);

/** Repetições que a carga da série permitiria deixando a reserva alvo. null = reserva desconhecida. */
function idealReps(s: Pick<SetLog, 'reps' | 'rir' | 'rirAprox' | 'rirMais'>, p: Presc): number | null {
  const r = rirOf(s);
  return r.v == null || s.reps == null ? null : s.reps + r.v - alvoRir(p);
}

/**
 * Série em que o peso mudou em relação à anterior para achar a carga certa.
 * Registros antigos não têm a marca: conta como ajuste quando o peso usado não foi o sugerido.
 * Peso diferente igual ao sugerido (sem a marca) = sequência planejada.
 */
export function isCalibration(s: SetLog, prev: SetLog | undefined): boolean {
  if (!prev || s.carga == null || prev.carga == null || s.carga === prev.carga) return false;
  return s.ajuste === 'calibracao' || s.carga !== s.cargaSugerida;
}

/** Peso que o músculo move: na assistida é o peso corporal menos a ajuda. */
function moved(eq: Equipment | undefined, w: number, peso?: number): number | null {
  if (eq?.base === 'assistencia') return peso && peso > w ? peso - w : null;
  return w > 0 ? w : null;
}

/** Repetições até a falha estimadas com outra carga, a partir de uma série (fórmula de Epley). */
export function capAt(eq: Equipment | undefined, de: number, cap: number, para: number, peso?: number): number | null {
  const a = moved(eq, de, peso);
  const b = moved(eq, para, peso);
  if (a == null || b == null) return null;
  const e1 = a * (1 + cap / 30);
  return 30 * (e1 / b - 1);
}

/** Mais difícil? (na assistida, menos ajuda é mais difícil). */
const maisDificil = (eq: Equipment | undefined, a: number, b: number) => (eq?.base === 'assistencia' ? a < b : a > b);

export interface Subida {
  /** subir = cabe no limite automático; avaliar = salto grande ou sem peso corporal para medir (ele decide). */
  tipo: 'subir' | 'avaliar' | 'perguntar' | 'limite';
  para?: number;
  pct?: number | null;
  kgMenosAjuda?: number;
  /** Repetições estimadas no peso novo deixando a reserva alvo (sem limitar à faixa). */
  est?: number | null;
}

/**
 * Próximo peso disponível a partir de `w` (registrado por posição) e se o salto cabe no limite automático.
 * Pesos já usados não contam como "próximo": pode existir um intermediário, então o app pergunta.
 */
export function proximaCarga(ctx: Ctx, w: number, cap: number): Subida {
  const { eq, presc: p } = ctx;
  const nx = harder(eq, w);
  if (nx === undefined) return { tipo: 'perguntar' };
  if (nx === null) return { tipo: 'limite' };
  const j = jump(eq, w, nx, ctx.pesoCorporal);
  const c = capAt(eq, w, cap, nx, ctx.pesoCorporal);
  const cabe = j.pct != null && j.pct <= p.limitePct + 1e-9;
  return { tipo: cabe ? 'subir' : 'avaliar', para: nx, pct: j.pct, kgMenosAjuda: j.kgMenosAjuda, est: c == null ? null : c - alvoRir(p) };
}

export function saltoTexto(eq: Equipment | undefined, de: number, para: number, pct: number | null | undefined): string {
  const u = unitOf(eq);
  if (isAssist(eq)) return `${fmtW(de - para)} ${u} a menos de ajuda${pct != null ? `, +${fmtPct(pct)} no peso movido` : ''}`;
  return `+${fmtW(para - de)} ${u}${pct != null ? `, +${fmtPct(pct)}` : ''}`;
}

/** "fez 9 até a falha", "fez 8 com 3 repetições de reserva". */
export function comReserva(s: Pick<SetLog, 'rir' | 'rirAprox' | 'rirMais'>): string {
  const r = rirOf(s);
  if (r.v === 0) return 'até a falha';
  return r.v == null ? 'sem informar a reserva' : `com ${rirTexto(s)}`;
}

type PlanBase = Pick<SidePlan, 'refCarga' | 'ultima'>;

/**
 * A sessão anterior teve o peso ajustado para achar a carga: o último peso válido vira a carga
 * inicial, confirmada na 1ª série. Só uma sequência planejada é repetida por posição.
 */
function fromCalibration(ws: SetLog[], ctx: Ctx, base: PlanBase): SidePlan {
  const { presc: p, eq } = ctx;
  const n = p.series;
  const u = unitOf(eq);
  const Wf = (w: number | null) => (w == null ? 'o mesmo peso' : `${fmtW(w)} ${u}`);
  const hist = `Na última sessão você ajustou o peso durante o exercício (${ws.map((s) => (s.carga == null ? '?' : fmtW(s.carga))).join('/')} ${u} × ${ws.map((s) => s.reps ?? '?').join('/')}).`;
  const validas = ws.filter((s) => s.carga != null && s.reps != null && !s.ajuda && !s.dor);
  const finalLoad = ws[ws.length - 1].carga;
  const ref = validas.find((s) => s.carga === finalLoad) ?? validas[validas.length - 1];
  if (!ref) {
    return {
      ...base,
      refCarga: finalLoad,
      acao: 'validar',
      cargas: fill(n, finalLoad),
      metas: fill(n, p.repMin),
      motivo: `${hist} Comece com ${Wf(finalLoad)} mirando ${p.repMin}, sem ajuda, e confirme o peso na 1ª série.`,
    };
  }
  const Lc = ref.carga!;
  const out = { ...base, refCarga: Lc };
  const fez = `${hist} Com ${Wf(Lc)} você fez ${ref.reps} ${comReserva(ref)}.`;
  const r = rirOf(ref);
  const id = idealReps(ref, p);
  if (r.v == null || id == null) {
    const m = clamp(ref.reps!, p.repMin, p.repMax);
    return { ...out, acao: 'validar', cargas: fill(n, Lc), metas: fill(n, m), motivo: `${fez} Comece com ${Wf(Lc)} mirando ${m} e confirme o esforço na 1ª série.` };
  }
  const cap = ref.reps! + r.v;

  if (id < p.repMin) {
    const leves = validas.map((s) => s.carga!).filter((w) => maisDificil(eq, Lc, w));
    const lower = leves.length ? (isAssist(eq) ? Math.min(...leves) : Math.max(...leves)) : easier(eq, Lc);
    const est = lower != null ? capAt(eq, Lc, cap, lower, ctx.pesoCorporal) : null;
    const m = est == null ? p.repMin : clamp(Math.floor(est - alvoRir(p)), p.repMin, p.repMax);
    return {
      ...out,
      acao: 'reduzir',
      cargas: fill(n, lower ?? Lc),
      metas: fill(n, m),
      motivo: `${fez} Ficou mais pesado que o planejado (${p.repMin}–${p.repMax} com ${p.rirMin} a ${p.rirMax} de reserva). ${
        lower != null ? `Comece com ${Wf(lower)} mirando ${m}` : `Comece com um peso um pouco menor que ${Wf(Lc)} mirando ${p.repMin}`
      } e confirme na 1ª série.`,
    };
  }

  if (id > p.repMax && r.v > 0) {
    const sub = proximaCarga(ctx, Lc, cap);
    const pesada = sub.est != null && sub.est < p.repMin;
    if (sub.tipo === 'subir' && sub.para != null && !pesada) {
      return {
        ...out,
        acao: 'subir',
        cargas: fill(n, sub.para),
        metas: fill(n, p.repMin),
        salto: { de: Lc, para: sub.para, pct: sub.pct ?? null, kgMenosAjuda: sub.kgMenosAjuda },
        motivo: `${fez} Ainda sobrou folga. Comece testando ${Wf(sub.para)} (${saltoTexto(eq, Lc, sub.para, sub.pct)}), o próximo peso disponível, no limite inferior da faixa: ${p.repMin} repetições. Se ficar abaixo de ${p.repMin}, volte para ${Wf(Lc)}.`,
      };
    }
    const salto = sub.para != null ? { de: Lc, para: sub.para, pct: sub.pct ?? null, kgMenosAjuda: sub.kgMenosAjuda } : undefined;
    const extra =
      sub.tipo === 'perguntar'
        ? ` Para subir, informe o próximo peso disponível acima de ${Wf(Lc)}.`
        : sub.tipo === 'limite'
          ? ` ${Wf(Lc)} é o limite deste aparelho.`
          : sub.para != null && pesada
            ? ` O próximo peso, ${Wf(sub.para)}, parece pesado demais para ${p.repMin} repetições.`
            : sub.para != null
              ? ` O próximo peso, ${Wf(sub.para)}, é um salto de ${saltoTexto(eq, Lc, sub.para, sub.pct)}: ${sub.pct == null ? 'preencha seu peso no perfil para o app avaliar' : `passa do limite automático de ${fmtPct(p.limitePct)}`}.`
              : '';
    return {
      ...out,
      acao: sub.tipo === 'perguntar' ? 'perguntar' : 'validar',
      perguntarProximo: sub.tipo === 'perguntar' ? Lc : undefined,
      salto,
      cargas: fill(n, Lc),
      metas: fill(n, p.repMax),
      motivo: `${fez}${extra} Comece com ${Wf(Lc)} mirando ${p.repMax}, o topo da faixa, e confirme na 1ª série.`,
    };
  }

  const m = clamp(id, p.repMin, p.repMax);
  return {
    ...out,
    acao: 'validar',
    cargas: fill(n, Lc),
    metas: fill(n, m),
    motivo: `${fez} Comece com ${Wf(Lc)} mirando ${m}, para deixar cerca de ${alvoRir(p)} de reserva, e confirme na 1ª série.`,
  };
}

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

  // Peso ajustado durante a sessão para achar a carga: vale o último peso, não a sequência.
  const calib = ws.some((s, i) => isCalibration(s, ws[i - 1]));
  const final = ws[ws.length - 1].carga;
  const cargasRef = calib ? fill(n, final) : cargasLast;

  if (ws.some((s) => s.dor)) {
    return { ...base, acao: 'dor', cargas: cargasRef, metas: metasLast, motivo: 'Na última sessão você marcou dor neste exercício. A progressão fica suspensa.' };
  }
  if (dias > 21) {
    return {
      ...base,
      acao: 'recalibrar',
      cargas: cargasRef,
      metas: fill(n, p.repMin),
      motivo: `Faz ${dias} dias desde a última vez. Recalibre: comece pelo peso anterior e ajuste depois da 1ª série.`,
    };
  }
  if (calib) return fromCalibration(ws, ctx, base);
  if (!loads.every((l) => l === L)) {
    return {
      ...base,
      acao: 'posicao',
      cargas: cargasLast,
      metas: metasLast,
      motivo: 'Na última sessão você seguiu cargas diferentes por série. Cada série é comparada com a mesma posição.',
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
  // Folga acima do planejado (4+) em que todas as séries chegariam ao topo deixando a reserva alvo.
  const ideais = ws.map((s) => idealReps(s, p));
  const comFolga = ws.some((s) => (rirOf(s).v ?? 0) > p.rirMax);
  const folgaTodas = comFolga && margem && ws.length >= n && ideais.every((x) => x != null && x >= p.repMax);
  const feitoTxt = allTop && margem ? `Você fez ${repsTxt} com margem.` : `Você fez ${repsTxt} com bastante reserva (${ws.map(rirCurto).join('/')}).`;

  if (((allTop && margem) || folgaTodas) && L != null) {
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
          ? `${feitoTxt} Para progredir, informe o próximo nível com menos assistência que ${W}.`
          : `${feitoTxt} Para subir, informe o próximo peso disponível acima de ${W}.`,
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
        motivo: `${feitoTxt} Teste ${fmtW(nx)} ${u} (${saltoTxt}) mirando ${p.repMin} repetições. Se a 1ª série ficar abaixo de ${p.repMin}, volte para ${W}.`,
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
      motivo: `${feitoTxt} ${saltoGrande} Passa do limite automático de ${fmtPct(p.limitePct)}: mantenha ${W} mirando ${p.repMax}, ou teste o peso novo se quiser.${teto >= 2 ? ` Teto da faixa atingido com folga em ${teto} sessões seguidas: revise a faixa.` : ''}`,
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

  if (comFolga) {
    // Séries com 4+: aproveita a folga em mais repetições, dentro da faixa.
    const metas = metasLast.map((m, i) => {
      const s = at(ws, i);
      const id = idealReps(s, p);
      return (rirOf(s).v ?? 0) > p.rirMax && id != null ? clamp(Math.max(id, m), p.repMin, p.repMax) : m;
    });
    const novas = metas.reduce((a, b) => a + b, 0) > metasLast.reduce((a, b) => a + b, 0) ? metas : plusOne(metas, p.repMax);
    return {
      ...base,
      acao: 'manter',
      cargas: fill(n, L),
      metas: novas,
      motivo: `Na última sessão: ${W} × ${repsTxt}, com mais reserva que o planejado (${ws.map(rirCurto).join('/')}). Mantenha ${W} e tente ${novas.join('/')}, aproveitando a folga dentro da faixa ${p.repMin}–${p.repMax}.`,
    };
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
  /** Salto grande: o app não aplica sozinho, mostra como opção. */
  opcao?: { carga: number; reps: number; texto: string };
  /** Pergunta o próximo peso disponível a partir desta carga. */
  perguntarProximo?: number;
  /** A carga sugerida segue uma sequência planejada por posição (não é ajuste). */
  sequencia?: boolean;
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

  const p = presc;
  const idx = step.posicao - 1;
  const done = Object.values(data.sets)
    .filter(
      (s) =>
        s.sessionId === session.id &&
        s.exerciseId === step.exerciseId &&
        s.tipo === 'trabalho' &&
        s.status === 'feita' &&
        s.lado === step.lado &&
        s.posicao < step.posicao,
    )
    .sort((a, b) => a.posicao - b.posicao);
  const meta = (i: number) => planD.metas[Math.min(i, planD.metas.length - 1)] ?? null;
  const W = (w: number | null) => (w == null ? 'o mesmo peso' : `${fmtW(w)} ${u}`);
  const seq = planD.acao === 'posicao';
  const planejada = planD.cargas[Math.min(idx, planD.cargas.length - 1)] ?? null;

  if (!done.length) {
    const sl = planD.salto;
    const grande = !corporal && sl && sl.pct != null && sl.pct > p.limitePct + 1e-9 && planD.acao !== 'subir';
    return {
      carga: corporal ? null : planejada,
      reps: meta(idx),
      motivo: planD.motivo,
      plan: planD,
      voltarPara: planD.acao === 'subir' ? planD.salto?.de : undefined,
      opcao: grande ? { carga: sl.para, reps: p.repMin, texto: `Testar ${W(sl.para)} × ${p.repMin} (${saltoTexto(eq, sl.de, sl.para, sl.pct)})` } : undefined,
      perguntarProximo: planD.acao === 'perguntar' ? planD.perguntarProximo : undefined,
      sequencia: seq,
    };
  }

  // Avalia a série anterior desta sessão: peso, repetições, reserva, ajuda, dor e descanso.
  const prev = done[done.length - 1];
  const r = rirOf(prev);
  const reps0 = prev.reps ?? p.repMin;
  const carga0 = corporal ? null : prev.carga;
  const plano = seq ? planejada : carga0;
  const faixa = `${p.repMin}–${p.repMax}`;
  const esforco = `${p.rirMin} a ${p.rirMax}`;
  const fez = `${carga0 != null ? `${W(carga0)} × ` : ''}${reps0}`;
  const termo = isAssist(eq) ? 'nível de assistência' : 'peso';
  const out = (carga: number | null, reps: number, motivo: string, extra: Partial<StepSuggestion> = {}): StepSuggestion => ({
    carga: corporal ? null : carga,
    reps,
    motivo,
    plan: planD,
    sequencia: seq && carga === planejada,
    ...extra,
  });
  const naFaixa = (v: number) => clamp(v, p.repMin, p.repMax);

  if (prev.dor) return out(plano, naFaixa(reps0), `Você marcou dor na série anterior. Mantenha ${W(plano)} sem progredir e pare se a dor aumentar.`);
  if (prev.ajuda) {
    const m = naFaixa(reps0);
    return out(plano, m, `A série anterior teve ajuda. Mantenha ${W(plano)} e tente ${m} sem ajuda, contando só as repetições completas.`);
  }
  if (r.v == null) {
    const m = (seq ? meta(idx) : null) ?? naFaixa(reps0);
    return out(plano, m, `A reserva da série anterior não foi informada. Mantenha ${W(plano)} e tente ${m}.`);
  }

  const alvo = alvoRir(p);
  const cap = reps0 + r.v;
  const ideal = cap - alvo;
  /** Repetições estimadas com outra carga deixando a reserva alvo, dentro da faixa. */
  const repsAt = (w: number | null) => {
    if (w == null || w === prev.carga || prev.carga == null) return naFaixa(ideal);
    const c = capAt(eq, prev.carga, cap, w, ctx.pesoCorporal);
    return c == null ? p.repMin : naFaixa(Math.floor(c - alvo));
  };
  const curto = prev.intervaloSeg != null && prev.descansoPlanejadoSeg != null && prev.intervaloSeg < prev.descansoPlanejadoSeg * 0.8;
  const descansoTxt = curto ? ` O descanso antes dela foi curto (${fmtDur(prev.intervaloSeg!)} de ${fmtDur(prev.descansoPlanejadoSeg!)}): descanse o tempo todo.` : '';

  // Mais pesada que o planejado: nem o mínimo da faixa sai deixando a reserva mínima.
  if (cap - p.rirMin < p.repMin) {
    const pesada = `Com ${fez} ${comReserva(prev)}, a série ficou mais pesada que o planejado (${faixa} com ${esforco} de reserva).`;
    if (curto) return out(carga0, p.repMin, `${pesada}${descansoTxt} Mantenha ${W(carga0)} mirando ${p.repMin}.`);
    if (corporal || prev.carga == null) return out(null, p.repMin, `${pesada} Tente ${p.repMin} e, se não sair, registre o que conseguir.`);
    const leves = done.map((s) => s.carga).filter((w): w is number => w != null && maisDificil(eq, prev.carga!, w));
    let lower: number | undefined = leves.length ? (isAssist(eq) ? Math.min(...leves) : Math.max(...leves)) : undefined;
    if (lower == null && planD.salto && prev.carga === planD.salto.para) lower = planD.salto.de;
    if (lower == null) lower = easier(eq, prev.carga);
    if (lower == null) return out(prev.carga, p.repMin, `${pesada} Diminua o ${termo} e mire ${p.repMin}.`);
    const m = repsAt(lower);
    return out(lower, m, `${pesada} Volte para ${W(lower)} e tente ${m}.`);
  }

  // Até a falha ou com menos reserva que o mínimo: ajusta as repetições dentro da faixa, nunca sobe.
  if (r.v < p.rirMin) {
    const m = repsAt(plano);
    const intro = r.v === 0 ? `Você foi até a falha (${fez}).` : `Você deixou menos reserva que o planejado (${fez}, ${rirTexto(prev)}).`;
    return out(plano, m, `${intro} Mantenha ${W(plano)} e pare em ${m}, deixando ${esforco} de reserva. Série até a falha não sobe o ${termo}.${descansoTxt}`);
  }

  // Leve demais: a folga passa do topo da faixa, ou já passou da faixa com reserva.
  const leve = r.v > p.rirMax ? ideal > p.repMax : reps0 > p.repMax;
  if (!leve) {
    if (seq) {
      const m = meta(idx) ?? naFaixa(reps0);
      return out(planejada, m, `Você fez ${fez} ${comReserva(prev)}, dentro do esforço planejado. Siga a sequência: ${W(planejada)} × ${m}.`);
    }
    if (r.v <= p.rirMax) {
      const dentro = `Você fez ${fez} ${comReserva(prev)}, dentro do esforço planejado (${esforco} de reserva).`;
      if (reps0 >= p.repMax) {
        return out(
          carga0,
          p.repMax,
          `${dentro} Está no topo da faixa (${faixa}): mantenha ${W(carga0)} e repita ${p.repMax}. Quando todas as séries fecharem no topo com reserva, a próxima sessão sobe o ${termo}.`,
        );
      }
      if (r.v > p.rirMin) {
        const m = naFaixa(reps0 + 1);
        return out(carga0, m, `${dentro} Mantenha ${W(carga0)} e tente ${m}: uma repetição a mais, ainda dentro da faixa ${faixa}.`);
      }
      const m = naFaixa(reps0);
      return out(carga0, m, `${dentro} Mantenha ${W(carga0)} e repita ${m}.`);
    }
    const m = naFaixa(Math.max(ideal, reps0 + 1));
    return out(
      carga0,
      m,
      `Você relatou ${rirTexto(prev)} com ${fez}, mais folga que o planejado (${esforco} de reserva). Mantenha ${W(carga0)} e vá até ${m}${m === p.repMax ? ', o topo da faixa' : ''}, para chegar perto de ${alvo} de reserva.`,
    );
  }

  const intro = r.v > p.rirMax ? `Você relatou bastante folga (${rirTexto(prev)} com ${fez}).` : `Você passou do topo da faixa (${fez}, faixa ${faixa}) ${comReserva(prev)}.`;
  const manter = `mantenha ${W(carga0)} e vá até ${p.repMax}, o topo da faixa`;
  if (corporal || carga0 == null) {
    return out(null, p.repMax, `${intro} Sem ${termo} para aumentar aqui: vá até ${p.repMax}, o topo da faixa. Se continuar sobrando muito, fale com o personal sobre uma variação mais difícil.`);
  }
  const sub = proximaCarga(ctx, carga0, cap);
  if (sub.tipo === 'perguntar') {
    return out(
      carga0,
      p.repMax,
      `${intro} Para sugerir o próximo ${termo}, informe abaixo o próximo ${isAssist(eq) ? `nível com menos assistência que ${W(carga0)}` : `peso disponível acima de ${W(carga0)}`}. Se preferir não subir agora, ${manter}.`,
      { perguntarProximo: carga0 },
    );
  }
  if (sub.tipo === 'limite') return out(carga0, p.repMax, `${intro} ${W(carga0)} é o limite deste aparelho: ${manter}.`);
  const nx = sub.para!;
  const salto = saltoTexto(eq, carga0, nx, sub.pct);
  const pesadaDemais = sub.est != null && sub.est < p.repMin;
  if (sub.tipo === 'subir' && !pesadaDemais) {
    return out(nx, p.repMin, `${intro} Vamos testar o próximo ${termo} disponível, ${W(nx)} (${salto}), começando pelo limite inferior da faixa: ${p.repMin} repetições.`, {
      voltarPara: carga0,
    });
  }
  const porque = pesadaDemais
    ? `parece pesado demais para ${p.repMin} repetições`
    : sub.pct == null
      ? 'preencha seu peso no perfil para o app medir esse salto'
      : `passa do limite automático de ${fmtPct(p.limitePct)}`;
  return out(
    carga0,
    p.repMax,
    `${intro} O próximo ${termo} disponível, ${W(nx)}, é um salto de ${salto}: ${porque}, então o app não sobe sozinho. Escolha: ${manter}, ou teste ${W(nx)} no botão abaixo. Se o aparelho tiver um ${termo} intermediário, digite-o.`,
    { opcao: { carga: nx, reps: p.repMin, texto: `Testar ${W(nx)} × ${p.repMin} (${salto})` } },
  );
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
  // Exercício acrescentado por ele hoje não é sugerido para sair.
  const extras = new Set((session?.extras ?? []).map((x) => x.id));
  const ativos = ps.slots.filter((s) => !extras.has(s.id) && (!session || slotActive(session, s.id)));
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

// ===================== exercício extra =====================

/**
 * Exercícios que podem entrar só nesta sessão: do catálogo ativo, com músculo principal entre os
 * trabalhados hoje (principais primeiro, na ordem da ficha) e que ainda não estão no treino.
 */
export function extraCandidates(ps: PlanSession, session: Session, t: TrainingSettings): string[] {
  const principais: Grupo[] = [];
  const secundarios: Grupo[] = [];
  const usados = new Set<string>();
  for (const slot of ps.slots) {
    usados.add(slot.exerciseId);
    for (const seg of slotSegments(slot, session.slots[slot.id], t)) {
      usados.add(seg.exerciseId);
      const e = getEx(seg.exerciseId);
      if (!principais.includes(e.grupo)) principais.push(e.grupo);
      e.secundarios.forEach((g) => !secundarios.includes(g) && secundarios.push(g));
    }
  }
  const grupos = [...principais, ...secundarios.filter((g) => !principais.includes(g))];
  return CATALOG.filter((e) => isActive(e.id, t) && grupos.includes(e.grupo) && !usados.has(e.id))
    .sort((a, b) => grupos.indexOf(a.grupo) - grupos.indexOf(b.grupo) || Number(b.composto) - Number(a.composto))
    .map((e) => e.id);
}

/** Prescrição padrão do exercício extra: composto 3 × 8–12 (2 min); isolado 2 × 10–15 (75 s). */
export function extraSlot(id: string, exerciseId: string): PlanSlot {
  const e = getEx(exerciseId);
  const base = { id, exerciseId, rirMin: 1, rirMax: 3, prioridade: 3 as const, dica: e.dica ?? '' };
  return e.composto ? { ...base, series: 3, repMin: 8, repMax: 12, descansoSeg: 120 } : { ...base, series: 2, repMin: 10, repMax: 15, descansoSeg: 75 };
}
