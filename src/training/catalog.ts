import type { Base, TrainingSettings } from '../types';

export type Grupo =
  | 'costas'
  | 'peito'
  | 'ombro_anterior'
  | 'ombro_lateral'
  | 'ombro_posterior'
  | 'trapezio'
  | 'biceps'
  | 'triceps'
  | 'quadriceps'
  | 'posteriores'
  | 'gluteos'
  | 'abdutores'
  | 'adutores'
  | 'panturrilha'
  | 'abdomen';

export const GRUPO_LABEL: Record<Grupo, string> = {
  costas: 'Costas',
  peito: 'Peito',
  ombro_anterior: 'Ombro anterior',
  ombro_lateral: 'Ombro lateral',
  ombro_posterior: 'Ombro posterior',
  trapezio: 'Trapézio',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  quadriceps: 'Quadríceps',
  posteriores: 'Posteriores',
  gluteos: 'Glúteos',
  abdutores: 'Abdutores',
  adutores: 'Adutores',
  panturrilha: 'Panturrilha',
  abdomen: 'Abdômen',
};

export interface ExerciseDef {
  id: string;
  nome: string;
  grupo: Grupo;
  secundarios: Grupo[];
  /** Padrão de movimento: trocas só entre o mesmo grupo e padrão. */
  padrao: string;
  composto: boolean;
  unilateral?: boolean;
  /** Assistido: menos carga = mais difícil. */
  assistido?: boolean;
  /** Chave do aparelho. Exercícios que dividem aparelho (halteres, Graviton) usam a mesma. */
  equip: string;
  baseSugerida: Base;
  dica?: string;
  /** Só entra no catálogo pessoal depois de aceito. */
  opcional?: boolean;
  /** Exercício "base" ambíguo: resolvido por uma pergunta no primeiro uso. */
  pergunta?: string;
  /** Variação que depende da resposta a uma pergunta. */
  dependeDe?: string;
  /** Observação de elegibilidade mostrada na troca. */
  obs?: string;
}

export interface CatalogQuestion {
  id: string;
  pergunta: string;
  multipla?: boolean;
  opcoes: { label: string; ativa: string[] }[];
}

export const QUESTIONS: CatalogQuestion[] = [
  {
    id: 'q_crucifixo',
    pergunta: 'O crucifixo para peito é na máquina, na polia ou com halteres?',
    opcoes: [
      { label: 'Máquina (peck deck)', ativa: ['crucifixo_maquina'] },
      { label: 'Polia', ativa: ['crucifixo_polia'] },
      { label: 'Halteres', ativa: ['crucifixo_halteres'] },
    ],
  },
  {
    id: 'q_panturrilha',
    pergunta: 'A panturrilha na máquina é sentada ou em pé?',
    opcoes: [
      { label: 'Sentada', ativa: ['panturrilha_maquina_sentada'] },
      { label: 'Em pé', ativa: ['panturrilha_maquina_em_pe'] },
    ],
  },
  {
    id: 'q_graviton',
    pergunta: 'Você usa o Graviton para barra fixa assistida ou para paralelas assistidas?',
    multipla: true,
    opcoes: [
      { label: 'Barra fixa assistida', ativa: ['barra_assistida'] },
      { label: 'Paralelas assistidas', ativa: ['paralelas_assistidas'] },
      { label: 'As duas', ativa: ['barra_assistida', 'paralelas_assistidas'] },
      { label: 'Não uso', ativa: [] },
    ],
  },
  {
    id: 'q_triceps_maquina',
    pergunta: 'Na máquina sentada de tríceps você empurra para baixo com as mãos ao lado do corpo (mergulho) ou estende os cotovelos (extensora)?',
    opcoes: [
      { label: 'Mergulho sentado', ativa: ['mergulho_sentado_maquina'] },
      { label: 'Extensora de tríceps', ativa: ['extensora_triceps_maquina'] },
    ],
  },
  {
    id: 'q_crossover',
    pergunta: 'No crossover você fecha os braços à frente do corpo?',
    opcoes: [
      { label: 'Sim', ativa: ['crossover_alto_baixo', 'crossover_baixo_alto'] },
      { label: 'Não', ativa: [] },
    ],
  },
];

const ex = (d: ExerciseDef) => d;

export const CATALOG: ExerciseDef[] = [
  // ---------- peito ----------
  ex({ id: 'supino_inclinado_maquina', nome: 'Supino inclinado sentado na máquina', grupo: 'peito', secundarios: ['triceps', 'ombro_anterior'], padrao: 'empurrar_inclinado', composto: true, equip: 'supino_inclinado_maquina', baseSugerida: 'total' }),
  ex({ id: 'supino_reto_maquina', nome: 'Supino reto sentado na máquina', grupo: 'peito', secundarios: ['triceps', 'ombro_anterior'], padrao: 'empurrar_horizontal', composto: true, equip: 'supino_reto_maquina', baseSugerida: 'total' }),
  ex({ id: 'crucifixo', nome: 'Crucifixo para peito', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'crucifixo', baseSugerida: 'total', pergunta: 'q_crucifixo' }),
  ex({ id: 'crucifixo_maquina', nome: 'Crucifixo na máquina (peck deck)', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'peck_deck', baseSugerida: 'total', dependeDe: 'q_crucifixo' }),
  ex({ id: 'crucifixo_polia', nome: 'Crucifixo na polia', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'crucifixo_polia', baseSugerida: 'total', dependeDe: 'q_crucifixo' }),
  ex({ id: 'crucifixo_halteres', nome: 'Crucifixo com halteres', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'halteres', baseSugerida: 'por_halter', dependeDe: 'q_crucifixo' }),
  ex({ id: 'crossover_alto_baixo', nome: 'Crossover na polia de cima para baixo', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'crossover', baseSugerida: 'total', dependeDe: 'q_crossover' }),
  ex({ id: 'crossover_baixo_alto', nome: 'Crossover na polia de baixo para cima', grupo: 'peito', secundarios: [], padrao: 'aducao_horizontal', composto: false, equip: 'crossover', baseSugerida: 'total', dependeDe: 'q_crossover' }),

  // ---------- costas ----------
  ex({ id: 'puxada_neutra_aberta', nome: 'Puxada alta com pegada neutra aberta', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'puxada_vertical', composto: true, equip: 'puxada_alta', baseSugerida: 'total' }),
  ex({ id: 'puxada_w', nome: 'Puxada alta com puxador anatômico em W', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'puxada_vertical', composto: true, equip: 'puxada_alta_w', baseSugerida: 'total' }),
  ex({ id: 'remada_apoio_peito', nome: 'Remada máquina com apoio no peito', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'remada', composto: true, equip: 'remada_apoio_peito', baseSugerida: 'total' }),
  ex({ id: 'puxada_articulada', nome: 'Puxada alta articulada', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'puxada_vertical', composto: true, equip: 'puxada_articulada', baseSugerida: 'por_lado' }),
  ex({ id: 'crucifixo_inverso', nome: 'Crucifixo inverso', grupo: 'ombro_posterior', secundarios: ['costas'], padrao: 'abducao_horizontal', composto: false, equip: 'crucifixo_inverso', baseSugerida: 'total' }),
  ex({ id: 'remada_cavalinho', nome: 'Remada cavalinho em pé sem apoio no peito', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'remada', composto: true, equip: 'remada_cavalinho', baseSugerida: 'por_lado', obs: 'Só se for confortável sem apoio no peito.' }),
  ex({ id: 'remada_polia_barra', nome: 'Remada sentada na polia com barra', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'remada', composto: true, equip: 'remada_polia', baseSugerida: 'total' }),
  ex({ id: 'barra_assistida', nome: 'Barra fixa assistida (Graviton)', grupo: 'costas', secundarios: ['biceps', 'ombro_posterior'], padrao: 'puxada_vertical', composto: true, assistido: true, equip: 'graviton', baseSugerida: 'assistencia', dependeDe: 'q_graviton' }),

  // ---------- ombros e trapézio ----------
  ex({ id: 'elevacao_lateral_halteres', nome: 'Elevação lateral com halteres', grupo: 'ombro_lateral', secundarios: [], padrao: 'elevacao_lateral', composto: false, equip: 'halteres', baseSugerida: 'por_halter' }),
  ex({ id: 'elevacao_lateral_polia', nome: 'Elevação lateral unilateral na polia', grupo: 'ombro_lateral', secundarios: [], padrao: 'elevacao_lateral', composto: false, unilateral: true, equip: 'elevacao_lateral_polia', baseSugerida: 'total' }),
  ex({ id: 'desenvolvimento_maquina', nome: 'Desenvolvimento de ombros na máquina', grupo: 'ombro_anterior', secundarios: ['triceps', 'ombro_lateral'], padrao: 'empurrar_vertical', composto: true, equip: 'desenvolvimento_maquina', baseSugerida: 'total' }),
  ex({ id: 'encolhimento_polia', nome: 'Encolhimento de ombros na polia', grupo: 'trapezio', secundarios: [], padrao: 'encolhimento', composto: false, equip: 'encolhimento_polia', baseSugerida: 'total' }),
  ex({ id: 'elevacao_frontal_polia', nome: 'Elevação frontal na polia', grupo: 'ombro_anterior', secundarios: [], padrao: 'elevacao_frontal', composto: false, equip: 'elevacao_frontal_polia', baseSugerida: 'total', opcional: true, obs: 'Opcional: os supinos e o desenvolvimento já trabalham o ombro anterior.' }),

  // ---------- braços ----------
  ex({ id: 'rosca_martelo_corda', nome: 'Rosca martelo com corda', grupo: 'biceps', secundarios: [], padrao: 'flexao_cotovelo_neutra', composto: false, equip: 'rosca_corda', baseSugerida: 'total' }),
  ex({ id: 'rosca_martelo_halteres', nome: 'Rosca martelo com halteres', grupo: 'biceps', secundarios: [], padrao: 'flexao_cotovelo_neutra', composto: false, equip: 'halteres', baseSugerida: 'por_halter' }),
  ex({ id: 'rosca_scott_maquina', nome: 'Rosca Scott máquina', grupo: 'biceps', secundarios: [], padrao: 'flexao_cotovelo', composto: false, equip: 'rosca_scott', baseSugerida: 'total' }),
  ex({ id: 'rosca_bayesian', nome: 'Rosca Bayesian na polia', grupo: 'biceps', secundarios: [], padrao: 'flexao_cotovelo', composto: false, unilateral: true, equip: 'rosca_bayesian', baseSugerida: 'total' }),
  ex({ id: 'rosca_sentada_halteres', nome: 'Rosca sentada com halteres', grupo: 'biceps', secundarios: [], padrao: 'flexao_cotovelo', composto: false, equip: 'halteres', baseSugerida: 'por_halter' }),
  ex({ id: 'triceps_frances_polia', nome: 'Tríceps francês na polia', grupo: 'triceps', secundarios: [], padrao: 'extensao_cotovelo_acima', composto: false, equip: 'triceps_frances_polia', baseSugerida: 'total' }),
  ex({ id: 'triceps_testa', nome: 'Tríceps testa', grupo: 'triceps', secundarios: [], padrao: 'extensao_cotovelo_acima', composto: false, equip: 'triceps_testa', baseSugerida: 'total' }),
  ex({ id: 'triceps_unilateral_polia', nome: 'Tríceps unilateral na polia', grupo: 'triceps', secundarios: [], padrao: 'extensao_cotovelo', composto: false, unilateral: true, equip: 'triceps_unilateral_polia', baseSugerida: 'total' }),
  ex({ id: 'triceps_maquina_sentada', nome: 'Tríceps na máquina sentada', grupo: 'triceps', secundarios: [], padrao: 'extensao_cotovelo', composto: false, equip: 'triceps_maquina', baseSugerida: 'total', pergunta: 'q_triceps_maquina' }),
  ex({ id: 'mergulho_sentado_maquina', nome: 'Mergulho sentado na máquina', grupo: 'triceps', secundarios: ['peito', 'ombro_anterior'], padrao: 'mergulho', composto: true, equip: 'triceps_maquina', baseSugerida: 'total', dependeDe: 'q_triceps_maquina' }),
  ex({ id: 'extensora_triceps_maquina', nome: 'Extensora de tríceps na máquina', grupo: 'triceps', secundarios: [], padrao: 'extensao_cotovelo', composto: false, equip: 'triceps_maquina', baseSugerida: 'total', dependeDe: 'q_triceps_maquina' }),
  ex({ id: 'paralelas_assistidas', nome: 'Paralelas assistidas (Graviton)', grupo: 'triceps', secundarios: ['peito', 'ombro_anterior'], padrao: 'mergulho', composto: true, assistido: true, equip: 'graviton', baseSugerida: 'assistencia', dependeDe: 'q_graviton' }),

  // ---------- pernas ----------
  ex({ id: 'hack', nome: 'Hack', grupo: 'quadriceps', secundarios: ['gluteos'], padrao: 'dominante_joelho', composto: true, equip: 'hack', baseSugerida: 'por_lado' }),
  ex({ id: 'leg_press_45', nome: 'Leg press 45°', grupo: 'quadriceps', secundarios: ['gluteos'], padrao: 'dominante_joelho', composto: true, equip: 'leg_press_45', baseSugerida: 'por_lado' }),
  ex({ id: 'leg_press_sentado_unilateral', nome: 'Leg press sentado unilateral', grupo: 'quadriceps', secundarios: ['gluteos'], padrao: 'dominante_joelho', composto: true, unilateral: true, equip: 'leg_press_sentado', baseSugerida: 'total' }),
  ex({ id: 'cadeira_flexora', nome: 'Cadeira flexora', grupo: 'posteriores', secundarios: [], padrao: 'flexao_joelho', composto: false, equip: 'cadeira_flexora', baseSugerida: 'total' }),
  ex({ id: 'mesa_flexora', nome: 'Mesa flexora', grupo: 'posteriores', secundarios: [], padrao: 'flexao_joelho', composto: false, equip: 'mesa_flexora', baseSugerida: 'total' }),
  ex({ id: 'cadeira_extensora', nome: 'Cadeira extensora', grupo: 'quadriceps', secundarios: [], padrao: 'extensao_joelho', composto: false, equip: 'cadeira_extensora', baseSugerida: 'total' }),
  ex({ id: 'cadeira_extensora_unilateral', nome: 'Cadeira extensora unilateral', grupo: 'quadriceps', secundarios: [], padrao: 'extensao_joelho', composto: false, unilateral: true, equip: 'cadeira_extensora', baseSugerida: 'total' }),
  ex({ id: 'cadeira_adutora', nome: 'Cadeira adutora', grupo: 'adutores', secundarios: [], padrao: 'aducao_quadril', composto: false, equip: 'cadeira_adutora', baseSugerida: 'total' }),
  ex({ id: 'cadeira_abdutora', nome: 'Cadeira abdutora', grupo: 'abdutores', secundarios: [], padrao: 'abducao_quadril', composto: false, equip: 'cadeira_abdutora', baseSugerida: 'total' }),
  ex({ id: 'panturrilha_maquina', nome: 'Panturrilha na máquina', grupo: 'panturrilha', secundarios: [], padrao: 'panturrilha', composto: false, equip: 'panturrilha_maquina', baseSugerida: 'total', pergunta: 'q_panturrilha' }),
  ex({ id: 'panturrilha_maquina_sentada', nome: 'Panturrilha sentada na máquina', grupo: 'panturrilha', secundarios: [], padrao: 'panturrilha', composto: false, equip: 'panturrilha_maquina_sentada', baseSugerida: 'total', dependeDe: 'q_panturrilha' }),
  ex({ id: 'panturrilha_maquina_em_pe', nome: 'Panturrilha em pé na máquina', grupo: 'panturrilha', secundarios: [], padrao: 'panturrilha', composto: false, equip: 'panturrilha_maquina_em_pe', baseSugerida: 'total', dependeDe: 'q_panturrilha' }),
  ex({ id: 'panturrilha_leg_press', nome: 'Panturrilha no leg press sentado', grupo: 'panturrilha', secundarios: [], padrao: 'panturrilha', composto: false, equip: 'leg_press_sentado', baseSugerida: 'total' }),
  ex({ id: 'extensao_quadril_unilateral', nome: 'Extensão de quadril unilateral na máquina (coice)', grupo: 'gluteos', secundarios: ['posteriores'], padrao: 'extensao_quadril', composto: false, unilateral: true, equip: 'coice_maquina', baseSugerida: 'total' }),

  // ---------- abdômen ----------
  ex({ id: 'abdominal_maquina', nome: 'Abdominal na máquina', grupo: 'abdomen', secundarios: [], padrao: 'flexao_tronco', composto: false, equip: 'abdominal_maquina', baseSugerida: 'total' }),
  ex({ id: 'abdominal_polia_corda', nome: 'Abdominal na polia com corda', grupo: 'abdomen', secundarios: [], padrao: 'flexao_tronco', composto: false, equip: 'abdominal_polia', baseSugerida: 'total' }),
  ex({ id: 'prancha_lateral', nome: 'Prancha lateral', grupo: 'abdomen', secundarios: [], padrao: 'anti_flexao_lateral', composto: false, unilateral: true, equip: 'corporal', baseSugerida: 'corporal', opcional: true }),
  ex({ id: 'pallof_press', nome: 'Pallof press', grupo: 'abdomen', secundarios: [], padrao: 'anti_rotacao', composto: false, unilateral: true, equip: 'pallof_polia', baseSugerida: 'total', opcional: true }),
];

export const BY_ID: Record<string, ExerciseDef> = Object.fromEntries(CATALOG.map((e) => [e.id, e]));
export const QUESTION_BY_ID: Record<string, CatalogQuestion> = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

export function getEx(id: string): ExerciseDef {
  return (
    BY_ID[id] ?? {
      id,
      nome: id.replace(/_/g, ' '),
      grupo: 'abdomen',
      secundarios: [],
      padrao: id,
      composto: false,
      equip: id,
      baseSugerida: 'total',
    }
  );
}

/** Resolve um exercício base pela resposta salva. Retorna undefined se ainda falta responder. */
export function resolveExercise(id: string, t: TrainingSettings): string | undefined {
  const e = BY_ID[id];
  if (!e?.pergunta) return id;
  const ativos = t.respostas[e.pergunta];
  return ativos?.length ? ativos[0] : undefined;
}

/** Exercício disponível para trocas e fichas (respeita perguntas, opcionais e "não gosto"). */
export function isActive(id: string, t: TrainingSettings): boolean {
  const e = BY_ID[id];
  if (!e || e.pergunta) return false;
  if (t.naoGosto.includes(id)) return false;
  if (e.opcional && !t.aceitos.includes(id)) return false;
  if (e.dependeDe) return (t.respostas[e.dependeDe] ?? []).includes(id);
  return true;
}

export const BASE_LABEL: Record<Base, string> = {
  total: 'pilha total',
  por_lado: 'por lado',
  por_halter: 'por halter',
  assistencia: 'de assistência',
  corporal: 'peso corporal',
};

export const BASE_OPCOES: { base: Base; label: string; desc: string }[] = [
  { base: 'total', label: 'Total', desc: 'O número da pilha ou o total da máquina' },
  { base: 'por_lado', label: 'Por lado', desc: 'Anilhas de um lado (o outro é igual)' },
  { base: 'por_halter', label: 'Por halter', desc: 'O peso de cada halter' },
  { base: 'assistencia', label: 'Assistência', desc: 'Peso que te ajuda (menos = mais difícil)' },
  { base: 'corporal', label: 'Peso corporal', desc: 'Sem carga para registrar' },
];
