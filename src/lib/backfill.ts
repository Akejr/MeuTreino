/**
 * Refeições registradas antes da análise completa não têm fibras, açúcar adicionado, saturada, sódio e NOVA.
 * Com internet e código de acesso, o app completa só esses campos (calorias e macros não mudam):
 * primeiro pelos alimentos cadastrados, depois pela IA. Cada refeição é marcada para não tentar de novo.
 */
import type { AppData, Food, FoodItem, Meal } from '../types';
import { normalizeQuality, type NutriAIItem, type Quality } from './nutriAI';
import { accessCodeOf, chatJSON } from './openrouter';
import { backfillMessages } from './prompts';
import { getData, setData } from './storage';
import { r1 } from './utils';

const CAMPOS = ['fibras', 'acucar', 'saturada', 'sodio', 'nova'] as const;
const LOTE = 8;
const ESPERA_FALHA_MS = 10 * 60 * 1000;

export const faltaQualidade = (i: FoodItem) => CAMPOS.some((k) => i[k] === undefined);

export function pendingMeals(d: AppData): Meal[] {
  return Object.values(d.meals)
    .filter((m) => !m.qualidadeEstimada && m.itens.some(faltaQualidade))
    .sort((a, b) => b.date.localeCompare(a.date) || b.hora.localeCompare(a.hora));
}

/** Completa só os campos ausentes do item. */
export function fillItem(i: FoodItem, q: Quality): FoodItem {
  const out = { ...i };
  for (const k of CAMPOS) if (out[k] === undefined && q[k] !== undefined) (out as Record<string, unknown>)[k] = q[k];
  if (out.suplemento === undefined && q.suplemento) out.suplemento = true;
  return out;
}

/** Valores do cadastro, proporcionais às calorias do item (a IA calculou o item a partir do cadastro). */
function fromFood(i: FoodItem, f: Food | undefined): Quality {
  if (!f || !(f.calorias > 0)) return {};
  const k = i.calorias / f.calorias;
  const s = (v: number | undefined) => (v == null ? undefined : r1(v * k));
  return { fibras: s(f.fibras), acucar: s(f.acucar), saturada: s(f.saturada), sodio: f.sodio == null ? undefined : Math.round(f.sodio * k) };
}

interface Resposta {
  refeicoes?: { id?: unknown; itens?: (NutriAIItem & { id?: unknown })[] }[];
}

/** Aplica a resposta da IA nas refeições como estão agora (ele pode ter editado enquanto a IA respondia). */
export function applyBackfill(d: AppData, ids: string[], res: Resposta, now = Date.now()): AppData {
  const meals = { ...d.meals };
  const porId = new Map((Array.isArray(res.refeicoes) ? res.refeicoes : []).map((r) => [String(r.id), r]));
  for (const id of ids) {
    const m = meals[id];
    if (!m || m.qualidadeEstimada) continue;
    const r = porId.get(id);
    const itensIA = new Map((Array.isArray(r?.itens) ? r!.itens : []).map((x) => [String(x.id), x]));
    const itens = m.itens.map((i) => {
      if (!faltaQualidade(i)) return i;
      const comCadastro = fillItem(i, fromFood(i, d.foods[i.foodId ?? '']));
      const ia = itensIA.get(i.id);
      return ia ? fillItem(comCadastro, normalizeQuality(ia, i)) : comCadastro;
    });
    meals[id] = { ...m, itens, qualidadeEstimada: now };
  }
  return { ...d, meals };
}

let rodando = false;
let falhouEm = 0;

export async function backfillQuality(): Promise<number> {
  if (rodando || Date.now() - falhouEm < ESPERA_FALHA_MS) return 0;
  const d0 = getData();
  if (!accessCodeOf(d0) || !navigator.onLine || !pendingMeals(d0).length) return 0;
  rodando = true;
  let feitas = 0;
  try {
    for (let lote = 0; lote < 10; lote++) {
      const pend = pendingMeals(getData()).slice(0, LOTE);
      if (!pend.length) break;
      const res = await chatJSON<Resposta>(getData(), backfillMessages(getData(), pend), 0.2);
      if (!Array.isArray(res.refeicoes)) throw new Error('Resposta sem refeições.');
      const ids = pend.map((m) => m.id);
      setData((d) => applyBackfill(d, ids, res));
      feitas += ids.length;
    }
  } catch {
    // Sem rede ou IA indisponível: tenta de novo mais tarde, sem marcar as refeições.
    falhouEm = Date.now();
  } finally {
    rodando = false;
  }
  return feitas;
}

export function initBackfill() {
  const run = () => void backfillQuality();
  setTimeout(run, 4000);
  window.addEventListener('online', () => setTimeout(run, 3000));
  return run;
}
