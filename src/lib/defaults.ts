import type { AppData, Limits, NutriTargets, Profile, TrainingSettings } from '../types';

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

/**
 * Qualidade da dieta. Fibras: cerca de 14 g por 1.000 kcal, arredondado para 30 g.
 * Sódio < 2.000 mg e açúcar adicionado < 5% das calorias (OMS). Saturada < 10% das calorias.
 */
export const DEFAULT_NUTRI: NutriTargets = { fibra: 30, sodio: 2000, acucar: 25, saturada: 22, refeicaoMaxPct: 40 };

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
      nutri: { ...DEFAULT_NUTRI },
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
    habits: {},
    habitChecks: {},
    cardio: {},
    dietDraft: null,
    aiChats: {},
    tips: {},
    sync: { dirty: {}, deleted: {}, cursors: {} },
  };
}
