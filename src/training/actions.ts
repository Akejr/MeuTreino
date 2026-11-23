/** Todas as alterações do módulo de treino. Cada uma é uma única operação salva no aparelho. */
import { getData, setData } from '../lib/storage';
import { addDays, todayISO, weekStart } from '../lib/utils';
import type { AppData, Base, Equipment, MotivoTroca, PlanVersion, Session, SetLog, SlotState, Unidade } from '../types';
import { getEx, resolveExercise } from './catalog';
import { emptySlotState, nextWorkPosition, sessionSteps, slotSegments, swapCandidates, type Step } from './engine';
import { INITIAL_PLAN_ID, initialPlan } from './initialPlan';
import { activePlan, applyChanges, computeReschedule, ensureSessions, isPaused, moveSession, planSessionOf, type Change } from './schedule';

const wkey = (w: number) => String(Math.round(w * 1000) / 1000);

const PARADO_MS = 2 * 3600 * 1000;

/** Treino aberto sem nenhuma série há mais de 2 h: pausa (o tempo conta até 5 min depois da última ação). */
export function autoPauseStale(now = Date.now()) {
  setData((d) => {
    let sessions = d.sessions;
    for (const s of Object.values(d.sessions)) {
      if (s.status !== 'em_andamento' || isPaused(s)) continue;
      const lastSet = Math.max(0, ...Object.values(d.sets).filter((x) => x.sessionId === s.id).map((x) => x.confirmadoEm));
      const last = Math.max(lastSet, s.intervalos[s.intervalos.length - 1]?.i ?? 0);
      if (now - last < PARADO_MS) continue;
      if (sessions === d.sessions) sessions = { ...d.sessions };
      sessions[s.id] = closeInterval(s, Math.min(now, last + 5 * 60 * 1000));
    }
    return sessions === d.sessions ? d : { ...d, sessions };
  });
}

export function ensureTraining(hoje = todayISO()) {
  autoPauseStale();
  setData((d) => {
    let next = d;
    if (!activePlan(next) && !next.plans[INITIAL_PLAN_ID]) next = { ...next, plans: { ...next.plans, [INITIAL_PLAN_ID]: initialPlan(hoje) } };
    return ensureSessions(next, hoje);
  });
}

function patchSession(d: AppData, id: string, fn: (s: Session) => Session): AppData {
  const s = d.sessions[id];
  return s ? { ...d, sessions: { ...d.sessions, [id]: fn(s) } } : d;
}

function patchSlot(s: Session, slotId: string, fn: (st: SlotState) => SlotState): Session {
  return { ...s, slots: { ...s.slots, [slotId]: fn(s.slots[slotId] ?? emptySlotState()) } };
}

function closeInterval(s: Session, now: number): Session {
  const intervalos = s.intervalos.map((iv, i) => (i === s.intervalos.length - 1 && iv.f == null ? { ...iv, f: now } : iv));
  const duracaoSeg = Math.round(intervalos.reduce((n, iv) => n + ((iv.f ?? now) - iv.i), 0) / 1000);
  return { ...s, intervalos, duracaoSeg, descansoAte: undefined };
}

// ---------- sessão ----------

export function startSession(id: string) {
  const now = Date.now();
  const hoje = todayISO();
  setData((d) => {
    const aberta = Object.values(d.sessions).find((s) => s.status === 'em_andamento' && s.id !== id);
    if (aberta) return d;
    return patchSession(d, id, (s) =>
      s.status === 'em_andamento'
        ? isPaused(s)
          ? { ...s, intervalos: [...s.intervalos, { i: now }] }
          : s
        : {
            ...s,
            status: 'em_andamento',
            retomar: false,
            inicio: s.inicio ?? now,
            dataReal: s.dataReal ?? hoje,
            intervalos: [...s.intervalos, { i: now }],
          },
    );
  });
}

/** Para o cronômetro e sai do treino. A sessão continua aberta para continuar depois (hoje ou outro dia). */
export function pauseSession(id: string) {
  const now = Date.now();
  setData((d) => patchSession(d, id, (s) => (s.status === 'em_andamento' && !isPaused(s) ? closeInterval(s, now) : s)));
}

export type FinishMode = 'concluir' | 'encerrar' | 'retomar';

export function finishSession(id: string, mode: FinishMode): Change[] {
  const now = Date.now();
  let changes: Change[] = [];
  setData((d) => {
    let next = patchSession(d, id, (s) => {
      const c = closeInterval(s, now);
      return { ...c, fim: now, status: mode === 'concluir' ? 'concluida' : 'parcial', retomar: mode === 'retomar' };
    });
    if (mode === 'retomar') {
      const plan = computeReschedule(next, todayISO(), { from: addDays(todayISO(), 1), retomarIds: [id] });
      changes = plan.changes;
      next = applyChanges(next, plan.changes);
    }
    return next;
  });
  return changes;
}

export interface ConfirmValues {
  carga: number | null;
  reps: number | null;
  rir: number | null;
  ajuda: boolean;
  dor: boolean;
  dorTipo?: SetLog['dorTipo'];
  cargaSugerida: number | null;
  metaReps: number | null;
}

/** Confirma uma série. Idempotente: confirmar a mesma série de novo atualiza o mesmo registro. */
export function confirmStep(sessionId: string, step: Step, v: ConfirmValues) {
  const now = Date.now();
  const hoje = todayISO();
  setData((d) => {
    const session = d.sessions[sessionId];
    const ps = session && planSessionOf(d, session);
    const slot = ps?.slots.find((s) => s.id === step.slotId);
    if (!session || !ps || !slot) return d;
    const ex = getEx(step.exerciseId);
    const eq: Equipment = d.equipment[ex.equip] ?? { id: ex.equip, unidade: 'kg', base: ex.baseSugerida, proximo: {}, conhecidos: [] };
    const existing = d.sets[step.id];

    const anteriores = Object.values(d.sets).filter((s) => s.sessionId === sessionId && s.status === 'feita' && s.id !== step.id);
    const ultimo = anteriores.sort((a, b) => b.confirmadoEm - a.confirmadoEm)[0];
    const intervaloSeg =
      existing?.intervaloSeg ?? (step.tipo === 'trabalho' && ultimo ? Math.max(0, Math.round((now - ultimo.confirmadoEm) / 1000) - 40) : undefined);

    const set: SetLog = {
      id: step.id,
      sessionId,
      slotId: step.slotId,
      exerciseId: step.exerciseId,
      equipId: ex.equip,
      tipo: step.tipo,
      posicao: step.posicao,
      lado: step.lado,
      status: 'feita',
      metaRepsMin: slot.repMin,
      metaRepsMax: slot.repMax,
      metaReps: v.metaReps,
      cargaSugerida: v.cargaSugerida,
      carga: v.carga,
      reps: v.reps,
      rir: step.tipo === 'trabalho' ? v.rir : null,
      ajuda: v.ajuda,
      dor: v.dor,
      dorTipo: v.dor ? v.dorTipo : undefined,
      unidade: eq.unidade,
      base: eq.base,
      descansoPlanejadoSeg: step.tipo === 'trabalho' ? slot.descansoSeg : undefined,
      intervaloSeg,
      data: existing?.data ?? hoje,
      confirmadoEm: existing?.confirmadoEm ?? now,
    };

    const conhecidos = v.carga != null && !eq.conhecidos.includes(v.carga) ? [...eq.conhecidos, v.carga].sort((a, b) => a - b) : eq.conhecidos;
    let next: AppData = {
      ...d,
      sets: { ...d.sets, [step.id]: set },
      equipment: conhecidos !== eq.conhecidos || !d.equipment[ex.equip] ? { ...d.equipment, [ex.equip]: { ...eq, conhecidos } } : d.equipment,
    };

    // Descanso: depois do lado D vai direto para o E.
    const restSeg = step.tipo === 'aquecimento' ? 60 : step.tipo === 'aproximacao' ? 90 : step.lado === 'D' ? 0 : slot.descansoSeg;
    next = patchSession(next, sessionId, (s) => ({
      ...s,
      descansoAte: !existing && restSeg > 0 ? now + restSeg * 1000 : s.descansoAte,
      descansoSeg: !existing && restSeg > 0 ? restSeg : s.descansoSeg,
    }));

    if (v.dor && v.dorTipo === 'aguda') next = patchSession(next, sessionId, (s) => ({ ...patchSlot(s, step.slotId, (st) => ({ ...st, status: 'dor' })), descansoAte: undefined }));
    if (v.dor && v.dorTipo === 'alerta') {
      next = patchSession(next, sessionId, (s) => {
        const c = closeInterval(patchSlot(s, step.slotId, (st) => ({ ...st, status: 'dor' })), now);
        return { ...c, status: 'parcial', retomar: false, fim: now };
      });
    }
    return next;
  });
}

export function editSet(id: string, patch: Partial<Pick<SetLog, 'carga' | 'reps' | 'rir' | 'ajuda' | 'dor'>>) {
  setData((d) => (d.sets[id] ? { ...d, sets: { ...d.sets, [id]: { ...d.sets[id], ...patch } } } : d));
}

export function skipStep(sessionId: string, step: Step) {
  setData((d) => {
    if (d.sets[step.id]) return d;
    const ex = getEx(step.exerciseId);
    const eq = d.equipment[ex.equip];
    const set: SetLog = {
      id: step.id,
      sessionId,
      slotId: step.slotId,
      exerciseId: step.exerciseId,
      equipId: ex.equip,
      tipo: step.tipo,
      posicao: step.posicao,
      lado: step.lado,
      status: 'pulada',
      cargaSugerida: null,
      carga: null,
      reps: null,
      rir: null,
      ajuda: false,
      dor: false,
      unidade: eq?.unidade ?? 'kg',
      base: eq?.base ?? ex.baseSugerida,
      data: todayISO(),
      confirmadoEm: Date.now(),
    };
    return { ...d, sets: { ...d.sets, [step.id]: set } };
  });
}

export function skipRest(sessionId: string) {
  setData((d) => patchSession(d, sessionId, (s) => ({ ...s, descansoAte: undefined })));
}

export function addRest(sessionId: string, seg: number) {
  setData((d) => patchSession(d, sessionId, (s) => (s.descansoAte ? { ...s, descansoAte: s.descansoAte + seg * 1000, descansoSeg: (s.descansoSeg ?? 0) + seg } : s)));
}

export function addWarmup(sessionId: string, slotId: string) {
  setData((d) => patchSession(d, sessionId, (s) => patchSlot(s, slotId, (st) => ({ ...st, aquecExtra: (st.aquecExtra ?? 0) + 1 }))));
}

export function setSlotStatus(sessionId: string, slotId: string, status: SlotState['status']) {
  setData((d) => patchSession(d, sessionId, (s) => patchSlot(s, slotId, (st) => ({ ...st, status, oferta: undefined }))));
}

export function setPainCheck(sessionId: string, slotId: string, r: 'ok' | 'dor') {
  setData((d) => patchSession(d, sessionId, (s) => patchSlot(s, slotId, (st) => ({ ...st, dorCheck: r, status: r === 'dor' ? 'dor' : st.status }))));
}

// ---------- troca de exercício ----------

/** Mostra a próxima alternativa (cada uma aparece uma única vez por vaga e sessão). */
export function showNextAlternative(sessionId: string, slotId: string) {
  setData((d) => {
    const s = d.sessions[sessionId];
    const ps = s && planSessionOf(d, s);
    if (!s || !ps) return d;
    const [first] = swapCandidates(ps, s, slotId, d);
    if (!first) return d;
    return patchSession(d, sessionId, (x) => patchSlot(x, slotId, (st) => ({ ...st, oferta: first, exibidas: [...st.exibidas, first] })));
  });
}

export function dismissOffer(sessionId: string, slotId: string) {
  setData((d) => patchSession(d, sessionId, (s) => patchSlot(s, slotId, (st) => ({ ...st, oferta: undefined }))));
}

export function acceptOffer(sessionId: string, slotId: string, motivo: MotivoTroca, evitarNoFuturo: boolean) {
  setData((d) => {
    const s = d.sessions[sessionId];
    const ps = s && planSessionOf(d, s);
    const slot = ps?.slots.find((x) => x.id === slotId);
    const st = s?.slots[slotId];
    if (!s || !ps || !slot || !st?.oferta) return d;
    const segs = slotSegments(slot, st, d.settings.training);
    const de = segs[segs.length - 1].exerciseId;
    const posicao = nextWorkPosition(ps, s, slotId, d);
    let next = patchSession(d, sessionId, (x) =>
      patchSlot(x, slotId, (y) => ({
        ...y,
        oferta: undefined,
        trocas: [...y.trocas, { de, para: st.oferta!, motivo, posicao, exibidas: [...y.exibidas], em: Date.now() }],
      })),
    );
    if (motivo === 'nao_gosto' && evitarNoFuturo && !next.settings.training.naoGosto.includes(de)) {
      next = { ...next, settings: { ...next.settings, training: { ...next.settings.training, naoGosto: [...next.settings.training.naoGosto, de] } } };
    }
    return next;
  });
}

// ---------- catálogo e equipamentos ----------

export function answerQuestion(qid: string, ativa: string[]) {
  setData((d) => ({
    ...d,
    settings: { ...d.settings, training: { ...d.settings.training, respostas: { ...d.settings.training.respostas, [qid]: ativa } } },
  }));
}

export function saveEquipment(id: string, unidade: Unidade, base: Base) {
  setData((d) => {
    const cur = d.equipment[id];
    return { ...d, equipment: { ...d.equipment, [id]: { id, unidade, base, proximo: cur?.proximo ?? {}, conhecidos: cur?.conhecidos ?? [] } } };
  });
}

/** Guarda o próximo peso disponível a partir de uma posição. `para` = -1: não existe. */
export function setNextWeight(id: string, de: number, para: number) {
  setData((d) => {
    const cur = d.equipment[id];
    if (!cur) return d;
    const conhecidos = para > 0 && !cur.conhecidos.includes(para) ? [...cur.conhecidos, para].sort((a, b) => a - b) : cur.conhecidos;
    return { ...d, equipment: { ...d.equipment, [id]: { ...cur, proximo: { ...cur.proximo, [wkey(de)]: para }, conhecidos } } };
  });
}

export function removeNextWeight(id: string, de: string) {
  setData((d) => {
    const cur = d.equipment[id];
    if (!cur) return d;
    const { [de]: _x, ...proximo } = cur.proximo;
    return { ...d, equipment: { ...d.equipment, [id]: { ...cur, proximo } } };
  });
}

// ---------- agenda ----------

export function applyReschedule(changes: Change[]) {
  setData((d) => applyChanges(d, changes));
}

/** "Hoje não vou treinar": registra falta e reorganiza a partir de amanhã. */
export function skipToday(sessionId: string): Change[] {
  let changes: Change[] = [];
  setData((d) => {
    const plan = computeReschedule(d, todayISO(), { from: addDays(todayISO(), 1), faltaIds: [sessionId] });
    changes = plan.changes;
    return applyChanges(d, plan.changes);
  });
  return changes;
}

export function markNoMakeup(ids: string[]) {
  setData((d) => {
    const sessions = { ...d.sessions };
    for (const id of ids) if (sessions[id]) sessions[id] = { ...sessions[id], status: 'falta', retomar: false };
    return { ...d, sessions };
  });
}

export function moveTo(id: string, date: string) {
  setData((d) => moveSession(d, id, date));
}

// ---------- ficha ----------

/** Ativa uma nova versão da ficha a partir de hoje, preservando a anterior no histórico. */
export function activatePlan(plan: PlanVersion) {
  const hoje = todayISO();
  setData((d) => {
    const plans = { ...d.plans };
    for (const p of Object.values(plans)) if (p.status === 'ativa') plans[p.id] = { ...p, status: 'arquivada', vigenciaFim: hoje };
    plans[plan.id] = { ...plan, status: 'ativa', vigenciaInicio: hoje };
    const sessions = { ...d.sessions };
    for (const s of Object.values(sessions)) {
      if (s.status !== 'pendente' || s.inicio || s.dataAtual < hoje) continue;
      const ps = plan.sessoes.find((x) => x.key === s.key);
      if (!ps) {
        delete sessions[s.id];
        continue;
      }
      const naoMovida = s.dataAtual === s.dataOriginal;
      const novaData = addDays(weekStart(s.dataOriginal), ps.dia - 1);
      sessions[s.id] = {
        ...s,
        planId: plan.id,
        titulo: ps.titulo,
        ...(naoMovida && novaData >= hoje ? { dataOriginal: novaData, dataAtual: novaData } : {}),
      };
    }
    return ensureSessions({ ...d, plans, sessions }, hoje);
  });
}

export function nextPlanVersion(d: AppData): number {
  return Math.max(0, ...Object.values(d.plans).map((p) => p.versao)) + 1;
}

export function currentStepsFor(sessionId: string): Step[] {
  const d = getData();
  const s = d.sessions[sessionId];
  const ps = s && planSessionOf(d, s);
  return s && ps ? sessionSteps(ps, s, d.settings.training) : [];
}

export { resolveExercise };
