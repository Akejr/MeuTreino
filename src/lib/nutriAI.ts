/** Converte e valida a resposta da IA de nutrição. */
import type { Food, FoodItem, Nova } from '../types';
import { r1, uid } from './utils';

export interface NutriAIItem {
  nome?: unknown;
  quantidade?: unknown;
  calorias?: unknown;
  proteina?: unknown;
  gordura?: unknown;
  carboidratos?: unknown;
  fibras?: unknown;
  acucar_adicionado?: unknown;
  gordura_saturada?: unknown;
  sodio?: unknown;
  nova?: unknown;
  suplemento?: unknown;
  alimento_id?: unknown;
}
export interface NutriAI {
  resposta?: unknown;
  itens?: unknown;
  dicas?: unknown;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
/** Número ou undefined (dado não informado). */
const opt = (v: unknown, digits = 1): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return digits === 0 ? Math.round(n) : r1(n);
};

export function normalizeNutriItems(raw: unknown, foods: Record<string, Food>): FoodItem[] {
  const list = Array.isArray(raw) ? (raw as NutriAIItem[]) : [];
  return list.slice(0, 40).map((i) => {
    const nova = Number(i.nova);
    const foodId = typeof i.alimento_id === 'string' && foods[i.alimento_id] ? i.alimento_id : undefined;
    return {
      id: uid(),
      nome: String(i.nome ?? 'Item').slice(0, 80),
      quantidade: String(i.quantidade ?? '').slice(0, 60),
      calorias: r1(num(i.calorias)),
      proteina: r1(num(i.proteina)),
      gordura: r1(num(i.gordura)),
      carboidratos: r1(num(i.carboidratos)),
      fibras: opt(i.fibras),
      acucar: opt(i.acucar_adicionado),
      saturada: opt(i.gordura_saturada),
      sodio: opt(i.sodio, 0),
      nova: [1, 2, 3, 4].includes(nova) ? (nova as Nova) : undefined,
      suplemento: i.suplemento === true ? true : undefined,
      foodId,
    };
  });
}

export type Quality = Pick<FoodItem, 'fibras' | 'acucar' | 'saturada' | 'sodio' | 'nova' | 'suplemento'>;

/** Dados de qualidade de um item vindos da IA, coerentes com os macros do item (undefined = não veio). */
export function normalizeQuality(i: NutriAIItem, item: Pick<FoodItem, 'gordura' | 'carboidratos'>): Quality {
  const nova = Number(i.nova);
  const cap = (v: number | undefined, max: number) => (v == null ? v : Math.min(v, r1(Math.max(0, max))));
  return {
    fibras: cap(opt(i.fibras), item.carboidratos),
    acucar: cap(opt(i.acucar_adicionado), item.carboidratos),
    saturada: cap(opt(i.gordura_saturada), item.gordura),
    sodio: opt(i.sodio, 0),
    nova: [1, 2, 3, 4].includes(nova) ? (nova as Nova) : undefined,
    suplemento: i.suplemento === true ? true : undefined,
  };
}

export function normalizeDicas(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
}
