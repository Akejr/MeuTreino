/** Metadado de sincronização: momento (ms, relógio do aparelho) da última alteração local. */
export interface Synced {
  _u?: number;
}

export interface Macros {
  calorias: number;
  proteina: number;
  gordura: number;
  carboidratos: number;
}

/** calorias, gordura e carboidratos são limites máximos; proteína é a meta ideal. */
export type Limits = Macros;

export interface Profile {
  nome: string;
  sexo: string;
  idade: string;
  peso: string;
  altura: string;
  objetivo: string;
  nivel: string;
  observacoes: string;
}

export type DiaTipo = 'treino' | 'disponivel' | 'indisponivel';

export interface TrainingSettings {
  /** Duração alvo da sessão, em minutos. */
  duracaoMin: number;
  /** Maior aumento de carga sugerido automaticamente, em %. Cada vaga pode ter o seu. */
  limitePct: number;
  /** Índice 0 = domingo … 6 = sábado. */
  dias: DiaTipo[];
  /** Respostas das perguntas do catálogo: id da pergunta → ids dos exercícios ativados. */
  respostas: Record<string, string[]>;
  /** Exercícios marcados como "não gosto" (saem de trocas e fichas futuras). */
  naoGosto: string[];
  /** Exercícios opcionais aceitos no catálogo pessoal. */
  aceitos: string[];
}

/** Metas de qualidade da dieta (além de calorias e macros). */
export interface NutriTargets {
  /** Fibras: mínimo por dia (g). */
  fibra: number;
  /** Sódio: máximo por dia (mg). */
  sodio: number;
  /** Açúcar adicionado: máximo por dia (g). */
  acucar: number;
  /** Gordura saturada: máximo por dia (g). */
  saturada: number;
  /** Maior fatia do limite diário de calorias numa só refeição (%). */
  refeicaoMaxPct: number;
}

export interface Settings extends Synced {
  /** Versão dos dados pré-configurados já aplicados. */
  seed?: number;
  limits: Limits;
  nutri: NutriTargets;
  profile: Profile;
  training: TrainingSettings;
}

// ---------- dieta ----------

/** Nutrientes de qualidade. Ausente = desconhecido (registros antigos). */
export interface NutriExtra {
  fibras?: number;
  /** Açúcar adicionado (g): só o colocado no preparo ou pelo fabricante. */
  acucar?: number;
  saturada?: number;
  /** mg */
  sodio?: number;
}

/** Classificação NOVA (Guia Alimentar): 1 in natura, 2 ingrediente culinário, 3 processado, 4 ultraprocessado. */
export type Nova = 1 | 2 | 3 | 4;

export interface FoodItem extends Macros, NutriExtra {
  id: string;
  nome: string;
  quantidade: string;
  /** Alimento cadastrado usado no cálculo. */
  foodId?: string;
  nova?: Nova;
  /** Suplemento (whey, creatina…): fica fora da conta de ultraprocessados. */
  suplemento?: boolean;
}

/** Alimento cadastrado pelo usuário (valores por porção, como no rótulo). */
export interface Food extends Synced, Macros, NutriExtra {
  id: string;
  nome: string;
  /** Como o usuário chama o alimento, separado por vírgula (ex.: "whey, meu whey"). */
  apelidos: string;
  /** Porção do rótulo, por extenso (ex.: "1 scoop (30 g)"). */
  porcao: string;
  porcaoQtd: number;
  porcaoUnidade: 'g' | 'ml' | 'un';
  obs: string;
  criadoEm: number;
}

export interface Meal extends Synced {
  id: string;
  date: string;
  refeicao: string;
  hora: string;
  itens: FoodItem[];
  criadoEm: number;
  /** Sugestões da IA quando a refeição foi calculada. */
  dicas?: string[];
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** Mensagem enviada pelo app (não aparece como balão do usuário). */
  hidden?: boolean;
  /** Assinatura dos dados da tela quando a conversa começou. */
  ctxHash?: string;
}

export interface DietDraft {
  date: string;
  refeicao: string;
  hora: string;
  editingMealId?: string;
  messages: ChatMsg[];
  itens: FoodItem[];
  dicas?: string[];
}

// ---------- hábitos ----------

export interface Habit extends Synced {
  id: string;
  nome: string;
  /** Primeiro dia que conta (YYYY-MM-DD). */
  inicio: string;
  criadoEm: number;
  ordem: number;
  /** Arquivado: deixa de contar a partir deste dia. */
  arquivadoEm?: string;
  /** Períodos arquivados e depois reativados: [de, ate) não contam. */
  pausas?: { de: string; ate: string }[];
}

/** Um dia marcado. id = `${habitId}~${date}`; desmarcar apaga o registro. */
export interface HabitCheck extends Synced {
  id: string;
  habitId: string;
  date: string;
  em: number;
}

// ---------- treino ----------

/** Como o peso é contado no aparelho. */
export type Base = 'total' | 'por_lado' | 'por_halter' | 'assistencia' | 'corporal';
export type Unidade = 'kg' | 'lb';

export interface Equipment extends Synced {
  id: string;
  unidade: Unidade;
  base: Base;
  /** Próximo peso mais difícil disponível a partir de cada posição ("40" → 42.5). -1 = não existe. */
  proximo: Record<string, number>;
  /** Pesos que já se sabe que existem no aparelho. */
  conhecidos: number[];
}

export interface PlanSlot {
  id: string;
  /** Id do catálogo. Pode ser um exercício "base" que exige pergunta no primeiro uso. */
  exerciseId: string;
  series: number;
  repMin: number;
  repMax: number;
  rirMin: number;
  rirMax: number;
  descansoSeg: number;
  /** 1 = principal, 2 = secundário, 3 = acessório. */
  prioridade: 1 | 2 | 3;
  dica: string;
  /** Primeiro candidato a sair se a sessão passar do tempo. */
  sairPrimeiro?: boolean;
  /** Limite de aumento automático desta vaga (%). Sem valor = usa o geral. */
  limitePct?: number;
}

export interface PlanSession {
  key: string;
  /** 1 = segunda … 7 = domingo. */
  dia: number;
  titulo: string;
  slots: PlanSlot[];
}

export interface PlanVersion extends Synced {
  id: string;
  nome: string;
  versao: number;
  criadoEm: number;
  vigenciaInicio: string;
  vigenciaFim?: string;
  status: 'ativa' | 'arquivada' | 'proposta';
  origem: 'inicial' | 'ia' | 'manual';
  resumo?: string;
  sessoes: PlanSession[];
}

export type MotivoTroca = 'hoje_nao' | 'ocupado' | 'nao_gosto';

export interface Troca {
  de: string;
  para: string;
  motivo: MotivoTroca;
  /** Posição de trabalho a partir da qual a nova variação vale. */
  posicao: number;
  exibidas: string[];
  em: number;
}

export interface SlotState {
  /** Alternativas já exibidas nesta vaga e sessão (cada uma aparece uma vez). */
  exibidas: string[];
  /** Alternativa sendo exibida agora. */
  oferta?: string;
  trocas: Troca[];
  status: 'ativo' | 'pulado' | 'dor' | 'removido';
  aquecExtra?: number;
  /** Resposta à checagem de dor antes do exercício (quando houve dor na última vez). */
  dorCheck?: 'ok' | 'dor';
}

export type SessionStatus = 'pendente' | 'em_andamento' | 'parcial' | 'concluida' | 'falta';

export interface MudancaData {
  de: string;
  para: string;
  motivo: 'falta' | 'reagendado' | 'retomar';
  em: number;
}

export interface Session extends Synced {
  id: string;
  planId: string;
  key: string;
  titulo: string;
  dataOriginal: string;
  dataAtual: string;
  dataReal?: string;
  status: SessionStatus;
  /** Sessão parcial que será retomada em outra data. */
  retomar?: boolean;
  inicio?: number;
  fim?: number;
  intervalos: { i: number; f?: number }[];
  duracaoSeg?: number;
  slots: Record<string, SlotState>;
  descansoAte?: number;
  descansoSeg?: number;
  historicoDatas: MudancaData[];
  /** Como estavam aparelhos e catálogo ao começar (para 'encerrar e perder progresso'). */
  antes?: { equipment: Record<string, Equipment>; respostas: Record<string, string[]>; naoGosto: string[] };
  /** Só na tela: sessão prevista pela ficha numa semana que ainda não foi criada. */
  virtual?: boolean;
}

export type SetTipo = 'aquecimento' | 'aproximacao' | 'trabalho';

export interface SetLog extends Synced {
  id: string;
  sessionId: string;
  slotId: string;
  exerciseId: string;
  equipId: string;
  tipo: SetTipo;
  posicao: number;
  lado?: 'D' | 'E';
  status: 'feita' | 'pulada';
  metaRepsMin?: number;
  metaRepsMax?: number;
  metaReps?: number | null;
  cargaSugerida: number | null;
  carga: number | null;
  reps: number | null;
  /** Repetições em reserva. null = "não sei" (ou não perguntado no aquecimento). */
  rir: number | null;
  ajuda: boolean;
  dor: boolean;
  dorTipo?: 'leve' | 'aguda' | 'alerta';
  unidade: Unidade;
  base: Base;
  descansoPlanejadoSeg?: number;
  /** Segundos de descanso estimados antes desta série. */
  intervaloSeg?: number;
  data: string;
  confirmadoEm: number;
}

// ---------- IA / app ----------

export interface Tips {
  assinatura: string;
  geradoEm: number;
  bom: string[];
  melhorar: string[];
  proximos: string[];
}

export interface SyncMeta {
  userId?: string;
  /** coleção → id → _u no momento em que ficou pendente. */
  dirty: Record<string, Record<string, number>>;
  /** coleção → id → momento da exclusão. */
  deleted: Record<string, Record<string, number>>;
  cursors: Record<string, string>;
  lastSyncAt?: number;
  lastError?: string;
}

export interface AppData {
  version: 2;
  updatedAt: number;
  settings: Settings;
  /** Só neste aparelho: nunca sincroniza. */
  local: { accessCode: string };
  meals: Record<string, Meal>;
  foods: Record<string, Food>;
  equipment: Record<string, Equipment>;
  plans: Record<string, PlanVersion>;
  sessions: Record<string, Session>;
  sets: Record<string, SetLog>;
  habits: Record<string, Habit>;
  habitChecks: Record<string, HabitCheck>;
  dietDraft: DietDraft | null;
  aiChats: Record<string, ChatMsg[]>;
  tips: Record<string, Tips>;
  sync: SyncMeta;
  lastExportAt?: number;
  /** Dados da versão 1 (treinos gerados por IA), guardados sem uso. */
  legacy?: Record<string, unknown>;
}

export const SYNC_COLLECTIONS = ['meals', 'foods', 'equipment', 'plans', 'sessions', 'sets', 'habits', 'habitChecks'] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];
