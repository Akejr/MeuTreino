import { beforeEach, describe, expect, it } from 'vitest';
import { getData, setDataRaw } from '../lib/storage';
import { defaultData } from '../lib/defaults';
import { todayISO } from '../lib/utils';
import {
  addExtraSlot,
  answerQuestion,
  confirmStep,
  currentStepsFor,
  discardSession,
  ensureTraining,
  finishSession,
  pauseSession,
  removeExtraSlot,
  saveEquipment,
  startSession,
} from './actions';
import { currentStep, extraCandidates } from './engine';
import { getEx } from './catalog';
import { isPaused, planSessionOf } from './schedule';

const sessaoDeHoje = () => Object.values(getData().sessions).find((s) => s.dataAtual >= todayISO() && s.status !== 'falta')!;

function registrarPrimeiraSerie(id: string, carga: number) {
  const d = getData();
  const s = d.sessions[id];
  const step = currentStep(planSessionOf(d, s)!, s, d)!;
  confirmStep(id, step, { carga, reps: 8, rir: null, ajuda: false, dor: false, cargaSugerida: null, metaReps: 8 });
}

describe('encerrar treino', () => {
  beforeEach(() => {
    setDataRaw(() => ({ ...defaultData(), settings: { ...defaultData().settings, training: { ...defaultData().settings.training, respostas: {} } } }));
    ensureTraining();
  });

  it('encerrar e perder progresso: tudo volta como estava antes', () => {
    const s = sessaoDeHoje();
    const antes = getData().sessions[s.id];
    startSession(s.id);
    answerQuestion('q_crucifixo', ['crucifixo_maquina']); // variação respondida durante o treino
    const ex = currentStep(planSessionOf(getData(), getData().sessions[s.id])!, getData().sessions[s.id], getData())!.exerciseId;
    expect(ex).toBeTruthy();
    saveEquipment('puxada_alta', 'kg', 'total'); // aparelho cadastrado durante o treino
    registrarPrimeiraSerie(s.id, 20);
    expect(Object.values(getData().sets).filter((x) => x.sessionId === s.id)).toHaveLength(1);

    discardSession(s.id);
    const d = getData();
    const depois = d.sessions[s.id];
    expect(Object.values(d.sets).filter((x) => x.sessionId === s.id)).toHaveLength(0);
    expect(depois.status).toBe('pendente');
    expect(depois.inicio).toBeUndefined();
    expect(depois.dataReal).toBeUndefined();
    expect(depois.intervalos).toEqual([]);
    expect(depois.dataAtual).toBe(antes.dataAtual);
    expect(d.equipment.puxada_alta).toBeUndefined();
    expect(d.settings.training.respostas.q_crucifixo).toBeUndefined();
    // a exclusão das séries vai para o servidor
    expect(Object.keys(d.sync.deleted.sets ?? {})).toHaveLength(1);
  });

  it('encerrar treino incompleto conta como treino feito e mantém as séries', () => {
    const s = sessaoDeHoje();
    startSession(s.id);
    saveEquipment('puxada_alta', 'kg', 'total');
    registrarPrimeiraSerie(s.id, 20);
    finishSession(s.id);
    const d = getData();
    expect(d.sessions[s.id].status).toBe('concluida');
    expect(d.sessions[s.id].antes).toBeUndefined();
    expect(Object.values(d.sets).filter((x) => x.sessionId === s.id)).toHaveLength(1);
  });

  it('exercício extra: só nesta sessão, ligado aos músculos do treino, e sai ao perder o progresso', () => {
    const s = sessaoDeHoje();
    startSession(s.id);
    const d0 = getData();
    const ps = planSessionOf(d0, d0.sessions[s.id])!;
    const cands = extraCandidates(ps, d0.sessions[s.id], d0.settings.training);
    expect(cands.length).toBeGreaterThan(0);
    const grupos = new Set(ps.slots.flatMap((x) => [getEx(x.exerciseId).grupo, ...getEx(x.exerciseId).secundarios]));
    for (const id of cands) expect(grupos.has(getEx(id).grupo)).toBe(true);
    for (const x of ps.slots) expect(cands).not.toContain(x.exerciseId);
    const planoAntes = JSON.stringify(d0.plans);

    addExtraSlot(s.id, cands[0]);
    addExtraSlot(s.id, 'nao_existe');
    let d = getData();
    expect(d.sessions[s.id].extras?.map((x) => x.exerciseId)).toEqual([cands[0]]);
    const slotsAgora = planSessionOf(d, d.sessions[s.id])!.slots;
    expect(slotsAgora[slotsAgora.length - 1].exerciseId).toBe(cands[0]);
    expect(JSON.stringify(d.plans)).toBe(planoAntes);
    expect(Object.values(d.sessions).filter((x) => x.id !== s.id && x.extras?.length)).toHaveLength(0);

    removeExtraSlot(s.id, d.sessions[s.id].extras![0].id);
    expect(getData().sessions[s.id].extras).toBeUndefined();
    addExtraSlot(s.id, cands[0]);
    discardSession(s.id);
    d = getData();
    expect(d.sessions[s.id].extras).toBeUndefined();
  });

  it('peso diferente da série anterior fica marcado como ajuste; reserva aproximada é guardada', () => {
    const s = sessaoDeHoje();
    startSession(s.id);
    const work = currentStepsFor(s.id).filter((x) => x.tipo === 'trabalho');
    const [w1, w2] = work.filter((x) => x.exerciseId === work[0].exerciseId && x.lado === work[0].lado);
    const base = { reps: 8, ajuda: false, dor: false, metaReps: 8 };
    confirmStep(s.id, w1, { ...base, carga: 50, rir: 3, cargaSugerida: null });
    confirmStep(s.id, w2, { ...base, carga: 55, rir: 8, rirAprox: true, cargaSugerida: 50 });
    const sets = getData().sets;
    expect(sets[w1.id].ajuste).toBeUndefined();
    expect(sets[w2.id].ajuste).toBe('calibracao');
    expect(sets[w2.id].rirAprox).toBe(true);
    expect(sets[w2.id].rir).toBe(8);
  });

  it('encerrar e continuar depois pausa no mesmo ponto', () => {
    const s = sessaoDeHoje();
    startSession(s.id);
    saveEquipment('puxada_alta', 'kg', 'total');
    registrarPrimeiraSerie(s.id, 20);
    pauseSession(s.id);
    let x = getData().sessions[s.id];
    expect(x.status).toBe('em_andamento');
    expect(isPaused(x)).toBe(true);
    startSession(s.id);
    x = getData().sessions[s.id];
    expect(isPaused(x)).toBe(false);
    expect(x.intervalos).toHaveLength(2);
    const step = currentStep(planSessionOf(getData(), x)!, x, getData())!;
    expect(step.tipo).toBe('aproximacao');
  });
});
