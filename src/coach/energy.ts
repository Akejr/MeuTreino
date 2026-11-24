/**
 * Estimativas de corpo e gasto de energia (tudo no aparelho, sem IA).
 * - Metabolismo basal: Mifflin-St Jeor. Gordura: Deurenberg pelo IMC. FC máxima: Tanaka.
 * - Cardio, em ordem de precisão: equações do ACSM (velocidade e inclinação; potência da bike),
 *   frequência cardíaca (Keytel 2005), e por fim a tabela de METs do Compêndio por intensidade.
 * - 1 MET ≈ 1 kcal por kg por hora. O gasto "líquido" desconta o repouso (MET − 1), para somar ao gasto do dia.
 */
import type { Cardio, CardioTipo, Intensidade, Profile } from '../types';

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export interface Body {
  peso: number;
  altura: number;
  idade: number;
  masculino: boolean;
  imc: number;
  /** Metabolismo basal (kcal/dia). */
  tmb: number;
  gorduraPct: number;
  massaMagra: number;
  fcMax: number;
}

export function bodyOf(p: Profile): Body | null {
  const peso = num(p.peso);
  if (!(peso > 30)) return null;
  const altura = num(p.altura) > 100 ? num(p.altura) : 175;
  const idade = num(p.idade) > 10 ? num(p.idade) : 30;
  const masculino = !/fem|mulher/i.test(p.sexo);
  const tmb = 10 * peso + 6.25 * altura - 5 * idade + (masculino ? 5 : -161);
  const imc = peso / (altura / 100) ** 2;
  const gorduraPct = Math.min(50, Math.max(5, 1.2 * imc + 0.23 * idade - 10.8 * (masculino ? 1 : 0) - 5.4));
  return { peso, altura, idade, masculino, imc, tmb, gorduraPct, massaMagra: peso * (1 - gorduraPct / 100), fcMax: 208 - 0.7 * idade };
}

/** Corpo padrão só para estimar quando o perfil está sem peso. */
const PADRAO: Body = { peso: 75, altura: 175, idade: 30, masculino: true, imc: 24.5, tmb: 1700, gorduraPct: 20, massaMagra: 60, fcMax: 187 };

export interface CardioDef {
  id: CardioTipo;
  label: string;
  /** METs (Compêndio) para leve, moderada e intensa. */
  met: [number, number, number];
  /** Exige muito das pernas (pesa no treino de pernas). */
  pernas: boolean;
  /** Impacto e contração excêntrica (corrida, saltos): mais interferência e dor muscular. */
  impacto: boolean;
  campos: ('distancia' | 'inclinacao' | 'watts')[];
}

export const CARDIO: CardioDef[] = [
  { id: 'caminhada', label: 'Caminhada / esteira', met: [3.0, 4.0, 5.0], pernas: false, impacto: false, campos: ['distancia', 'inclinacao'] },
  { id: 'esteira_inclinada', label: 'Esteira inclinada', met: [5.3, 6.5, 8.0], pernas: true, impacto: false, campos: ['distancia', 'inclinacao'] },
  { id: 'corrida', label: 'Corrida', met: [7.0, 9.8, 11.5], pernas: true, impacto: true, campos: ['distancia', 'inclinacao'] },
  { id: 'bike', label: 'Bicicleta', met: [4.8, 6.8, 8.8], pernas: true, impacto: false, campos: ['distancia', 'watts'] },
  { id: 'eliptico', label: 'Elíptico', met: [4.0, 5.0, 7.5], pernas: false, impacto: false, campos: [] },
  { id: 'escada', label: 'Escada', met: [5.0, 7.0, 9.0], pernas: true, impacto: false, campos: [] },
  { id: 'remo', label: 'Remo', met: [4.8, 7.0, 8.5], pernas: false, impacto: false, campos: ['distancia', 'watts'] },
  { id: 'natacao', label: 'Natação', met: [5.8, 8.3, 9.8], pernas: false, impacto: false, campos: ['distancia'] },
  { id: 'hiit', label: 'HIIT / tiros', met: [6.0, 8.0, 10.0], pernas: true, impacto: true, campos: [] },
  { id: 'outro', label: 'Outro', met: [3.5, 5.0, 7.0], pernas: false, impacto: false, campos: [] },
];

export const CARDIO_BY_ID = Object.fromEntries(CARDIO.map((c) => [c.id, c])) as Record<CardioTipo, CardioDef>;
export const cardioDef = (t: CardioTipo) => CARDIO_BY_ID[t] ?? CARDIO_BY_ID.outro;

export const INTENSIDADE: { v: Intensidade; label: string; desc: string }[] = [
  { v: 'leve', label: 'Leve', desc: 'Conversa sem esforço' },
  { v: 'moderada', label: 'Moderada', desc: 'Fala frases curtas' },
  { v: 'intensa', label: 'Intensa', desc: 'Quase não consegue falar' },
];

export type Metodo = 'acsm_caminhada' | 'acsm_corrida' | 'acsm_bike' | 'fc' | 'tabela';
export const METODO_LABEL: Record<Metodo, string> = {
  acsm_caminhada: 'velocidade e inclinação (equação de caminhada do ACSM)',
  acsm_corrida: 'velocidade e inclinação (equação de corrida do ACSM)',
  acsm_bike: 'potência (equação de bicicleta do ACSM)',
  fc: 'frequência cardíaca (Keytel 2005)',
  tabela: 'tipo e intensidade (Compêndio de Atividades Físicas)',
};

export interface CardioEst {
  met: number;
  kcal: number;
  /** Acima do repouso: é o que soma ao gasto do dia. */
  kcalLiquida: number;
  metodo: Metodo;
  /** Intensidade relativa: pela FC quando informada, senão a escolhida. */
  intensidade: Intensidade;
  pctFcMax?: number;
  velocidadeKmh?: number;
  /** Minutos para a meta da OMS: vigorosos (≥ 6 METs) contam em dobro; abaixo de 3 METs não contam. */
  minutosOms: number;
}

const idx = (i: Intensidade) => (i === 'leve' ? 0 : i === 'moderada' ? 1 : 2);

export function estimateCardio(c: Cardio, body: Body | null): CardioEst {
  const b = body ?? PADRAO;
  const min = Math.max(0, num(c.minutos));
  const def = cardioDef(c.tipo);
  let met = def.met[idx(c.intensidade)];
  let metodo: Metodo = 'tabela';
  let velocidadeKmh: number | undefined;
  const grade = Math.max(0, Math.min(30, num(c.inclinacao))) / 100;

  const km = num(c.distanciaKm);
  if (km > 0 && min > 0 && ['caminhada', 'esteira_inclinada', 'corrida'].includes(c.tipo)) {
    velocidadeKmh = (km / min) * 60;
    const s = (velocidadeKmh * 1000) / 60; // m/min
    if (velocidadeKmh >= 2.5 && velocidadeKmh <= 25) {
      const correndo = velocidadeKmh > 8 || (c.tipo === 'corrida' && velocidadeKmh >= 6);
      const vo2 = correndo ? 0.2 * s + 0.9 * s * grade + 3.5 : 0.1 * s + 1.8 * s * grade + 3.5;
      met = vo2 / 3.5;
      metodo = correndo ? 'acsm_corrida' : 'acsm_caminhada';
    }
  } else if (num(c.watts) > 0 && c.tipo === 'bike') {
    const vo2 = (1.8 * num(c.watts) * 6.12) / b.peso + 7;
    met = vo2 / 3.5;
    metodo = 'acsm_bike';
  }

  const fc = num(c.fcMedia);
  let pctFcMax: number | undefined;
  let intensidade = c.intensidade;
  if (fc >= 60 && fc <= 220) {
    pctFcMax = (fc / b.fcMax) * 100;
    intensidade = pctFcMax < 64 ? 'leve' : pctFcMax < 77 ? 'moderada' : 'intensa';
    if (metodo === 'tabela' && fc >= 90) {
      const kj = b.masculino ? -55.0969 + 0.6309 * fc + 0.1988 * b.peso + 0.2017 * b.idade : -20.4022 + 0.4472 * fc - 0.1263 * b.peso + 0.074 * b.idade;
      const kcalMin = kj / 4.184;
      if (kcalMin > 0) {
        met = (kcalMin * 60) / b.peso;
        metodo = 'fc';
      }
    }
  }

  met = Math.min(20, Math.max(1.5, met));
  const h = min / 60;
  return {
    met,
    kcal: met * b.peso * h,
    kcalLiquida: (met - 1) * b.peso * h,
    metodo,
    intensidade,
    pctFcMax,
    velocidadeKmh,
    minutosOms: met >= 6 ? min * 2 : met >= 3 ? min : 0,
  };
}

/** Musculação com várias máquinas, 8 a 15 repetições, descanso incluído: cerca de 3,5 METs (Compêndio). */
export const MET_MUSCULACAO = 3.5;

export function estimateWeights(minutos: number, body: Body | null) {
  const b = body ?? PADRAO;
  const h = Math.max(0, minutos) / 60;
  return { kcal: MET_MUSCULACAO * b.peso * h, kcalLiquida: (MET_MUSCULACAO - 1) * b.peso * h };
}

/** Vida diária sem exercício (trabalho sentado, deslocamentos, digestão): metabolismo basal × 1,3. */
export const FATOR_DIA = 1.3;
