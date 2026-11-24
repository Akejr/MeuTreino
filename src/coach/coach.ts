/**
 * O "cérebro" do coach: junta musculação, cardio, alimentação e hábitos de um dia e dos 7 dias
 * anteriores e tira conclusões com regras baseadas em estudos (fontes em evidence.ts).
 * Roda no aparelho, sem internet. A IA recebe este relatório e conversa a partir dele.
 */
import { activeHabits, isDone } from '../habits/habits';
import { cardioBetween, cardioOn } from '../cardio/cardio';
import { fullTotals, targets, type FullTotals } from '../lib/nutrition';
import { mealsOf, sessionsOn } from '../lib/score';
import { addDays, daysBetween, dow, fmtNum, nowHHMM, r0, todayISO } from '../lib/utils';
import { getEx, resolveExercise, type Grupo } from '../training/catalog';
import { exposures } from '../training/engine';
import { planSessionOf } from '../training/schedule';
import type { AppData, Cardio, Habit, Meal, Session, SetLog } from '../types';
import { bodyOf, cardioDef, estimateCardio, estimateWeights, FATOR_DIA, METODO_LABEL, type Body, type CardioDef, type CardioEst } from './energy';
import { FONTE } from './evidence';

export type InsightTipo = 'alerta' | 'melhorar' | 'bom' | 'dica';
export type InsightArea = 'energia' | 'proteina' | 'carboidrato' | 'gordura' | 'qualidade' | 'cardio' | 'treino' | 'recuperacao' | 'habitos' | 'registro';

export interface Insight {
  id: string;
  area: InsightArea;
  tipo: InsightTipo;
  /** 1 = mais importante. */
  prioridade: 1 | 2 | 3;
  texto: string;
  porque?: string;
  fonte?: string[];
}

export interface CardioCalc {
  c: Cardio;
  def: CardioDef;
  est: CardioEst;
  /** Minutos desde a meia-noite. */
  inicio: number;
  fim: number;
}

export interface TreinoCalc {
  s: Session;
  minutos: number;
  kcalLiquida: number;
  inicio?: number;
  fim?: number;
  pernas: boolean;
}

export interface CoachDay {
  date: string;
  finished: boolean;
  body: Body | null;
  meals: Meal[];
  totals: FullTotals;
  /** 3 refeições ou mais: dá para avaliar a energia do dia. */
  registroCompleto: boolean;
  cardio: CardioCalc[];
  cardioMin: number;
  cardioLiq: number;
  /** Muito cardio: ≥ 300 kcal acima do repouso, ≥ 45 min de moderado ou ≥ 25 min intenso. */
  cardioPesado: boolean;
  treinos: TreinoCalc[];
  musculacaoLiq: number;
  gastoBase: number;
  gasto: number;
  /** Consumo − gasto (negativo = déficit). */
  saldo: number;
  /** (Consumo − exercício) por kg de massa magra. */
  disponibilidade?: number;
  protKg: number;
  carbKg: number;
  gordKg: number;
}

export interface CoachWeek {
  de: string;
  ate: string;
  /** Dias desde o primeiro registro no app (até 7). */
  dias: number;
  cardioMin: number;
  minutosOms: number;
  sessoesCardio: number;
  intensas: number;
  corridaMin: number;
  treinosFeitos: number;
  treinosPerdidos: number;
  diasCompletos: number;
  diasIncompletos: string[];
  saldoMedio?: number;
  perdaPctSemana?: number;
}

export interface CoachReport {
  date: string;
  dia: CoachDay;
  semana: CoachWeek;
  insights: Insight[];
  /** O que o app não mede e o coach deve perguntar. */
  perguntas: string[];
  limiteKcal: number;
}

// ---------------------------------------------------------------- utilidades

const f0 = (n: number) => r0(n).toLocaleString('pt-BR');
const f1 = (n: number) => fmtNum(Math.round(n * 10) / 10, 1);
const f2 = (n: number) => fmtNum(Math.round(n * 100) / 100, 2);
const toMin = (h: string) => {
  const [a, b] = h.split(':').map(Number);
  return (a || 0) * 60 + (b || 0);
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const minOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};
const LEGS: Grupo[] = ['quadriceps', 'posteriores', 'gluteos'];

const RE = {
  cardioHabito: /esteira|cardio|corr(id|e)|bike|bicicleta|caminhad|el[ií]ptico|escada|nata[cç]|aer[oó]bic/i,
  acucarHabito: /a[cç][uú]car|doce/i,
  aguaHabito: /[áa]gua|hidrat/i,
  sonoHabito: /sono|dormir|deitar/i,
  alcool: /cerveja|chopp?\b|vinho|vodka|whisk|cacha[cç]a|caipirinha|caipiroska|\bgin\b|drink|licor|tequila|\brum\b|espumante|saqu[eê]/i,
  cafeina: /caf[eé]|cappuc+ino|capuc+ino|espresso|expresso|energ[eé]tico|pr[eé]-?treino|coca|\bcola\b|ch[aá] (preto|verde|mate)|\bmate\b/i,
  semCafeina: /descafeinad|sem cafe[ií]na/i,
};

function habitsMatching(d: AppData, date: string, re: RegExp): Habit[] {
  return activeHabits(d, date).filter((h) => re.test(h.nome));
}

function sessionMinutes(s: Session): number {
  if (s.duracaoSeg) return s.duracaoSeg / 60;
  const now = Date.now();
  return s.intervalos.reduce((n, iv) => n + ((iv.f ?? now) - iv.i), 0) / 60000;
}

function treinoCalc(d: AppData, s: Session, body: Body | null): TreinoCalc {
  const minutos = sessionMinutes(s);
  const ps = planSessionOf(d, s);
  const t = d.settings.training;
  const pernas = !!ps?.slots.some((sl) => LEGS.includes(getEx(resolveExercise(sl.exerciseId, t) ?? sl.exerciseId).grupo));
  const lastEnd = s.fim ?? s.intervalos[s.intervalos.length - 1]?.f;
  const inicio = s.inicio ? minOfDay(s.inicio) : undefined;
  return {
    s,
    minutos,
    kcalLiquida: estimateWeights(minutos, body).kcalLiquida,
    inicio,
    fim: lastEnd ? minOfDay(lastEnd) : inicio != null ? inicio + minutos : undefined,
    pernas,
  };
}

function cardioCalc(c: Cardio, body: Body | null): CardioCalc {
  const inicio = toMin(c.hora);
  return { c, def: cardioDef(c.tipo), est: estimateCardio(c, body), inicio, fim: inicio + c.minutos };
}

// ---------------------------------------------------------------- dia

export function coachDay(d: AppData, date: string): CoachDay {
  const body = bodyOf(d.settings.profile);
  const meals = mealsOf(d, date);
  const totals = fullTotals(meals.flatMap((m) => m.itens));
  const cardio = cardioOn(d, date).map((c) => cardioCalc(c, body));
  const treinos = sessionsOn(d, date).feitas.map((s) => treinoCalc(d, s, body));
  const cardioMin = cardio.reduce((n, x) => n + x.c.minutos, 0);
  const cardioLiq = cardio.reduce((n, x) => n + x.est.kcalLiquida, 0);
  const musculacaoLiq = treinos.reduce((n, x) => n + x.kcalLiquida, 0);
  const moderadoMin = cardio.filter((x) => x.est.met >= 3).reduce((n, x) => n + x.c.minutos, 0);
  const cardioPesado = cardioLiq >= 300 || moderadoMin >= 45 || cardio.some((x) => x.est.intensidade === 'intensa' && x.c.minutos >= 25);
  const gastoBase = (body?.tmb ?? 0) * FATOR_DIA;
  const exercicio = cardioLiq + musculacaoLiq;
  const gasto = gastoBase + exercicio;
  const peso = body?.peso ?? 0;
  return {
    date,
    finished: date < todayISO(),
    body,
    meals,
    totals,
    registroCompleto: meals.length >= 3,
    cardio,
    cardioMin,
    cardioLiq,
    cardioPesado,
    treinos,
    musculacaoLiq,
    gastoBase,
    gasto,
    saldo: totals.calorias - gasto,
    disponibilidade: body ? (totals.calorias - exercicio) / body.massaMagra : undefined,
    protKg: peso ? totals.proteina / peso : 0,
    carbKg: peso ? totals.carboidratos / peso : 0,
    gordKg: peso ? totals.gordura / peso : 0,
  };
}

/** Primeiro dia com algum registro no app. */
function historyStart(d: AppData): string | undefined {
  const datas = [
    ...Object.values(d.meals).map((m) => m.date),
    ...Object.values(d.cardio ?? {}).map((c) => c.date),
    ...Object.values(d.sessions)
      .filter((s) => s.status === 'concluida' || s.status === 'parcial')
      .map((s) => s.dataReal ?? s.dataAtual),
    ...Object.values(d.habitChecks).map((c) => c.date),
  ];
  return datas.length ? datas.sort()[0] : undefined;
}

export function coachWeek(d: AppData, date: string): CoachWeek {
  const ini = historyStart(d);
  const de = ini && ini > addDays(date, -6) ? ini : addDays(date, -6);
  const body = bodyOf(d.settings.profile);
  const cs = cardioBetween(d, de, date).map((c) => cardioCalc(c, body));
  const hoje = todayISO();
  let treinosFeitos = 0;
  let treinosPerdidos = 0;
  const saldos: number[] = [];
  const diasIncompletos: string[] = [];
  let diasCompletos = 0;
  for (let x = de; x <= date; x = addDays(x, 1)) {
    const so = sessionsOn(d, x);
    treinosFeitos += so.feitas.filter((s) => s.status !== 'em_andamento').length;
    treinosPerdidos += so.perdidas.length;
    if (x >= hoje) continue;
    const dia = coachDay(d, x);
    if (dia.registroCompleto) {
      diasCompletos++;
      if (dia.body) saldos.push(dia.saldo);
    } else diasIncompletos.push(x);
  }
  const saldoMedio = saldos.length >= 3 ? saldos.reduce((a, b) => a + b, 0) / saldos.length : undefined;
  return {
    de,
    ate: date,
    dias: daysBetween(de, date) + 1,
    cardioMin: cs.reduce((n, x) => n + x.c.minutos, 0),
    minutosOms: cs.reduce((n, x) => n + x.est.minutosOms, 0),
    sessoesCardio: cs.length,
    intensas: cs.filter((x) => x.est.intensidade === 'intensa' || x.c.tipo === 'hiit').length,
    corridaMin: cs.filter((x) => x.def.impacto).reduce((n, x) => n + x.c.minutos, 0),
    treinosFeitos,
    treinosPerdidos,
    diasCompletos,
    diasIncompletos,
    saldoMedio,
    // 7.700 kcal ≈ 1 kg de gordura corporal
    perdaPctSemana: saldoMedio != null && body ? (((-saldoMedio * 7) / 7700) / body.peso) * 100 : undefined,
  };
}

// ---------------------------------------------------------------- regras do dia

function dayInsights(d: AppData, dia: CoachDay, out: Insight[]) {
  const add = (i: Insight) => out.push(i);
  const T = targets(d);
  const L = d.settings.limits;
  const b = dia.body;
  const t = dia.totals;
  const P = b?.peso ?? 0;
  const fim = dia.finished;
  const avaliavel = fim && dia.registroCompleto;
  const temRefeicao = dia.meals.length > 0;
  const exercicio = dia.cardioLiq + dia.musculacaoLiq;

  // ---------- energia
  if (b && avaliavel) {
    const deficit = -dia.saldo;
    const conta = `consumo ${f0(t.calorias)} kcal, gasto estimado ~${f0(dia.gasto)} kcal (${f0(exercicio)} de exercício)`;
    if (deficit >= 1000) {
      add({
        id: 'energia_deficit_grande',
        area: 'energia',
        tipo: t.calorias < b.tmb * 0.9 ? 'alerta' : 'melhorar',
        prioridade: 1,
        texto: `Déficit estimado de **~${f0(deficit)} kcal** (${conta}).`,
        porque: 'Déficit muito grande acelera a perda de massa magra e derruba o rendimento. Perder 0,5 a 1% do peso por semana preserva mais músculo.',
        fonte: [FONTE.HELMS, FONTE.GARTHE],
      });
    } else if (deficit >= 250) {
      add({ id: 'energia_deficit_ok', area: 'energia', tipo: 'bom', prioridade: 2, texto: `Déficit estimado de **~${f0(deficit)} kcal** (${conta}): ritmo bom para perder gordura mantendo músculo.`, fonte: [FONTE.HELMS] });
    } else if (deficit <= -200) {
      add({ id: 'energia_superavit', area: 'energia', tipo: 'melhorar', prioridade: 1, texto: `Superávit estimado de **~${f0(-deficit)} kcal** (${conta}): para reduzir gordura, o dia ficou acima do gasto.` });
    } else {
      add({ id: 'energia_manutencao', area: 'energia', tipo: 'dica', prioridade: 3, texto: `Dia perto da manutenção (${conta}).` });
    }
    // Em dia de muito cardio isso entra no ponto "cardio × alimentação".
    if (dia.disponibilidade != null && dia.disponibilidade < 20 && !dia.cardioPesado) {
      add({
        id: 'energia_disponibilidade',
        area: 'recuperacao',
        tipo: 'alerta',
        prioridade: 1,
        texto: `Sobrou pouca energia para o corpo depois do exercício: **~${f0(dia.disponibilidade)} kcal por kg de massa magra** (abaixo de 20).`,
        porque: 'Com disponibilidade de energia baixa por vários dias caem hormônios, recuperação e massa magra; o ideal é ficar perto de 30 ou mais.',
        fonte: [FONTE.MOUNTJOY],
      });
    }
  } else if (b && !fim && exercicio > 0) {
    const noLimite = L.calorias - dia.gasto;
    const metade = Math.round(dia.cardioLiq / 2 / 50) * 50;
    if (-noLimite >= 1000 && metade >= 100) {
      add({
        id: 'energia_hoje_cardio',
        area: 'energia',
        tipo: 'melhorar',
        prioridade: 1,
        texto: `Com o exercício de hoje o gasto estimado vai a **~${f0(dia.gasto)} kcal**. Comendo só até o limite (${f0(L.calorias)}), o déficit fica em ~${f0(-noLimite)} kcal. Vale acrescentar **~${f0(metade)} kcal** (metade do cardio) em carboidrato e proteína.`,
        porque: 'Déficit acima de ~1.000 kcal custa massa magra; repor metade, e não tudo, compensa o erro das estimativas, que costumam exagerar o gasto.',
        fonte: [FONTE.HELMS, FONTE.SHCHERBINA],
      });
    } else if (dia.cardioLiq > 0) {
      add({ id: 'energia_hoje', area: 'energia', tipo: 'dica', prioridade: 3, texto: `Gasto estimado de hoje: **~${f0(dia.gasto)} kcal** (cardio ~${f0(dia.cardioLiq)}, musculação ~${f0(dia.musculacaoLiq)}). No limite de ${f0(L.calorias)} kcal o déficit fica ~${f0(-noLimite)} kcal.` });
    }
  }

  // ---------- muito cardio + alimentação
  if (dia.cardioPesado && temRefeicao) {
    const prob: string[] = [];
    if (t.calorias > L.calorias * 1.01) prob.push(`passou do limite de calorias (${f0(t.calorias)} de ${f0(L.calorias)} kcal): comeu de volta o cardio e mais`);
    if (fim && b && t.calorias < b.tmb) prob.push(`comeu **${f0(t.calorias)} kcal**, menos que o seu metabolismo basal (~${f0(b.tmb)})`);
    if (fim && dia.registroCompleto && dia.disponibilidade != null && dia.disponibilidade < 20) prob.push(`sobrou pouca energia depois do exercício (~${f0(dia.disponibilidade)} kcal por kg de massa magra; o ideal é perto de 30)`);
    if (fim && P && dia.protKg < 1.6) prob.push(`proteína baixa (${f1(dia.protKg)} g/kg)`);
    if (fim && P && dia.carbKg < 2 && dia.cardioMin >= 45) prob.push(`pouco carboidrato para repor o glicogênio (${f1(dia.carbKg)} g/kg)`);
    if (t.novaKcal >= t.calorias * 0.6 && t.novaKcal > 0 && t.ultraKcal / t.novaKcal > 0.4) prob.push(`${Math.round((t.ultraKcal / t.novaKcal) * 100)}% das calorias de ultraprocessados`);
    if (dia.meals.some((m) => m.itens.some((i) => RE.alcool.test(i.nome)))) prob.push('álcool no mesmo dia');
    if (prob.length) {
      add({
        id: 'cardio_dieta',
        area: 'cardio',
        tipo: 'alerta',
        prioridade: 1,
        texto: `Dia de muito cardio (**${f0(dia.cardioMin)} min, ~${f0(dia.cardioLiq)} kcal**) e a alimentação não acompanhou: ${prob.join('; ')}.`,
        porque: 'Muito aeróbico aumenta a necessidade de carboidrato e proteína para recuperar. Com pouca energia ou comida ruim, o corpo perde mais massa magra e o treino seguinte rende menos; comer além do gasto anula o cardio.',
        fonte: [FONTE.ACSM_NUTRI, FONTE.MOUNTJOY, FONTE.THOMAS_COMPENSACAO],
      });
    } else if (avaliavel) {
      add({ id: 'cardio_dieta_ok', area: 'cardio', tipo: 'bom', prioridade: 2, texto: `Dia de muito cardio (${f0(dia.cardioMin)} min) e a alimentação acompanhou: proteína ${f1(dia.protKg)} g/kg, carboidrato ${f1(dia.carbKg)} g/kg, dentro do limite.` });
    }
  }

  // ---------- proteína
  if (P && avaliavel) {
    if (dia.protKg < 1.6) {
      add({ id: 'proteina_baixa', area: 'proteina', tipo: 'melhorar', prioridade: 1, texto: `Proteína de **${f1(dia.protKg)} g/kg** (${f0(t.proteina)} g): abaixo de 1,6 g/kg.`, porque: 'Até ~1,6 g/kg cada grama a mais ainda aumenta o ganho de massa; em déficit, 1,8 a 2,2 g/kg protege o músculo.', fonte: [FONTE.MORTON, FONTE.HELMS] });
    } else if (dia.protKg <= 2.2) {
      add({ id: 'proteina_ok', area: 'proteina', tipo: 'bom', prioridade: 2, texto: `Proteína de **${f1(dia.protKg)} g/kg** (${f0(t.proteina)} g): na faixa que mais protege o músculo no déficit.`, fonte: [FONTE.MORTON, FONTE.HELMS] });
    } else {
      add({
        id: 'proteina_alta',
        area: 'proteina',
        tipo: 'dica',
        prioridade: 3,
        texto: `Proteína de **${f1(dia.protKg)} g/kg** (${f0(t.proteina)} g), acima de 2,2 g/kg.`,
        porque: 'Acima de ~2,2 g/kg o ganho extra de massa é pequeno. Em déficit não faz mal e ajuda a saciedade, mas se faltar espaço para fibras e carboidrato perto do treino, dá para trocar parte da proteína por eles.',
        fonte: [FONTE.MORTON],
      });
    }
    const boa = P * 0.3;
    const comProteina = dia.meals.filter((m) => m.itens.reduce((n, i) => n + (Number(i.proteina) || 0), 0) >= boa).length;
    if (comProteina < 3) {
      add({ id: 'proteina_distribuicao', area: 'proteina', tipo: 'melhorar', prioridade: 2, texto: `Só **${comProteina} ${comProteina === 1 ? 'refeição' : 'refeições'} com ${f0(boa)} g de proteína ou mais**. Mire 3 a 5 refeições com ~${f0(P * 0.4)} g.`, porque: 'Distribuir a proteína em 4 refeições estimula mais a síntese muscular do que concentrar em 1 ou 2.', fonte: [FONTE.ARETA, FONTE.SCHOENFELD_ARAGON] });
    }
  }

  // pós-treino e antes de dormir
  if (P && temRefeicao) {
    for (const tr of dia.treinos) {
      if (tr.fim == null || tr.s.status === 'em_andamento') continue;
      const perto = dia.meals.some((m) => {
        const h = toMin(m.hora);
        const prot = m.itens.reduce((n, i) => n + (Number(i.proteina) || 0), 0);
        return h >= tr.fim! - 60 && h <= tr.fim! + 180 && prot >= P * 0.25;
      });
      const passou = fim || toMin(nowHHMM()) > tr.fim + 180;
      if (perto) add({ id: `pos_treino_ok_${tr.s.id}`, area: 'proteina', tipo: 'bom', prioridade: 3, texto: `Refeição com proteína até 3 h depois do treino ${tr.s.key}.`, fonte: [FONTE.ARAGON_JANELA] });
      else if (passou)
        add({
          id: `pos_treino_${tr.s.id}`,
          area: 'proteina',
          tipo: 'dica',
          prioridade: 3,
          texto: `Nenhuma refeição com ~${f0(P * 0.3)} g de proteína até 3 h depois do treino ${tr.s.key} (terminou ${hhmm(tr.fim)}).`,
          porque: 'O total de proteína do dia pesa mais que o horário, mas ter uma refeição com proteína nas horas em volta do treino ajuda a recuperação.',
          fonte: [FONTE.SCHOENFELD_TIMING, FONTE.ARAGON_JANELA],
        });
    }
    const ultima = dia.meals[dia.meals.length - 1];
    const protUltima = ultima.itens.reduce((n, i) => n + (Number(i.proteina) || 0), 0);
    if (fim && dia.treinos.length && toMin(ultima.hora) >= 19 * 60 && protUltima < P * 0.25) {
      add({
        id: 'proteina_noite',
        area: 'proteina',
        tipo: 'dica',
        prioridade: 3,
        texto: `A última refeição (${ultima.hora}) teve ${f0(protUltima)} g de proteína. Em dia de treino, 30 a 40 g antes de dormir (iogurte proteico, leite, caseína, ovos) ajudam a recuperação da noite.`,
        fonte: [FONTE.SNIJDERS],
      });
    }
  }

  // ---------- carboidrato e gordura
  if (P && fim && temRefeicao) {
    const longo = dia.cardio.filter((x) => x.est.met >= 3).reduce((n, x) => n + x.c.minutos, 0) >= 60;
    const jaDito = out.some((i) => i.id === 'cardio_dieta' && i.texto.includes('carboidrato'));
    if (longo && dia.carbKg < 2 && !jaDito) {
      add({
        id: 'carbo_cardio',
        area: 'carboidrato',
        tipo: 'melhorar',
        prioridade: 2,
        texto: `Carboidrato de **${f1(dia.carbKg)} g/kg** num dia com ${f0(dia.cardioMin)} min de cardio. Use o seu limite (${f0(L.carboidratos)} g) e coloque a maior parte antes e depois do treino.`,
        porque: 'Uma hora de aeróbico moderado já pede mais carboidrato para repor o glicogênio; com ele baixo, o treino de força seguinte rende menos.',
        fonte: [FONTE.ACSM_NUTRI],
      });
    } else if (dia.treinos.length && dia.carbKg < 1) {
      add({ id: 'carbo_baixo', area: 'carboidrato', tipo: 'dica', prioridade: 3, texto: `Carboidrato de ${f1(dia.carbKg)} g/kg num dia de treino: se o rendimento cair nas últimas séries, coloque carboidrato na refeição antes do treino.`, fonte: [FONTE.ACSM_NUTRI] });
    }
    if (dia.registroCompleto && dia.gordKg < 0.5) {
      add({ id: 'gordura_baixa', area: 'gordura', tipo: 'melhorar', prioridade: 2, texto: `Gordura de **${f1(dia.gordKg)} g/kg** (${f0(t.gordura)} g): abaixo de 0,5 g/kg.`, porque: 'Dietas muito pobres em gordura reduzem a testosterona; o mínimo prático fica perto de 0,5 g/kg ou 20% das calorias.', fonte: [FONTE.WHITTAKER, FONTE.HELMS] });
    }
  }

  // ---------- qualidade (acompanhamento: não muda a nota do dia)
  if (temRefeicao) {
    const cob = (c: number) => c >= 0.75;
    const metaFibra = Math.max(T.fibra ? Math.min(T.fibra, (t.calorias / 1000) * 14) : (t.calorias / 1000) * 14, 0);
    if (fim && cob(t.cobertura.fibras) && t.calorias > 800) {
      if (t.fibras < metaFibra * 0.8)
        add({
          id: 'fibra',
          area: 'qualidade',
          tipo: 'melhorar',
          prioridade: 2,
          texto: `Fibras: **${f1(t.fibras)} g** (para ${f0(t.calorias)} kcal o alvo é ~${f0(metaFibra)} g). Feijão, lentilha, aveia, chia, frutas com casca, folhas e legumes resolvem.`,
          porque: 'Fibra aumenta a saciedade no déficit e está ligada a menos doença cardiovascular e diabetes.',
          fonte: [FONTE.IOM_FIBRA, FONTE.REYNOLDS],
        });
      else add({ id: 'fibra_ok', area: 'qualidade', tipo: 'bom', prioridade: 3, texto: `Fibras em dia: ${f1(t.fibras)} g.` });
    }
    if (fim && t.calorias >= 800 && t.novaKcal >= t.calorias * 0.6 && t.novaKcal > 0) {
      const share = t.ultraKcal / t.novaKcal;
      const itens = dia.meals
        .flatMap((m) => m.itens)
        .filter((i) => i.nova === 4 && !i.suplemento)
        .sort((a, b2) => b2.calorias - a.calorias)
        .slice(0, 3)
        .map((i) => i.nome.replace(/\*\*/g, ''));
      if (share > 0.2)
        add({
          id: 'ultra',
          area: 'qualidade',
          tipo: 'melhorar',
          prioridade: 2,
          texto: `**${Math.round(share * 100)}% das calorias** de ultraprocessados${itens.length ? ` (${itens.join(', ')})` : ''}. Troque um deles por uma versão in natura.`,
          porque: 'Num ensaio controlado, a dieta ultraprocessada fez as pessoas comerem ~500 kcal a mais por dia sem perceber.',
          fonte: [FONTE.HALL],
        });
    }
    if (T.sodio && t.sodio > T.sodio * 1.01 && cob(t.cobertura.sodio)) {
      if (dia.cardioMin >= 60)
        add({ id: 'sodio_cardio', area: 'qualidade', tipo: 'dica', prioridade: 3, texto: `Sódio em ${f0(t.sodio)} mg, acima de ${f0(T.sodio)}, mas num dia com ${f0(dia.cardioMin)} min de cardio você perde sódio no suor: um pouco acima hoje não preocupa.`, fonte: [FONTE.ACSM_HIDRATACAO] });
      else add({ id: 'sodio', area: 'qualidade', tipo: 'melhorar', prioridade: 3, texto: `Sódio em **${f0(t.sodio)} mg** (alvo abaixo de ${f0(T.sodio)} mg). Embutidos, temperos prontos e pães são as fontes mais comuns.`, fonte: [FONTE.OMS_SODIO] });
    }
    if (t.calorias > 0 && cob(t.cobertura.acucar) && t.acucar * 4 > t.calorias * 0.1)
      add({ id: 'acucar', area: 'qualidade', tipo: 'melhorar', prioridade: 3, texto: `Açúcar adicionado em **${f1(t.acucar)} g** (${Math.round(((t.acucar * 4) / t.calorias) * 100)}% das calorias; alvo abaixo de 10%).`, fonte: [FONTE.OMS_ACUCAR] });
    if (t.calorias > 0 && cob(t.cobertura.saturada) && t.saturada * 9 > t.calorias * 0.1)
      add({ id: 'saturada', area: 'qualidade', tipo: 'melhorar', prioridade: 3, texto: `Gordura saturada em **${f1(t.saturada)} g** (${Math.round(((t.saturada * 9) / t.calorias) * 100)}% das calorias; alvo abaixo de 10%).` });

    // hábito "sem açúcar" marcado, mas com açúcar adicionado nos itens
    for (const h of habitsMatching(d, dia.date, RE.acucarHabito)) {
      if (!isDone(d, h.id, dia.date)) continue;
      const itens = dia.meals.flatMap((m) => m.itens).filter((i) => (i.acucar ?? 0) >= 1);
      const soma = itens.reduce((n, i) => n + (i.acucar ?? 0), 0);
      if (soma >= 2)
        add({
          id: 'habito_acucar',
          area: 'habitos',
          tipo: 'melhorar',
          prioridade: 2,
          texto: `Você marcou **${h.nome}**, mas ${itens
            .sort((a, b2) => (b2.acucar ?? 0) - (a.acucar ?? 0))
            .slice(0, 3)
            .map((i) => `${i.nome.replace(/\*\*/g, '')} (${f1(i.acucar ?? 0)} g)`)
            .join(', ')} ${itens.length === 1 ? 'tem' : 'têm'} açúcar adicionado: ${f1(soma)} g no dia. Produtos industrializados costumam ter açúcar escondido.`,
        });
    }
  }

  // ---------- cafeína e álcool
  const itensHora = dia.meals.flatMap((m) => m.itens.map((i) => ({ i, hora: m.hora })));
  const cafeTarde = itensHora.filter((x) => toMin(x.hora) >= 16 * 60 && RE.cafeina.test(x.i.nome) && !RE.semCafeina.test(x.i.nome));
  if (cafeTarde.length)
    add({
      id: 'cafeina_tarde',
      area: 'recuperacao',
      tipo: 'dica',
      prioridade: 2,
      texto: `Cafeína depois das 16h: ${cafeTarde.map((x) => `${x.i.nome.replace(/\*\*/g, '')} às ${x.hora}`).join(', ')}.`,
      porque: 'Cafeína até 6 h antes de deitar ainda tira cerca de 1 h de sono, e sono curto no déficit faz perder mais músculo.',
      fonte: [FONTE.DRAKE, FONTE.NEDELTCHEVA],
    });
  const alcool = itensHora.filter((x) => RE.alcool.test(x.i.nome));
  if (alcool.length)
    add({
      id: 'alcool',
      area: 'recuperacao',
      tipo: 'melhorar',
      prioridade: 1,
      texto: `Álcool no dia: ${alcool.map((x) => x.i.nome.replace(/\*\*/g, '')).join(', ')}.`,
      porque: 'Álcool depois do treino reduziu a síntese de proteína muscular em 24 a 37% mesmo com proteína junto; tem 7 kcal por grama e piora o sono.',
      fonte: [FONTE.PARR],
    });

  // ---------- cardio × musculação
  for (const cc of dia.cardio) {
    const def = cc.def;
    const forte = cc.est.intensidade === 'intensa' || def.impacto || (def.pernas && cc.est.met >= 6);
    for (const tr of dia.treinos) {
      if (tr.inicio == null) continue;
      const antes = cc.fim <= tr.inicio + 10 && tr.inicio - cc.fim <= 180;
      const depois = cc.inicio >= (tr.fim ?? tr.inicio) - 10;
      if (antes && forte && cc.c.minutos > 15)
        add({
          id: `cardio_antes_${cc.c.id}`,
          area: 'cardio',
          tipo: 'melhorar',
          prioridade: 2,
          texto: `${def.label} ${cc.est.intensidade} de ${cc.c.minutos} min **antes** da musculação ${tr.s.key}.`,
          porque: 'Musculação primeiro e aeróbico depois (ou separados por 6 h ou mais) dá mais ganho de força, principalmente nas pernas. Aquecimento leve de 5 a 10 min antes não atrapalha.',
          fonte: [FONTE.MURLASITS, FONTE.ROBINEAU],
        });
      else if (antes && !forte && cc.c.minutos <= 15) add({ id: `cardio_aquecimento_${cc.c.id}`, area: 'cardio', tipo: 'bom', prioridade: 3, texto: `${def.label} leve de ${cc.c.minutos} min antes do treino: bom aquecimento, não atrapalha a força.` });
      else if (depois) add({ id: `cardio_depois_${cc.c.id}`, area: 'cardio', tipo: 'bom', prioridade: 3, texto: `Cardio depois da musculação ${tr.s.key}: ordem certa para não perder força.`, fonte: [FONTE.MURLASITS] });
    }
  }
  const amanha = Object.values(d.sessions).find((s) => s.status === 'pendente' && s.dataAtual === addDays(dia.date, 1));
  const amanhaPernas = amanha && treinoCalc(d, amanha, b).pernas;
  const pernasForte = dia.cardio.filter((x) => x.def.pernas && (x.est.intensidade === 'intensa' || x.def.impacto) && x.c.minutos >= 20);
  if (amanha && amanhaPernas && pernasForte.length)
    add({
      id: 'cardio_vespera_pernas',
      area: 'cardio',
      tipo: 'melhorar',
      prioridade: 2,
      texto: `Amanhã é **${amanha.key} · ${amanha.titulo}** e hoje teve ${pernasForte.map((x) => `${x.def.label.toLowerCase()} ${x.est.intensidade}`).join(' e ')}. Pernas cansadas rendem menos no treino.`,
      porque: 'A interferência do aeróbico na força cai quando há cerca de 24 h de intervalo; na véspera de pernas prefira cardio leve ou sem impacto (bike leve, elíptico, caminhada).',
      fonte: [FONTE.ROBINEAU, FONTE.WILSON],
    });
  // Treino de pernas ainda por fazer hoje, depois de cardio forte de pernas.
  const pendenteHoje = Object.values(d.sessions).find((s) => (s.status === 'pendente' || (s.status === 'em_andamento' && !s.inicio)) && s.dataAtual === dia.date);
  if (!fim && pendenteHoje && treinoCalc(d, pendenteHoje, b).pernas) {
    const feito = dia.cardio.filter((x) => x.def.pernas && (x.est.intensidade !== 'leve' || x.def.impacto) && x.c.minutos >= 20);
    if (feito.length)
      add({
        id: 'cardio_antes_pernas_hoje',
        area: 'cardio',
        tipo: 'melhorar',
        prioridade: 1,
        texto: `Hoje ainda tem **${pendenteHoje.key} · ${pendenteHoje.titulo}** e você já fez ${feito.map((x) => `${x.def.label.toLowerCase()} de ${x.c.minutos} min`).join(' e ')}. Se der, deixe 6 h ou mais entre os dois, coma carboidrato e proteína antes e aceite carga um pouco menor nas primeiras séries.`,
        porque: 'Aeróbico de pernas antes da musculação reduz o rendimento da força; com 6 a 24 h de intervalo a interferência cai.',
        fonte: [FONTE.ROBINEAU, FONTE.MURLASITS],
      });
  }
  const descansoReal = !dia.treinos.length && (fim || !pendenteHoje);
  if (descansoReal && dia.cardio.length && dia.cardio.every((x) => x.est.intensidade !== 'intensa' && !x.def.impacto && x.c.minutos <= 60))
    add({ id: 'cardio_descanso', area: 'cardio', tipo: 'bom', prioridade: 3, texto: 'Cardio leve ou moderado, sem impacto, em dia sem musculação: soma gasto sem atrapalhar a recuperação.' });

  // kcal do aparelho
  for (const cc of dia.cardio) {
    const ap = Number(cc.c.kcalAparelho) || 0;
    if (ap > cc.est.kcal * 1.2)
      add({ id: `cardio_aparelho_${cc.c.id}`, area: 'cardio', tipo: 'dica', prioridade: 3, texto: `${cc.def.label}: o aparelho mostrou ${f0(ap)} kcal; pelo seu peso a estimativa é ~${f0(cc.est.kcal)} kcal. Painéis e relógios costumam exagerar: use o número menor para decidir quanto comer.`, fonte: [FONTE.SHCHERBINA] });
  }

  // hidratação
  const totalExercicio = dia.cardioMin + dia.treinos.reduce((n, x) => n + x.minutos, 0);
  if (dia.cardioMin >= 45 || totalExercicio >= 100) {
    const agua = habitsMatching(d, dia.date, RE.aguaHabito);
    const faltouAgua = agua.find((h) => !isDone(d, h.id, dia.date));
    add({
      id: 'hidratacao',
      area: 'recuperacao',
      tipo: faltouAgua && fim ? 'melhorar' : 'dica',
      prioridade: 3,
      texto: `${f0(totalExercicio)} min de exercício hoje: beba cerca de 400 a 800 ml por hora de cardio e reponha depois.${faltouAgua ? ` O hábito **${faltouAgua.nome}** ${fim ? 'não foi marcado' : 'ainda está pendente'}.` : ''}`,
      fonte: [FONTE.ACSM_HIDRATACAO],
    });
  }

  // hábito de cardio × registro de cardio
  for (const h of habitsMatching(d, dia.date, RE.cardioHabito)) {
    const feito = isDone(d, h.id, dia.date);
    if (feito && !dia.cardio.length)
      add({ id: `habito_cardio_${h.id}`, area: 'registro', tipo: 'dica', prioridade: 2, texto: `Você marcou **${h.nome}**, mas não registrou o cardio em Treino. Registre para o app contar o gasto e a interação com a musculação.` });
    else if (!feito && dia.cardio.length) add({ id: `habito_cardio_marcar_${h.id}`, area: 'habitos', tipo: 'dica', prioridade: 3, texto: `Cardio registrado: marque o hábito **${h.nome}** para não quebrar a ofensiva.` });
  }

  // ---------- musculação do dia
  for (const tr of dia.treinos) {
    const sets = Object.values(d.sets).filter((x) => x.sessionId === tr.s.id && x.status === 'feita' && x.tipo === 'trabalho');
    if (!sets.length) continue;
    if (sets.some((x) => x.dorTipo === 'alerta')) add({ id: `dor_alerta_${tr.s.id}`, area: 'treino', tipo: 'alerta', prioridade: 1, texto: 'Sintoma de alerta no treino (dor no peito, desmaio ou falta de ar). Procure avaliação antes de treinar de novo.' });
    else if (sets.some((x) => x.dor)) add({ id: `dor_${tr.s.id}`, area: 'treino', tipo: 'melhorar', prioridade: 1, texto: `Dor registrada no treino ${tr.s.key}: a progressão desse exercício fica suspensa até melhorar.` });
    const comRir = sets.filter((x) => x.rir != null);
    const falha = comRir.filter((x) => x.rir === 0).length;
    if (comRir.length >= 4 && falha / comRir.length >= 0.5)
      add({
        id: `falha_${tr.s.id}`,
        area: 'treino',
        tipo: 'melhorar',
        prioridade: 2,
        texto: `${falha} de ${comRir.length} séries até a falha no treino ${tr.s.key}.`,
        porque: 'Parar com 1 a 3 repetições de reserva dá hipertrofia parecida com menos fadiga, o que ajuda ainda mais quando há cardio e déficit.',
        fonte: [FONTE.REFALO],
      });
    const descansos = sets
      .filter((x) => x.posicao > 1 && x.intervaloSeg != null && getEx(x.exerciseId).composto)
      .map((x) => x.intervaloSeg!)
      .sort((a, b2) => a - b2);
    if (descansos.length >= 3) {
      const med = descansos[Math.floor(descansos.length / 2)];
      if (med < 90)
        add({ id: `descanso_${tr.s.id}`, area: 'treino', tipo: 'melhorar', prioridade: 2, texto: `Descanso típico de ${f0(med)} s nos exercícios compostos do treino ${tr.s.key}.`, porque: 'Descansar 2 a 3 min nos compostos deu mais força e massa do que 1 min, porque mantém as repetições nas séries seguintes.', fonte: [FONTE.SCHOENFELD_DESCANSO] });
    }
    const progrediu = progressOf(d, tr.s, sets);
    if (progrediu.length)
      add({ id: `progresso_${tr.s.id}`, area: 'treino', tipo: 'bom', prioridade: 2, texto: `Progresso no treino ${tr.s.key} em relação à última vez: ${progrediu.slice(0, 4).join(', ')}.` });
  }
}

/** Exercícios que melhoraram (força estimada pela melhor série) em relação à vez anterior. */
function progressOf(d: AppData, s: Session, sets: SetLog[]): string[] {
  const out: string[] = [];
  const e1 = (x: SetLog) => (x.carga ?? 0) * (1 + (x.reps ?? 0) / 30);
  const porEx = new Map<string, SetLog[]>();
  for (const x of sets) if (x.carga != null && x.base !== 'assistencia') porEx.set(x.exerciseId, [...(porEx.get(x.exerciseId) ?? []), x]);
  for (const [ex, xs] of porEx) {
    const primeiro = Math.min(...xs.map((x) => x.confirmadoEm));
    const prev = exposures(d.sets, ex, undefined, s.id).find((e) => e.em < primeiro && e.trabalho.length);
    if (!prev) continue;
    const agora = Math.max(...xs.map(e1));
    const antes = Math.max(...prev.trabalho.map(e1));
    if (antes > 0 && agora > antes * 1.005) out.push(`${getEx(ex).nome.toLowerCase()} (+${f1(((agora - antes) / antes) * 100)}%)`);
  }
  return out;
}

// ---------------------------------------------------------------- regras da semana

function weekInsights(d: AppData, dia: CoachDay, w: CoachWeek, out: Insight[]) {
  const add = (i: Insight) => out.push(i);
  const b = dia.body;
  const semanaCheia = w.dias >= 7;
  const periodo = semanaCheia ? 'nos últimos 7 dias' : `nos ${w.dias} dias de registro`;

  if (semanaCheia && w.minutosOms < 150)
    add({ id: 'oms_baixo', area: 'cardio', tipo: 'melhorar', prioridade: 3, texto: `**${f0(w.minutosOms)} min** de cardio moderado-equivalente ${periodo} (minutos intensos contam em dobro). A recomendação é 150 a 300.`, porque: 'Além da musculação, 150 a 300 min por semana de aeróbico moderado reduzem risco cardiovascular e ajudam no gasto.', fonte: [FONTE.OMS_ATIVIDADE] });
  else if (w.minutosOms >= 150 && w.minutosOms <= 420)
    add({ id: 'oms_ok', area: 'cardio', tipo: 'bom', prioridade: 3, texto: `**${f0(w.minutosOms)} min** de cardio moderado-equivalente ${periodo}: dentro da recomendação (150 a 300) sem exagero.`, fonte: [FONTE.OMS_ATIVIDADE] });
  if (w.minutosOms > 420 || w.intensas > 3)
    add({
      id: 'cardio_excesso',
      area: 'cardio',
      tipo: 'melhorar',
      prioridade: 2,
      texto: `Muito cardio ${periodo}: ${f0(w.cardioMin)} min${w.intensas ? `, ${w.intensas} ${w.intensas === 1 ? 'sessão intensa' : 'sessões intensas'}` : ''}.`,
      porque: 'Pouca interferência aparece com cardio moderado, mas frequência e duração altas, sobretudo intensas, reduzem o ganho de força e massa e somam fadiga.',
      fonte: [FONTE.WILSON, FONTE.SCHUMANN],
    });
  if (w.corridaMin >= 90 && w.corridaMin >= w.cardioMin * 0.5)
    add({ id: 'corrida_interferencia', area: 'cardio', tipo: 'dica', prioridade: 3, texto: `${f0(w.corridaMin)} min de corrida ou tiros ${periodo}. Para quem quer ganhar ou manter músculo, bike, elíptico e esteira inclinada atrapalham menos que corrida.`, fonte: [FONTE.WILSON] });

  if (w.perdaPctSemana != null && w.saldoMedio != null && b) {
    const kg = (-w.saldoMedio * 7) / 7700;
    if (w.perdaPctSemana > 1)
      add({ id: 'ritmo_rapido', area: 'energia', tipo: 'melhorar', prioridade: 1, texto: `Déficit médio de ~${f0(-w.saldoMedio)} kcal/dia ${periodo}: ritmo estimado de **${f1(kg)} kg por semana (${f1(w.perdaPctSemana)}% do peso)**, rápido demais.`, porque: 'Acima de ~1% do peso por semana a perda de massa magra aumenta; quem perdeu 0,7%/semana manteve mais músculo e força do que quem perdeu 1,4%.', fonte: [FONTE.GARTHE, FONTE.HELMS] });
    else if (w.perdaPctSemana >= 0.4)
      add({ id: 'ritmo_ok', area: 'energia', tipo: 'bom', prioridade: 2, texto: `Ritmo estimado de **${f1(kg)} kg por semana (${f1(w.perdaPctSemana)}% do peso)**: na faixa que preserva músculo. Confirme na balança pela média da semana.`, fonte: [FONTE.HELMS] });
    else if (w.perdaPctSemana > 0)
      add({ id: 'ritmo_lento', area: 'energia', tipo: 'dica', prioridade: 3, texto: `Ritmo estimado de ${f2(kg)} kg por semana: lento, bom para recomposição (perder gordura e ganhar músculo ao mesmo tempo). Se a balança não mexer em 2 a 3 semanas, ajuste.` });
  }

  // compensação nos dias de cardio e fins de semana (14 dias)
  const dias14: CoachDay[] = [];
  for (let x = addDays(dia.date, -13); x <= dia.date; x = addDays(x, 1)) {
    if (x >= todayISO()) continue;
    const c = coachDay(d, x);
    if (c.registroCompleto) dias14.push(c);
  }
  const media = (xs: CoachDay[]) => xs.reduce((n, x) => n + x.totals.calorias, 0) / xs.length;
  const comCardio = dias14.filter((x) => x.cardioLiq >= 200);
  const semCardio = dias14.filter((x) => x.cardioLiq < 50);
  if (comCardio.length >= 2 && semCardio.length >= 2) {
    const dif = media(comCardio) - media(semCardio);
    const gasto = comCardio.reduce((n, x) => n + x.cardioLiq, 0) / comCardio.length;
    if (dif > gasto * 0.7)
      add({ id: 'compensacao', area: 'energia', tipo: 'melhorar', prioridade: 2, texto: `Nos dias com cardio você comeu em média **${f0(dif)} kcal a mais**, quase tudo o que o cardio gastou (~${f0(gasto)}).`, porque: 'É comum comer de volta parte do gasto do exercício sem perceber; é por isso que o cardio sozinho emagrece menos que o esperado.', fonte: [FONTE.THOMAS_COMPENSACAO] });
  }
  const fds = dias14.filter((x) => [0, 6].includes(dow(x.date)));
  const uteis = dias14.filter((x) => ![0, 6].includes(dow(x.date)));
  if (fds.length >= 1 && uteis.length >= 3) {
    const dif = media(fds) - media(uteis);
    if (dif > 400)
      add({ id: 'fim_de_semana', area: 'energia', tipo: 'melhorar', prioridade: 2, texto: `No fim de semana você come em média **${f0(dif)} kcal a mais** que nos dias úteis: parte do déficit da semana some aí.`, fonte: [FONTE.RACETTE] });
  }

  if (w.treinosPerdidos) add({ id: 'treinos_perdidos', area: 'treino', tipo: 'melhorar', prioridade: 2, texto: `${w.treinosPerdidos} ${w.treinosPerdidos === 1 ? 'treino não feito' : 'treinos não feitos'} ${periodo}. Consistência pesa mais que qualquer detalhe de dieta ou série.` });
  else if (w.treinosFeitos >= 2) add({ id: 'treinos_ok', area: 'treino', tipo: 'bom', prioridade: 2, texto: `${w.treinosFeitos} treinos de musculação feitos ${periodo}, sem falta.` });

  const incompletos = w.diasIncompletos.filter((x) => coachDay(d, x).meals.length > 0 || Object.values(d.sessions).some((s) => (s.dataReal ?? s.dataAtual) === x));
  if (incompletos.length)
    add({ id: 'registro_incompleto', area: 'registro', tipo: 'dica', prioridade: 3, texto: `Dias com menos de 3 refeições registradas: ${incompletos.map((x) => x.slice(8) + '/' + x.slice(5, 7)).join(', ')}. Registro incompleto deixa a análise de energia errada.` });
}

// ---------------------------------------------------------------- relatório

const ORDEM: Record<InsightTipo, number> = { alerta: 0, melhorar: 1, bom: 2, dica: 3 };

export function coachReport(d: AppData, date = todayISO()): CoachReport {
  const dia = coachDay(d, date);
  const semana = coachWeek(d, date);
  const insights: Insight[] = [];
  dayInsights(d, dia, insights);
  weekInsights(d, dia, semana, insights);
  const vistos = new Set<string>();
  const unicos = insights.filter((i) => (vistos.has(i.id) ? false : (vistos.add(i.id), true)));
  unicos.sort((a, b) => a.prioridade - b.prioridade || ORDEM[a.tipo] - ORDEM[b.tipo]);

  const perguntas: string[] = [];
  if (!habitsMatching(d, date, RE.sonoHabito).length)
    perguntas.push(`Sono: o app não mede. Dormir 7 a 9 h muda o resultado do déficit (${FONTE.NEDELTCHEVA}).`);
  perguntas.push('Peso na balança: pesar 3 a 7 vezes por semana, de manhã, e olhar a média semanal confirma se o déficit estimado é real.');
  perguntas.push('Passos e movimento fora do treino (trabalho, deslocamento): mudam o gasto em centenas de kcal e o app não mede.');
  if (!habitsMatching(d, date, RE.aguaHabito).length) perguntas.push('Água: o app não mede; cerca de 35 ml por kg por dia, mais nos dias de cardio.');
  return { date, dia, semana, insights: unicos, perguntas, limiteKcal: d.settings.limits.calorias };
}

const TIPO_LABEL: Record<InsightTipo, string> = { alerta: 'ALERTA', melhorar: 'MELHORAR', bom: 'BOM', dica: 'DICA' };

/** Texto do relatório para a IA. */
export function coachText(r: CoachReport): string {
  const { dia, semana: w } = r;
  const b = dia.body;
  const t = dia.totals;
  const corpo = b
    ? `${f0(b.peso)} kg, ${f0(b.altura)} cm, ${f0(b.idade)} anos; metabolismo basal ~${f0(b.tmb)} kcal (Mifflin-St Jeor); gordura estimada pelo IMC ~${f0(b.gorduraPct)}% (Deurenberg), massa magra ~${f0(b.massaMagra)} kg; FC máxima ~${f0(b.fcMax)} bpm (Tanaka)`
    : 'peso não informado no perfil (estimativas de gasto ficam imprecisas)';
  const cardio = dia.cardio.length
    ? dia.cardio
        .map(
          (x) =>
            `- ${x.def.label}, ${x.c.minutos} min, ${x.est.intensidade}, ${x.c.hora}–${hhmm(x.fim)}: ~${f0(x.est.kcal)} kcal (~${f0(x.est.kcalLiquida)} acima do repouso), ${f1(x.est.met)} METs por ${METODO_LABEL[x.est.metodo]}${x.est.velocidadeKmh ? `, ${f1(x.est.velocidadeKmh)} km/h` : ''}${x.c.inclinacao ? `, inclinação ${f1(x.c.inclinacao)}%` : ''}${x.c.watts ? `, ${f0(x.c.watts)} W` : ''}${x.est.pctFcMax ? `, FC ${f0(x.c.fcMedia!)} bpm (${f0(x.est.pctFcMax)}% da máxima)` : ''}${x.c.kcalAparelho ? `, aparelho mostrou ${f0(x.c.kcalAparelho)} kcal` : ''}${x.c.obs ? `, obs: ${x.c.obs}` : ''}`,
        )
        .join('\n')
    : '- nenhum registrado';
  const treinos = dia.treinos.length
    ? dia.treinos.map((x) => `- ${x.s.key} · ${x.s.titulo} (${x.s.status}), ${f0(x.minutos)} min${x.inicio != null ? `, ${hhmm(x.inicio)}–${x.fim != null ? hhmm(x.fim) : '?'}` : ''}${x.pernas ? ', com pernas' : ''}: ~${f0(x.kcalLiquida)} kcal acima do repouso`).join('\n')
    : '- nenhuma';
  const gastoTxt = `gasto estimado ~${f0(dia.gasto)} kcal = vida diária ~${f0(dia.gastoBase)} (basal × ${String(FATOR_DIA).replace('.', ',')}) + cardio ~${f0(dia.cardioLiq)} + musculação ~${f0(dia.musculacaoLiq)}`;
  const limite = r.limiteKcal;
  const energia = !b
    ? '-'
    : dia.finished
      ? `${gastoTxt}; consumo ${f0(t.calorias)} kcal; saldo ${dia.saldo >= 0 ? '+' : '−'}${f0(Math.abs(dia.saldo))} kcal${dia.disponibilidade != null ? `; disponibilidade de energia ~${f0(dia.disponibilidade)} kcal/kg de massa magra` : ''}`
      : `${gastoTxt}; consumo até agora ${f0(t.calorias)} kcal (o dia não acabou: NÃO trate a diferença como déficit do dia); se ele comer até o limite de ${f0(limite)} kcal, o saldo do dia fica ${limite - dia.gasto >= 0 ? '+' : '−'}${f0(Math.abs(limite - dia.gasto))} kcal`;
  const comida = `${f0(t.calorias)} kcal; proteína ${f0(t.proteina)} g (${f2(dia.protKg)} g/kg); carboidrato ${f0(t.carboidratos)} g (${f2(dia.carbKg)} g/kg); gordura ${f0(t.gordura)} g (${f2(dia.gordKg)} g/kg); fibras ${f1(t.fibras)} g; açúcar adicionado ${f1(t.acucar)} g; saturada ${f1(t.saturada)} g; sódio ${f0(t.sodio)} mg; ${dia.meals.length} refeições`;
  const semana = `${w.de} a ${w.ate} (${w.dias} ${w.dias === 1 ? 'dia' : 'dias'} com histórico): cardio ${f0(w.cardioMin)} min em ${w.sessoesCardio} sessões, ${f0(w.minutosOms)} min moderado-equivalente (OMS: 150–300/semana), ${w.intensas} intensas, ${f0(w.corridaMin)} min de corrida/tiros; musculação ${w.treinosFeitos} feitas, ${w.treinosPerdidos} perdidas; ${w.diasCompletos} dias com alimentação completa${w.saldoMedio != null ? `; saldo médio ${w.saldoMedio >= 0 ? '+' : '−'}${f0(Math.abs(w.saldoMedio))} kcal/dia → ritmo estimado ${f1(w.perdaPctSemana ?? 0)}% do peso por semana` : ''}`;
  const pontos = r.insights
    .map((i) => `- [${TIPO_LABEL[i.tipo]} · ${i.area}] ${i.texto.replace(/\*\*/g, '')}${i.porque ? ` | por quê: ${i.porque}` : ''}${i.fonte?.length ? ` | fonte: ${i.fonte.join('; ')}` : ''}`)
    .join('\n');
  return `ANÁLISE DO COACH (calculada pelo app com regras baseadas em estudos; gastos e déficit são estimativas com erro de 10 a 20%)
DIA ANALISADO: ${r.date}${dia.finished ? ' (dia encerrado)' : ` (hoje, agora ${nowHHMM()})`}
CORPO: ${corpo}
ALIMENTAÇÃO DO DIA: ${comida}
CARDIO DO DIA
${cardio}
MUSCULAÇÃO DO DIA
${treinos}
ENERGIA: ${energia}
SEMANA: ${semana}
PONTOS EM ORDEM DE IMPORTÂNCIA
${pontos || '- nada a apontar'}
O QUE O APP NÃO MEDE (pergunte no máximo um por conversa)
${r.perguntas.map((p) => `- ${p}`).join('\n')}`;
}
