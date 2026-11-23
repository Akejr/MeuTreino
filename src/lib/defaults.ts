import type { AppData, Limits, Profile, TrainingSettings } from '../types';

/** Sobe quando os dados pré-configurados mudam (aplicados uma vez em aparelhos antigos). */
export const SEED_VERSION = 1;

export const DEFAULT_PROFILE: Profile = {
  nome: 'Evandro Casanova',
  sexo: 'Masculino',
  idade: '27',
  peso: '87',
  altura: '180',
  objetivo: 'Reduzir gordura e ganhar ou preservar músculo',
  nivel: 'Treina há 2 anos',
  observacoes: '',
};

/** Proteína é meta; calorias, carboidratos e gordura são limites máximos. */
export const DEFAULT_LIMITS: Limits = { calorias: 2000, proteina: 160, gordura: 60, carboidratos: 218 };

/** Respostas do catálogo já confirmadas na academia. */
export const DEFAULT_RESPOSTAS: Record<string, string[]> = {
  q_crucifixo: ['crucifixo_maquina'],
  q_panturrilha: ['panturrilha_maquina_em_pe'],
  q_graviton: ['barra_assistida'],
  q_triceps_maquina: ['mergulho_sentado_maquina'],
  q_crossover: ['crossover_alto_baixo', 'crossover_baixo_alto'],
};

export function defaultTraining(): TrainingSettings {
  return {
    duracaoMin: 60,
    limitePct: 10,
    // dom, seg, ter, qua, qui, sex, sáb
    dias: ['disponivel', 'treino', 'treino', 'treino', 'treino', 'treino', 'disponivel'],
    respostas: { ...DEFAULT_RESPOSTAS },
    naoGosto: [],
    aceitos: [],
  };
}

export function defaultData(): AppData {
  return {
    version: 2,
    updatedAt: 0,
    settings: {
      _u: 1,
      seed: SEED_VERSION,
      limits: { ...DEFAULT_LIMITS },
      profile: { ...DEFAULT_PROFILE },
      training: defaultTraining(),
    },
    local: { accessCode: '' },
    meals: {},
    foods: {},
    equipment: {},
    plans: {},
    sessions: {},
    sets: {},
    dietDraft: null,
    aiChats: {},
    tips: {},
    sync: { dirty: {}, deleted: {}, cursors: {} },
  };
}
