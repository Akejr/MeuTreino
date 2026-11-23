import { describe, expect, it } from 'vitest';
import { defaultData } from '../lib/defaults';
import type { AppData, Equipment, Session, SetLog } from '../types';
import { emptySlotState, estimateSession, dropCandidate, sessionSteps, suggestForStep, suggestNext, swapCandidates, prescOf, stepCtx, currentStep } from './engine';
import { initialPlan } from './initialPlan';
import { computeReschedule, ensureSessions, applyChanges } from './schedule';

const HOJE = '2026-11-25'; // quarta
const plan = initialPlan('2026-11-23');
const ses = (k: string) => plan.sessoes.find((s) => s.key === k)!;
const slotOf = (k: string, i: number) => ses(k).slots[i];

function base(): AppData {
  const d = defaultData();
  d.plans = { [plan.id]: plan };
  return d;
}

let n = 0;
function work(exerciseId: string, sessionId: string, data: string, posicao: number, carga: number, reps: number, rir: number | null, extra: Partial<SetLog> = {}): SetLog {
  n++;
  return {
    id: `t${n}`,
    sessionId,
    slotId: 'A2',
    exerciseId,
    equipId: exerciseId,
    tipo: 'trabalho',
    posicao,
    status: 'feita',
    cargaSugerida: null,
    carga,
    reps,
    rir,
    ajuda: false,
    dor: false,
    unidade: 'kg',
    base: 'total',
    data,
    confirmadoEm: Date.parse(data) + posicao * 1000 + n,
    ...extra,
  };
}

function withSets(d: AppData, sets: SetLog[]): AppData {
  return { ...d, sets: Object.fromEntries(sets.map((s) => [s.id, s])) };
}

const eq = (id: string, patch: Partial<Equipment> = {}): Equipment => ({ id, unidade: 'kg', base: 'total', proximo: {}, conhecidos: [], ...patch });

function sessionFor(k: string, id = `s-${k}`): Session {
  return { id, planId: plan.id, key: k, titulo: ses(k).titulo, dataOriginal: HOJE, dataAtual: HOJE, status: 'em_andamento', intervalos: [], slots: {}, historicoDatas: [] };
}

const remada = slotOf('A', 1); // remada_apoio_peito 3 × 8–12
const puxada = slotOf('A', 0); // 3 × 7–9

function ctxFor(d: AppData, slot = puxada, ex = slot.exerciseId) {
  return stepCtx(d, slot, ex, HOJE);
}

describe('aceitação · página 14', () => {
  it('01 · primeiro treino: o primeiro cartão é aquecimento de 8 com carga vazia e não conta como trabalho', () => {
    const d = base();
    const s = sessionFor('A');
    const step = currentStep(ses('A'), s, d)!;
    expect(step.tipo).toBe('aquecimento');
    const sug = suggestForStep(step, s, puxada, d, HOJE);
    expect(sug.reps).toBe(8);
    expect(sug.carga).toBeNull();
    const d2 = withSets(d, [{ ...work(puxada.exerciseId, 'old', '2026-11-16', 1, 20, 8, null), tipo: 'aquecimento' }]);
    expect(suggestNext(puxada.exerciseId, undefined, ctxFor(d2)).acao).toBe('calibrar');
  });

  it('02 · retorno à mesma máquina: recupera aquecimento e trabalho reais', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [
      { ...work(ex, 'old', '2026-11-16', 1, 20, 8, null), tipo: 'aquecimento' },
      work(ex, 'old', '2026-11-16', 1, 40, 8, 2),
      work(ex, 'old', '2026-11-16', 2, 40, 8, 2),
      work(ex, 'old', '2026-11-16', 3, 40, 7, 2),
    ]);
    const s = sessionFor('A');
    const steps = sessionSteps(ses('A'), s, d.settings.training);
    expect(suggestForStep(steps[0], s, puxada, d, HOJE).carga).toBe(20);
    const w1 = steps.find((x) => x.tipo === 'trabalho')!;
    expect(suggestForStep(w1, s, puxada, d, HOJE).carga).toBe(40);
  });

  it('03 · 40 kg com 8/8/7 e margem: manter 40 kg e tentar 24 no total', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [work(ex, 'o', '2026-11-16', 1, 40, 8, 2), work(ex, 'o', '2026-11-16', 2, 40, 8, 2), work(ex, 'o', '2026-11-16', 3, 40, 7, 2)]);
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('manter');
    expect(p.cargas).toEqual([40, 40, 40]);
    expect(p.metas).toEqual([8, 8, 8]);
    expect(p.motivo).toContain('24 repetições');
    expect(Object.values(d.sets).length).toBe(3);
  });

  it('04 · 9/9/9 com margem e 42,5 kg disponível: testa 42,5 mirando 7 e permite voltar a 40', () => {
    const ex = puxada.exerciseId;
    let d = withSets(base(), [work(ex, 'o', '2026-11-16', 1, 40, 9, 2), work(ex, 'o', '2026-11-16', 2, 40, 9, 2), work(ex, 'o', '2026-11-16', 3, 40, 9, 1)]);
    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 42.5 }, conhecidos: [40, 42.5] }) };
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('subir');
    expect(p.cargas[0]).toBe(42.5);
    expect(p.metas[0]).toBe(7);
    expect(p.salto?.pct).toBeCloseTo(6.25);

    const s = sessionFor('A');
    const steps = sessionSteps(ses('A'), s, d.settings.training).filter((x) => x.tipo === 'trabalho' && x.slotId === 'A1');
    expect(suggestForStep(steps[0], s, puxada, d, HOJE).voltarPara).toBe(40);
    d = { ...d, sets: { ...d.sets, [steps[0].id]: { ...work(ex, s.id, HOJE, 1, 42.5, 6, 0), id: steps[0].id } } };
    expect(suggestForStep(steps[1], s, puxada, d, HOJE).carga).toBe(40);
  });

  it('04b · 9/8/7 numa faixa 7–9: mantém 40 kg mesmo com 42,5 disponível', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [work(ex, 'o', '2026-11-16', 1, 40, 9, 2), work(ex, 'o', '2026-11-16', 2, 40, 8, 2), work(ex, 'o', '2026-11-16', 3, 40, 7, 2)]);
    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 42.5 } }) };
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('manter');
    expect(p.cargas[0]).toBe(40);
  });

  it('05 · ajuda impede aumento; dor suspende a progressão', () => {
    const ex = puxada.exerciseId;
    const top = (extra: Partial<SetLog>) => [work(ex, 'o', '2026-11-16', 1, 40, 9, 2, extra), work(ex, 'o', '2026-11-16', 2, 40, 9, 2), work(ex, 'o', '2026-11-16', 3, 40, 9, 2)];
    const d = base();
    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 42.5 } }) };
    expect(suggestNext(ex, undefined, ctxFor(withSets(d, top({ ajuda: true })))).acao).toBe('manter');
    expect(suggestNext(ex, undefined, ctxFor(withSets(d, top({ dor: true })))).acao).toBe('dor');
  });

  it('06 · degrau grande ou desconhecido: não inventa carga', () => {
    const ex = puxada.exerciseId;
    const top = (sid: string, dt: string) => [1, 2, 3].map((p) => work(ex, sid, dt, p, 40, 9, 2));
    let d = withSets(base(), top('o1', '2026-11-16'));
    const unknown = suggestNext(ex, undefined, ctxFor(d));
    expect(unknown.acao).toBe('perguntar');
    expect(unknown.perguntarProximo).toBe(40);
    expect(unknown.cargas[0]).toBe(40);

    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 50 } }) };
    const big = suggestNext(ex, undefined, ctxFor(d));
    expect(big.acao).toBe('manter');
    expect(big.cargas[0]).toBe(40);
    expect(big.metas).toEqual([9, 9, 9]);
    expect(big.motivo).toContain('O próximo peso é 50 kg, um aumento de 25%');
    expect(big.revisarFaixa).toBeFalsy();

    d = { ...d, sets: { ...d.sets, ...withSets(d, top('o2', '2026-11-20')).sets } };
    d = withSets(d, [...top('o1', '2026-11-16'), ...top('o2', '2026-11-20')]);
    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 50 } }) };
    expect(suggestNext(ex, undefined, ctxFor(d)).revisarFaixa).toBe(true);
  });

  it('07 · assistida: menos assistência é mais difícil e o salto usa o peso movido', () => {
    const d = base();
    d.settings.training.respostas = { q_graviton: ['barra_assistida'] };
    d.settings.profile.peso = '85';
    const ex = 'barra_assistida';
    const sets = [1, 2, 3].map((p) => work(ex, 'o', '2026-11-16', p, 40, 9, 2, { base: 'assistencia' }));
    const dd = withSets(d, sets);
    dd.equipment = { graviton: eq('graviton', { base: 'assistencia', proximo: { '40': 35 }, conhecidos: [35, 40, 45] }) };
    const p = suggestNext(ex, undefined, ctxFor(dd, puxada, ex));
    expect(p.acao).toBe('manter'); // 5 / 45 = 11,1% > 10%
    expect(p.salto?.kgMenosAjuda).toBe(5);
    expect(p.motivo).toContain('5 kg a menos de ajuda');
    const ctx = { ...ctxFor(dd, puxada, ex), presc: { ...prescOf(puxada, dd.settings.training), limitePct: 12 } };
    expect(suggestNext(ex, undefined, ctx).cargas[0]).toBe(35);
    const semPeso = { ...ctxFor(dd, puxada, ex), pesoCorporal: undefined };
    expect(suggestNext(ex, undefined, semPeso).motivo).toContain('Preencha seu peso');
    // máquina nova = calibração
    expect(suggestNext('puxada_w', undefined, ctxFor(dd, puxada, 'puxada_w')).acao).toBe('calibrar');
  });

  it('08 · última troca elegível: aparece e depois o botão some', () => {
    const d = base();
    const s = sessionFor('C');
    const slot = ses('C').slots.find((x) => x.exerciseId === 'elevacao_lateral_halteres')!;
    expect(swapCandidates(ses('C'), s, slot.id, d)).toEqual(['elevacao_lateral_polia']);
    const s2: Session = { ...s, slots: { [slot.id]: { ...emptySlotState(), oferta: 'elevacao_lateral_polia', exibidas: ['elevacao_lateral_polia'] } } };
    expect(swapCandidates(ses('C'), s2, slot.id, d)).toEqual([]);
    // Graviton confirmado como barra fixa assistida: entra na fila da puxada (página 9).
    expect(swapCandidates(ses('A'), sessionFor('A'), 'A1', d)).toEqual(['puxada_w', 'puxada_articulada', 'barra_assistida']);
    d.settings.training.respostas = { ...d.settings.training.respostas, q_graviton: [] };
    expect(swapCandidates(ses('A'), sessionFor('A'), 'A1', d)).toEqual(['puxada_w', 'puxada_articulada']);
  });

  it('09 · troca após 1 de 3 séries: 1 fica no original, 2 na nova variação', () => {
    const d = base();
    const s: Session = {
      ...sessionFor('A'),
      slots: { A2: { ...emptySlotState(), trocas: [{ de: 'remada_apoio_peito', para: 'remada_polia_barra', motivo: 'ocupado', posicao: 2, exibidas: [], em: 0 }] } },
    };
    const st = sessionSteps(ses('A'), s, d.settings.training).filter((x) => x.slotId === 'A2');
    const trab = st.filter((x) => x.tipo === 'trabalho');
    expect(trab.map((x) => [x.exerciseId, x.posicao])).toEqual([
      ['remada_apoio_peito', 1],
      ['remada_polia_barra', 2],
      ['remada_polia_barra', 3],
    ]);
    expect(st.some((x) => x.exerciseId === 'remada_polia_barra' && x.tipo === 'aquecimento')).toBe(true);
    expect(suggestNext('remada_polia_barra', undefined, ctxFor(d, remada, 'remada_polia_barra')).acao).toBe('calibrar');
  });

  it('10 · falta na terça: B/C/D/E vão para qua/qui/sex/sáb e segunda fica concluída', () => {
    let d = ensureSessions(base(), '2026-11-23');
    const A = 's-2026-11-23-A';
    d.sessions[A] = { ...d.sessions[A], status: 'concluida', dataReal: '2026-11-23' };
    const plan10 = computeReschedule(d, HOJE);
    const map = Object.fromEntries(plan10.changes.map((c) => [d.sessions[c.id].key, c.para]));
    expect(map).toEqual({ B: '2026-11-25', C: '2026-11-26', D: '2026-11-27', E: '2026-11-28' });
    expect(plan10.changes.find((c) => d.sessions[c.id].key === 'B')?.motivo).toBe('falta');
    d = applyChanges(d, plan10.changes);
    expect(d.sessions[A].status).toBe('concluida');
    expect(d.sessions['s-2026-11-30-A'].dataAtual).toBe('2026-11-30');
  });

  it('11 · fim de semana indisponível: leva a pendência para a semana seguinte sem duplicar', () => {
    let d = ensureSessions(base(), '2026-11-23');
    d.settings.training.dias = ['indisponivel', 'treino', 'treino', 'treino', 'treino', 'treino', 'indisponivel'];
    d.sessions['s-2026-11-23-A'] = { ...d.sessions['s-2026-11-23-A'], status: 'concluida', dataReal: '2026-11-23' };
    const p = computeReschedule(d, HOJE);
    d = applyChanges(d, p.changes);
    const datas = Object.values(d.sessions).filter((s) => s.status === 'pendente').map((s) => s.dataAtual);
    expect(new Set(datas).size).toBe(datas.length);
    expect(d.sessions['s-2026-11-23-E'].dataAtual).toBe('2026-11-30');
    expect(d.sessions['s-2026-11-30-A'].dataAtual).toBe('2026-12-01');
    expect(Object.keys(d.sessions).length).toBe(10);
  });

  it('12 · unilateral registra os dois lados e a sexta longa oferece tirar o abdominal', () => {
    const d = base();
    const E = ses('E');
    const steps = sessionSteps(E, sessionFor('E'), d.settings.training);
    const lat = steps.filter((x) => x.exerciseId === 'elevacao_lateral_polia' && x.tipo === 'trabalho');
    expect(lat.map((x) => `${x.posicao}${x.lado}`)).toEqual(['1D', '1E', '2D', '2E']);
    expect(estimateSession(E, d.settings.training)).toBeGreaterThan(60);
    expect(dropCandidate(E, undefined)?.exerciseId).toBe('abdominal_polia_corda');
    for (const k of ['A', 'B', 'C', 'D']) expect(estimateSession(ses(k), d.settings.training)).toBeLessThanOrEqual(60);
  });

  it('14 · esforço desconhecido não dispara aumento', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [work(ex, 'o', '2026-11-16', 1, 40, 9, null), work(ex, 'o', '2026-11-16', 2, 40, 9, 2), work(ex, 'o', '2026-11-16', 3, 40, 9, 2)]);
    d.equipment = { puxada_alta: eq('puxada_alta', { proximo: { '40': 42.5 } }) };
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('manter');
    expect(p.cargas[0]).toBe(40);
  });

  it('15 · aquecimento e aproximação não entram na progressão; posições comparadas por função', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [
      { ...work(ex, 'o', '2026-11-16', 1, 20, 8, null), tipo: 'aquecimento' },
      { ...work(ex, 'o', '2026-11-16', 1, 30, 4, null), tipo: 'aproximacao' },
      work(ex, 'o', '2026-11-16', 1, 45, 8, 1),
      work(ex, 'o', '2026-11-16', 2, 40, 9, 1),
      work(ex, 'o', '2026-11-16', 3, 35, 9, 1),
    ]);
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('posicao');
    expect(p.cargas).toEqual([45, 40, 35]);
  });
});

describe('detalhes da progressão', () => {
  it('só a última série caiu com descanso curto: oferece mais descanso e mantém a carga', () => {
    const ex = remada.exerciseId;
    const d = withSets(base(), [
      work(ex, 'o', '2026-11-16', 1, 40, 10, 2, { descansoPlanejadoSeg: 120, intervaloSeg: 0 }),
      work(ex, 'o', '2026-11-16', 2, 40, 10, 2, { descansoPlanejadoSeg: 120, intervaloSeg: 120 }),
      work(ex, 'o', '2026-11-16', 3, 40, 7, 1, { descansoPlanejadoSeg: 120, intervaloSeg: 50 }),
    ]);
    const p = suggestNext(ex, undefined, ctxFor(d, remada));
    expect(p.descansoExtraSeg).toBe(30);
    expect(p.cargas[0]).toBe(40);
  });

  it('1ª série abaixo do mínimo no limite: sugere reduzir para um peso conhecido', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [work(ex, 'o', '2026-11-16', 1, 40, 5, 0), work(ex, 'o', '2026-11-16', 2, 40, 5, 0), work(ex, 'o', '2026-11-16', 3, 40, 4, 0)]);
    d.equipment = { puxada_alta: eq('puxada_alta', { conhecidos: [30, 35, 40] }) };
    const p = suggestNext(ex, undefined, ctxFor(d));
    expect(p.acao).toBe('reduzir');
    expect(p.cargas[0]).toBe(35);
  });

  it('pausa longa pede recalibração', () => {
    const ex = puxada.exerciseId;
    const d = withSets(base(), [1, 2, 3].map((p) => work(ex, 'o', '2026-10-01', p, 40, 8, 2)));
    expect(suggestNext(ex, undefined, ctxFor(d)).acao).toBe('recalibrar');
  });

  it('pergunta do catálogo: crucifixo precisa ser respondido antes', () => {
    const d = base();
    expect(sessionSteps(ses('E'), sessionFor('E'), d.settings.training).some((x) => x.exerciseId === 'crucifixo_maquina')).toBe(true); // já configurado
    d.settings.training.respostas = {};
    const st = sessionSteps(ses('E'), sessionFor('E'), d.settings.training);
    expect(st.some((x) => x.exerciseId === 'crucifixo')).toBe(true);
    d.settings.training.respostas = { q_crucifixo: ['crucifixo_maquina'] };
    const st2 = sessionSteps(ses('E'), sessionFor('E'), d.settings.training);
    expect(st2.some((x) => x.exerciseId === 'crucifixo_maquina')).toBe(true);
  });
});
