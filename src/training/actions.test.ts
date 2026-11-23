import { beforeEach, describe, expect, it } from 'vitest';
import { getData, setDataRaw } from '../lib/storage';
import { defaultData } from '../lib/defaults';
import { todayISO } from '../lib/utils';
import { answerQuestion, confirmStep, discardSession, ensureTraining, finishSession, pauseSession, saveEquipment, startSession } from './actions';
import { currentStep } from './engine';
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
