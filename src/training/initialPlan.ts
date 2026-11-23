import type { PlanSession, PlanSlot, PlanVersion } from '../types';

export const INITIAL_PLAN_ID = 'ficha-inicial';

type S = Omit<PlanSlot, 'id' | 'rirMin' | 'rirMax'> & { rirMin?: number; rirMax?: number };

function session(key: string, dia: number, titulo: string, slots: S[]): PlanSession {
  return {
    key,
    dia,
    titulo,
    slots: slots.map((s, i) => ({ rirMin: 1, rirMax: 3, ...s, id: `${key}${i + 1}` })),
  };
}

/** Ficha inicial das páginas 6 e 7 do guia. */
export function initialPlan(vigenciaInicio: string): PlanVersion {
  return {
    id: INITIAL_PLAN_ID,
    nome: 'Ficha inicial A–E',
    versao: 1,
    criadoEm: Date.now(),
    vigenciaInicio,
    status: 'ativa',
    origem: 'inicial',
    resumo: 'Cinco sessões por semana, cerca de uma hora cada. Reduzir gordura e ganhar ou preservar músculo, com prioridade para costas.',
    _u: 1,
    sessoes: [
      session('A', 1, 'Costas e bíceps', [
        { exerciseId: 'puxada_neutra_aberta', series: 3, repMin: 7, repMax: 9, descansoSeg: 150, prioridade: 1, dica: 'Peito alto. Puxe os cotovelos para baixo e para trás e suba controlando.' },
        { exerciseId: 'remada_apoio_peito', series: 3, repMin: 8, repMax: 12, descansoSeg: 120, prioridade: 2, dica: 'Peito apoiado o tempo todo. Puxe com os cotovelos e segure 1 s atrás.' },
        { exerciseId: 'crucifixo_inverso', series: 2, repMin: 12, repMax: 15, descansoSeg: 90, prioridade: 3, dica: 'Braços quase estendidos. Abra até a linha dos ombros, sem balançar.' },
        { exerciseId: 'rosca_scott_maquina', series: 3, repMin: 8, repMax: 12, descansoSeg: 90, prioridade: 3, dica: 'Braço todo no apoio. Desça até quase estender, sem soltar o peso.' },
        { exerciseId: 'rosca_martelo_corda', series: 2, repMin: 10, repMax: 15, descansoSeg: 75, prioridade: 3, dica: 'Cotovelos colados ao corpo, palmas viradas uma para a outra.' },
      ]),
      session('B', 2, 'Pernas com prioridade para quadríceps', [
        { exerciseId: 'hack', series: 3, repMin: 7, repMax: 9, descansoSeg: 150, prioridade: 1, dica: 'Desça com controle até onde a lombar fica apoiada. Suba sem travar os joelhos.' },
        { exerciseId: 'cadeira_flexora', series: 3, repMin: 8, repMax: 12, descansoSeg: 90, prioridade: 2, dica: 'Quadril firme no banco. Flexione até o fim e volte devagar.' },
        { exerciseId: 'cadeira_extensora', series: 3, repMin: 10, repMax: 15, descansoSeg: 90, prioridade: 2, dica: 'Estenda até o fim, segure 1 s em cima e desça controlando.' },
        { exerciseId: 'panturrilha_leg_press', series: 3, repMin: 10, repMax: 15, descansoSeg: 75, prioridade: 3, dica: 'Alongue bem embaixo e suba até a ponta dos pés.' },
        { exerciseId: 'abdominal_maquina', series: 2, repMin: 10, repMax: 15, descansoSeg: 60, prioridade: 3, dica: 'Enrole o tronco e solte o ar ao fechar, sem puxar com os braços.' },
      ]),
      session('C', 3, 'Peito, ombros e tríceps', [
        { exerciseId: 'supino_inclinado_maquina', series: 3, repMin: 7, repMax: 9, descansoSeg: 150, prioridade: 1, dica: 'Escápulas encaixadas no banco. Desça até o peito alongar, sem perder o apoio.' },
        { exerciseId: 'supino_reto_maquina', series: 3, repMin: 8, repMax: 12, descansoSeg: 120, prioridade: 2, dica: 'Pegada na linha do peito. Empurre sem tirar os ombros do encosto.' },
        { exerciseId: 'desenvolvimento_maquina', series: 2, repMin: 8, repMax: 12, descansoSeg: 120, prioridade: 2, dica: 'Costas no encosto. Desça até a linha das orelhas.' },
        { exerciseId: 'elevacao_lateral_halteres', series: 3, repMin: 10, repMax: 15, descansoSeg: 75, prioridade: 3, dica: 'Suba até a linha dos ombros, cotovelos levemente dobrados, sem impulso.' },
        { exerciseId: 'triceps_frances_polia', series: 3, repMin: 10, repMax: 15, descansoSeg: 75, prioridade: 3, dica: 'Cotovelos apontando para a frente e parados. Estenda por completo.' },
      ]),
      session('D', 4, 'Posteriores e glúteos', [
        { exerciseId: 'mesa_flexora', series: 3, repMin: 8, repMax: 12, descansoSeg: 90, prioridade: 1, dica: 'Quadril colado no banco. Flexione até o fim e desça devagar.' },
        { exerciseId: 'leg_press_45', series: 3, repMin: 8, repMax: 12, descansoSeg: 120, prioridade: 1, dica: 'Pés na largura do quadril. Desça até onde a lombar não sai do encosto.' },
        { exerciseId: 'extensao_quadril_unilateral', series: 2, repMin: 10, repMax: 15, descansoSeg: 60, prioridade: 2, dica: 'Contraia o glúteo no fim do movimento, sem arquear a lombar.' },
        { exerciseId: 'cadeira_abdutora', series: 2, repMin: 12, repMax: 20, descansoSeg: 60, prioridade: 3, dica: 'Abra com controle, segure 1 s e volte devagar.' },
        { exerciseId: 'panturrilha_maquina', series: 3, repMin: 10, repMax: 15, descansoSeg: 75, prioridade: 3, dica: 'Alongue bem embaixo e suba até a ponta dos pés.' },
      ]),
      session('E', 5, 'Costas, peito e complementos', [
        { exerciseId: 'remada_polia_barra', series: 3, repMin: 7, repMax: 9, descansoSeg: 150, prioridade: 1, dica: 'Tronco firme. Puxe a barra até a barriga, cotovelos para trás.' },
        { exerciseId: 'puxada_articulada', series: 3, repMin: 8, repMax: 12, descansoSeg: 120, prioridade: 2, dica: 'Puxe com os cotovelos e controle a volta.' },
        { exerciseId: 'crucifixo', series: 3, repMin: 10, repMax: 15, descansoSeg: 90, prioridade: 2, dica: 'Cotovelos levemente dobrados. Feche à frente do peito sem bater os braços.' },
        { exerciseId: 'elevacao_lateral_polia', series: 2, repMin: 10, repMax: 15, descansoSeg: 60, prioridade: 3, dica: 'Cabo passando atrás do corpo. Suba até a linha do ombro.' },
        { exerciseId: 'triceps_unilateral_polia', series: 2, repMin: 10, repMax: 15, descansoSeg: 60, prioridade: 3, dica: 'Cotovelo parado ao lado do corpo. Estenda por completo.' },
        { exerciseId: 'abdominal_polia_corda', series: 2, repMin: 10, repMax: 15, descansoSeg: 60, prioridade: 3, dica: 'Ajoelhado, enrole o tronco levando os cotovelos aos joelhos.', sairPrimeiro: true },
      ]),
    ],
  };
}
