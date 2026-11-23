/**
 * Análise da alimentação calculada pelo app (funciona sem internet). A IA recebe estes fatos
 * e escreve as sugestões; os alertas mostrados na tela saem daqui.
 *
 * Referências usadas nos limites:
 * - Proteína por refeição ~0,4 g/kg (mín. ~0,25 g/kg) em 3–4 refeições (Schoenfeld & Aragon, 2018).
 * - Fibras ~14 g por 1.000 kcal (IOM). Sódio < 2.000 mg e açúcar adicionado < 5–10% das calorias (OMS).
 * - Gordura saturada < 10% das calorias. Gordura total mínima ~0,5 g/kg.
 * - Ultraprocessados pela classificação NOVA (Guia Alimentar para a População Brasileira).
 */
import type { AppData, FoodItem, Macros, Meal } from '../types';
import { fmtNum, r0 } from './utils';

export type Nivel = 1 | 2 | 3;
export type Area = 'dieta' | 'treino' | 'habitos';
export interface Issue {
  area: Area;
  nivel: Nivel;
  texto: string;
}
export const NIVEL_LABEL: Record<Nivel, string> = { 1: 'leve', 2: 'média', 3: 'grave' };

const PRINCIPAIS = ['Café da manhã', 'Almoço', 'Jantar', 'Pós-treino'];
const f0 = (n: number) => r0(n).toLocaleString('pt-BR');
const f1 = (n: number) => fmtNum(Math.round(n * 10) / 10, 1);

// ---------------------------------------------------------------- metas

export interface Targets extends Macros {
  fibra: number;
  sodio: number;
  acucar: number;
  saturada: number;
  refeicaoMaxPct: number;
  /** Proteína ideal numa refeição principal (g). */
  protRefeicao: number;
  /** Abaixo disso a refeição tem pouca proteína (g). */
  protMin: number;
  /** Gordura mínima do dia (g). */
  gorduraMin: number;
}

export function targets(d: AppData): Targets {
  const peso = Number(String(d.settings.profile.peso).replace(',', '.'));
  const p = peso > 30 ? peso : 0;
  return {
    ...d.settings.limits,
    ...d.settings.nutri,
    protRefeicao: p ? Math.round(p * 0.4) : 30,
    protMin: p ? Math.round(p * 0.25) : 20,
    gorduraMin: p ? Math.round(p * 0.5) : 40,
  };
}

// ---------------------------------------------------------------- totais

export interface FullTotals extends Macros {
  fibras: number;
  acucar: number;
  saturada: number;
  sodio: number;
  /** Fração dos itens (0–1) com o dado preenchido. */
  cobertura: { fibras: number; acucar: number; saturada: number; sodio: number; nova: number };
  /** kcal de ultraprocessados (sem suplementos) e kcal com NOVA conhecida (sem suplementos). */
  ultraKcal: number;
  novaKcal: number;
  itens: number;
}

const EXTRA = ['fibras', 'acucar', 'saturada', 'sodio'] as const;

export function fullTotals(items: FoodItem[]): FullTotals {
  const t: FullTotals = {
    calorias: 0,
    proteina: 0,
    gordura: 0,
    carboidratos: 0,
    fibras: 0,
    acucar: 0,
    saturada: 0,
    sodio: 0,
    cobertura: { fibras: 0, acucar: 0, saturada: 0, sodio: 0, nova: 0 },
    ultraKcal: 0,
    novaKcal: 0,
    itens: items.length,
  };
  const conta = { fibras: 0, acucar: 0, saturada: 0, sodio: 0, nova: 0 };
  for (const i of items) {
    t.calorias += Number(i.calorias) || 0;
    t.proteina += Number(i.proteina) || 0;
    t.gordura += Number(i.gordura) || 0;
    t.carboidratos += Number(i.carboidratos) || 0;
    for (const k of EXTRA) {
      const v = i[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        t[k] += v;
        conta[k]++;
      }
    }
    if (i.nova) conta.nova++;
    if (i.nova && !i.suplemento) {
      t.novaKcal += Number(i.calorias) || 0;
      if (i.nova === 4) t.ultraKcal += Number(i.calorias) || 0;
    }
  }
  const n = items.length || 1;
  for (const k of [...EXTRA, 'nova'] as const) t.cobertura[k] = conta[k] / n;
  return t;
}

/** Dado confiável para dizer que "faltou" (a maioria dos itens tem o valor). */
const confiavel = (c: number) => c >= 0.75;

// ---------------------------------------------------------------- refeição

export interface MealLike {
  refeicao: string;
  hora: string;
  itens: FoodItem[];
}

/** Alertas de uma refeição (distribuição, proteína, fibras, sódio, açúcar, ultraprocessados). */
export function mealChecks(d: AppData, m: MealLike): Issue[] {
  const T = targets(d);
  const t = fullTotals(m.itens);
  const out: Issue[] = [];
  const add = (nivel: Nivel, texto: string) => out.push({ area: 'dieta', nivel, texto });
  if (!m.itens.length || t.calorias <= 0) return out;
  const pct = T.calorias ? (t.calorias / T.calorias) * 100 : 0;

  if (pct > T.refeicaoMaxPct) {
    add(pct > 50 ? 2 : 1, `Concentra **${Math.round(pct)}% do limite de calorias** do dia (${f0(t.calorias)} kcal). O ideal é até ${T.refeicaoMaxPct}% por refeição, dividindo o dia em 4 ou 5 refeições.`);
  }
  if (m.hora >= '22:00' && pct > 25) add(1, `Refeição grande depois das 22h (**${f0(t.calorias)} kcal**): prefira concentrar mais no começo do dia.`);

  const principal = PRINCIPAIS.includes(m.refeicao);
  if (m.refeicao === 'Pós-treino' && t.proteina < 25) add(1, `Pós-treino com **${f0(t.proteina)} g de proteína**: mire 25 a 40 g.`);
  else if (principal && t.proteina < T.protMin) add(1, `Pouca proteína: **${f0(t.proteina)} g**. Nas refeições principais mire cerca de ${T.protRefeicao} g.`);
  if (t.proteina > 70) add(1, `**${f0(t.proteina)} g de proteína** numa só refeição: distribuir ao longo do dia aproveita melhor.`);

  if (m.refeicao === 'Pré-treino') {
    if (t.gordura > 15) add(1, `Pré-treino com **${f0(t.gordura)} g de gordura**: a digestão fica lenta e pode pesar no treino.`);
    if (t.fibras > 10) add(1, `Pré-treino com **${f0(t.fibras)} g de fibras**: pode causar desconforto no treino.`);
  }
  if (T.gordura && t.gordura > T.gordura * 0.5) add(1, `**${f0(t.gordura)} g de gordura**: mais da metade do limite do dia (${T.gordura} g) numa refeição.`);
  if (T.carboidratos && t.carboidratos > T.carboidratos * 0.5) add(1, `**${f0(t.carboidratos)} g de carboidratos**: mais da metade do limite do dia numa refeição.`);

  if (T.sodio && t.sodio > T.sodio * 0.4) add(t.sodio > T.sodio * 0.6 ? 2 : 1, `Sódio alto: **${f0(t.sodio)} mg** (${Math.round((t.sodio / T.sodio) * 100)}% do limite do dia).`);
  if (T.acucar && t.acucar > T.acucar * 0.6) add(t.acucar > T.acucar ? 2 : 1, `Açúcar adicionado: **${f1(t.acucar)} g** (limite do dia ${T.acucar} g).`);
  if (T.saturada && t.saturada > T.saturada * 0.5) add(1, `Gordura saturada: **${f1(t.saturada)} g**, mais da metade do limite do dia (${T.saturada} g).`);

  if ((m.refeicao === 'Almoço' || m.refeicao === 'Jantar') && confiavel(t.cobertura.fibras) && t.fibras < 5) {
    add(1, `Pouca fibra: **${f1(t.fibras)} g**. Inclua salada, legumes, feijão ou uma fruta.`);
  }
  if (t.novaKcal >= 150 && t.ultraKcal / t.novaKcal > 0.5) {
    add(1, `**${Math.round((t.ultraKcal / t.novaKcal) * 100)}% das calorias** vêm de ultraprocessados: prefira versões in natura ou caseiras.`);
  }
  return out;
}

// ---------------------------------------------------------------- dia

export interface DietDay {
  issues: Issue[];
  /** O que ainda falta hoje (dia em andamento). */
  pendentes: string[];
  acertos: string[];
  /** Observações sem penalidade (ex.: dados faltando). */
  notas: string[];
  totals: FullTotals;
}

function over(label: string, v: number, lim: number, unit: string): Issue | null {
  if (!lim || v <= lim * 1.01) return null;
  const r = v / lim;
  const nivel: Nivel = r > 1.15 ? 3 : r > 1.05 ? 2 : 1;
  return { area: 'dieta', nivel, texto: `${label} **${Math.round((r - 1) * 100)}% acima do limite** (${f0(v)} de ${f0(lim)} ${unit}).` };
}

const minutes = (h: string) => {
  const [a, b] = h.split(':').map(Number);
  return (a || 0) * 60 + (b || 0);
};

/** Avaliação da dieta do dia. `finished` = dia já terminou (avalia também o que faltou). */
export function dietDay(d: AppData, meals: Meal[], finished: boolean): DietDay {
  const T = targets(d);
  const t = fullTotals(meals.flatMap((m) => m.itens));
  const issues: Issue[] = [];
  const pendentes: string[] = [];
  const acertos: string[] = [];
  const notas: string[] = [];
  const add = (nivel: Nivel, texto: string) => issues.push({ area: 'dieta', nivel, texto });
  const push = (i: Issue | null) => i && issues.push(i);

  if (!meals.length) {
    if (finished) add(3, 'Nenhuma refeição registrada.');
    else pendentes.push('Nenhuma refeição registrada ainda.');
    return { issues, pendentes, acertos, notas, totals: t };
  }

  if (finished && meals.length === 1) add(2, 'Só **1 refeição** registrada: o registro do dia parece incompleto.');
  else if (finished && meals.length === 2) add(1, 'Só **2 refeições** registradas: o ideal são 4 ou 5 para distribuir proteína e controlar a fome.');

  // limites máximos (contam mesmo com o dia em andamento)
  const kcal = over('Calorias', t.calorias, T.calorias, 'kcal');
  push(kcal);
  push(over('Carboidratos', t.carboidratos, T.carboidratos, 'g'));
  push(over('Gordura', t.gordura, T.gordura, 'g'));
  if (!kcal && finished && T.calorias) {
    const r = t.calorias / T.calorias;
    if (r < 0.5) add(3, `Calorias muito baixas: **${f0(t.calorias)} kcal** (${Math.round(r * 100)}% do limite). Déficit tão grande dificulta preservar músculo, ou faltou registrar refeições.`);
    else if (r < 0.7) add(2, `Calorias baixas: **${f0(t.calorias)} kcal** (${Math.round(r * 100)}% do limite). Déficit grande atrapalha treino e recuperação.`);
    else acertos.push(`Calorias dentro do limite (${f0(t.calorias)} de ${f0(T.calorias)} kcal).`);
  } else if (!kcal && !finished) pendentes.push(`Restam **${f0(T.calorias - t.calorias)} kcal** do limite.`);

  // proteína (meta)
  if (T.proteina) {
    const r = t.proteina / T.proteina;
    if (r >= 1) acertos.push(`Proteína na meta (${f0(t.proteina)} g).`);
    else if (!finished) pendentes.push(`Faltam **${f0(T.proteina - t.proteina)} g de proteína** para a meta.`);
    else add(r < 0.75 ? 3 : r < 0.9 ? 2 : 1, `Proteína abaixo da meta: **${f0(t.proteina)} de ${T.proteina} g** (${Math.round(r * 100)}%).`);
  }
  if (finished && t.gordura < T.gorduraMin) {
    add(1, `Gordura muito baixa: **${f0(t.gordura)} g**. Fique perto de ${T.gorduraMin} g ou mais (cerca de 0,5 g/kg) pela saúde hormonal.`);
  }

  // fibras (mínimo)
  if (T.fibra) {
    const cob = confiavel(t.cobertura.fibras);
    if (t.fibras >= T.fibra) acertos.push(`Fibras na meta (${f1(t.fibras)} g).`);
    else if (!cob) notas.push(`Fibras sem dado em parte dos itens (somam ${f1(t.fibras)} g conhecidos).`);
    else if (!finished) pendentes.push(`Faltam **${f1(T.fibra - t.fibras)} g de fibras**.`);
    else add(t.fibras < T.fibra * 0.5 ? 2 : 1, `Fibras baixas: **${f1(t.fibras)} de ${T.fibra} g**. Inclua feijão, aveia, frutas com casca, verduras e legumes.`);
  }

  // excessos de qualidade (contam mesmo com o dia em andamento)
  if (T.sodio && t.sodio > T.sodio * 1.01) add(t.sodio > T.sodio * 1.5 ? 2 : 1, `Sódio acima do limite: **${f0(t.sodio)} mg** (limite ${f0(T.sodio)} mg).`);
  else if (finished && confiavel(t.cobertura.sodio)) acertos.push(`Sódio dentro do limite (${f0(t.sodio)} mg).`);
  if (T.acucar && t.acucar > T.acucar * 1.01) add(t.acucar > T.acucar * 2 ? 2 : 1, `Açúcar adicionado acima do limite: **${f1(t.acucar)} g** (limite ${T.acucar} g).`);
  if (T.saturada && t.saturada > T.saturada * 1.01) add(t.saturada > T.saturada * 1.5 ? 2 : 1, `Gordura saturada acima do limite: **${f1(t.saturada)} g** (limite ${T.saturada} g).`);

  if (finished && t.calorias >= 800 && t.novaKcal >= t.calorias * 0.6) {
    const share = t.ultraKcal / t.novaKcal;
    if (share > 0.2) add(share > 0.4 ? 2 : 1, `**${Math.round(share * 100)}% das calorias** vieram de ultraprocessados (sem contar suplementos). Mire abaixo de 20%.`);
    else acertos.push('Poucos ultraprocessados.');
  }

  // distribuição ao longo do dia
  const porRefeicao = meals.map((m) => ({ m, t: fullTotals(m.itens) }));
  for (const { m, t: mt } of porRefeicao) {
    const pct = T.calorias ? (mt.calorias / T.calorias) * 100 : 0;
    if (pct > T.refeicaoMaxPct) add(pct > 50 ? 2 : 1, `Mal distribuído: **${m.refeicao} (${m.hora})** concentrou ${Math.round(pct)}% do limite de calorias.`);
    if (m.hora >= '22:00' && pct > 25) add(1, `Refeição grande tarde da noite: **${m.refeicao} (${m.hora})**, ${f0(mt.calorias)} kcal.`);
    if (m.refeicao === 'Pré-treino' && mt.gordura > 15) add(1, `Pré-treino pesado: **${f0(mt.gordura)} g de gordura**.`);
  }
  if (finished && meals.length >= 2) {
    const boas = porRefeicao.filter((x) => x.t.proteina >= T.protMin).length;
    if (boas < 3) add(1, `Proteína concentrada: só **${boas} ${boas === 1 ? 'refeição' : 'refeições'} com ${T.protMin} g ou mais**. O ideal são 3 ou 4 refeições com cerca de ${T.protRefeicao} g.`);
    else acertos.push(`Proteína bem distribuída (${boas} refeições com ${T.protMin} g ou mais).`);
    const horas = meals.map((m) => m.hora).filter((h) => h >= '06:00' && h <= '23:00').sort();
    for (let i = 1; i < horas.length; i++) {
      const gap = minutes(horas[i]) - minutes(horas[i - 1]);
      if (gap > 6 * 60) add(1, `Intervalo longo sem comer: **${Math.floor(gap / 60)} h** entre ${horas[i - 1]} e ${horas[i]}.`);
    }
  }
  return { issues, pendentes, acertos, notas, totals: t };
}
