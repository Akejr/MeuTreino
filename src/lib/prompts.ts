import { activeHabits, habitStats, isActiveOn, isDone, perfectStreak } from '../habits/habits';
import type { AppData, ChatMsg, DietDraft, Food, Meal, PlanVersion, Session } from '../types';
import { dietDay, fullTotals, NIVEL_LABEL, targets, type FullTotals, type Issue } from './nutrition';
import { cardioBetween, cardioOn } from '../cardio/cardio';
import { coachReport, coachText } from '../coach/coach';
import { bodyOf, cardioDef, estimateCardio } from '../coach/energy';
import { BY_ID, CATALOG, getEx, GRUPO_LABEL, isActive, QUESTIONS, resolveExercise } from '../training/catalog';
import {
  estimateSession,
  exposures,
  planVolume,
  realizedVolume,
  rirCurto,
  sessionSteps,
  stepCtx,
  suggestNext,
  unitOf,
  type Volume,
} from '../training/engine';
import { activePlan, nextSession, planSessionOf, weekView } from '../training/schedule';
import type { AIMessage } from './openrouter';
import { evaluateDay, mealsOf, STATUS_LABEL } from './score';
import { addDays, daysOfMonth, formatLong, nowHHMM, r0, r1, todayISO, weekStart, weekdayName } from './utils';

// ===================== blocos de contexto =====================

export function perfilTexto(data: AppData): string {
  const p = data.settings.profile;
  const t = data.settings.training;
  const linhas = [
    p.nome && `Nome: ${p.nome}`,
    p.sexo && `Sexo: ${p.sexo}`,
    p.idade && `Idade: ${p.idade}`,
    p.peso && `Peso: ${p.peso} kg`,
    p.altura && `Altura: ${p.altura} cm`,
    p.objetivo && `Objetivo: ${p.objetivo}`,
    p.nivel && `Experiência: ${p.nivel}`,
    p.observacoes && `Restrições e observações: ${p.observacoes}`,
    `Duração alvo da sessão: ${t.duracaoMin} min`,
    `Dias: ${t.dias.map((x, i) => `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][i]}=${x}`).join(', ')}`,
  ].filter(Boolean);
  return linhas.join('\n');
}

export function limitesTexto(data: AppData): string {
  const L = data.settings.limits;
  return `Calorias máx: ${L.calorias} kcal | Proteína meta: ${L.proteina} g | Gordura máx: ${L.gordura} g | Carboidratos máx: ${L.carboidratos} g`;
}

function volumeTexto(v: Volume): string {
  return Object.entries(v)
    .map(([g, x]) => `${GRUPO_LABEL[g as keyof typeof GRUPO_LABEL]}: ${x!.diretas} diretas, ${x!.indiretas} indiretas`)
    .join('; ');
}

function exNome(id: string) {
  return getEx(id).nome;
}

/** Último desempenho e meta calculada de cada exercício da sessão. */
function sessionPlanText(data: AppData, s: Session, hoje: string): string {
  const ps = planSessionOf(data, s);
  if (!ps) return '';
  const t = data.settings.training;
  return ps.slots
    .map((slot) => {
      const exId = resolveExercise(slot.exerciseId, t) ?? slot.exerciseId;
      const ctx = stepCtx(data, slot, exId, hoje, s.id);
      const lados = getEx(exId).unilateral ? (['D', 'E'] as const) : [undefined];
      const partes = lados.map((l) => {
        const p = suggestNext(exId, l, ctx);
        const u = unitOf(ctx.eq);
        const ult = p.ultima ? `última ${p.ultima.data}: ${p.ultima.cargas.map((c) => c ?? '?').join('/')} ${u} × ${p.ultima.reps.join('/')}` : 'sem histórico';
        return `${l ? `lado ${l}: ` : ''}${ult}; decisão do app: ${p.motivo}`;
      });
      return `- ${exNome(exId)} ${slot.series}×${slot.repMin}–${slot.repMax}, RIR ${slot.rirMin}–${slot.rirMax}, descanso ${slot.descansoSeg}s. ${partes.join(' | ')}`;
    })
    .join('\n');
}

export function trainingContext(data: AppData, hoje = todayISO()): string {
  const plan = activePlan(data);
  const prox = nextSession(data);
  const semana = weekView(data, hoje)
    .map((c) => {
      const ss = c.sessoes.map((s) => `${s.key} ${s.titulo} (${s.status})`).join(', ');
      const ff = c.faltas.length ? ` faltas: ${c.faltas.map((s) => s.key).join(', ')}` : '';
      return `${weekdayName(c.date)} ${c.date}: ${ss || 'livre'}${ff}`;
    })
    .join('\n');
  const w = weekStart(hoje);
  const feito = realizedVolume(data.sets, w, addDays(w, 6));
  return `FICHA ATIVA: ${plan ? `${plan.nome} (v${plan.versao})` : 'nenhuma'}
VOLUME PREVISTO POR SEMANA: ${plan ? volumeTexto(planVolume(plan, data.settings.training)) : '-'}
VOLUME FEITO NESTA SEMANA: ${volumeTexto(feito) || 'nada ainda'}
CARDIO NOS ÚLTIMOS 7 DIAS: ${
    cardioBetween(data, addDays(hoje, -6), hoje)
      .map((c) => `${c.date} ${cardioLinha(data, c)}`)
      .join('; ') || 'nenhum registrado'
  }

AGENDA DA SEMANA
${semana}

PRÓXIMA SESSÃO: ${prox ? `${prox.key} · ${prox.titulo} em ${prox.dataAtual} (${prox.status}), estimativa ${Math.round(estimateSession(planSessionOf(data, prox)!, data.settings.training))} min` : 'nenhuma'}
${prox ? sessionPlanText(data, prox, hoje) : ''}`;
}

export function sessionContext(data: AppData, sessionId: string, hoje = todayISO()): string {
  const s = data.sessions[sessionId];
  const ps = s && planSessionOf(data, s);
  if (!s || !ps) return trainingContext(data, hoje);
  const steps = sessionSteps(ps, s, data.settings.training);
  const feitas = steps
    .map((st) => ({ st, set: data.sets[st.id] }))
    .filter((x) => x.set)
    .map(
      ({ st, set }) =>
        `- ${exNome(st.exerciseId)} · ${st.tipo} ${st.posicao}${st.lado ? ` lado ${st.lado}` : ''}: ${set!.status === 'pulada' ? 'pulada' : `${set!.carga ?? '-'} ${set!.unidade} × ${set!.reps ?? '-'} reps, reserva ${rirCurto(set!)}${set!.ajuste ? ', peso ajustado na sessão' : ''}${set!.ajuda ? ', com ajuda' : ''}${set!.dor ? `, DOR (${set!.dorTipo})` : ''}`}`,
    );
  const pend = steps.filter((st) => !data.sets[st.id] && (s.slots[st.slotId]?.status ?? 'ativo') === 'ativo');
  return `SESSÃO EM ANDAMENTO: ${s.key} · ${s.titulo} (${s.status}), início ${s.inicio ? new Date(s.inicio).toLocaleTimeString('pt-BR') : '-'}
PRÓXIMA SÉRIE: ${pend[0] ? `${exNome(pend[0].exerciseId)} · ${pend[0].tipo} ${pend[0].posicao}${pend[0].lado ? ` lado ${pend[0].lado}` : ''}` : 'nenhuma, sessão completa'}
SÉRIES DE HOJE
${feitas.join('\n') || '(nenhuma ainda)'}
VAGAS COM TROCA, PULO OU DOR: ${
    Object.entries(s.slots)
      .filter(([, st]) => st.trocas.length || st.status !== 'ativo')
      .map(([id, st]) => `${id}: ${st.status}${st.trocas.length ? `, trocas ${st.trocas.map((t) => `${exNome(t.de)}→${exNome(t.para)} (${t.motivo})`).join(', ')}` : ''}`)
      .join('; ') || 'nenhuma'
  }

PLANO E HISTÓRICO
${sessionPlanText(data, s, hoje)}`;
}

export function fichaContext(data: AppData): string {
  const plan = activePlan(data);
  if (!plan) return 'Sem ficha ativa.';
  return `${planText(plan, data)}

VOLUME PREVISTO: ${volumeTexto(planVolume(plan, data.settings.training))}
VOLUME FEITO NAS ÚLTIMAS 2 SEMANAS: ${volumeTexto(realizedVolume(data.sets, addDays(todayISO(), -13), todayISO())) || 'nada'}
ADESÃO (4 semanas): ${adesaoTexto(data)}`;
}

function planText(plan: PlanVersion, data: AppData): string {
  const t = data.settings.training;
  return `FICHA ${plan.nome} v${plan.versao} (${plan.origem}, desde ${plan.vigenciaInicio})
${plan.sessoes
  .map(
    (s) =>
      `${s.key} · ${['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'][s.dia]} · ${s.titulo} (~${Math.round(estimateSession(s, t))} min)\n${s.slots
        .map((sl) => `  - ${exNome(resolveExercise(sl.exerciseId, t) ?? sl.exerciseId)} [${sl.exerciseId}] ${sl.series}×${sl.repMin}–${sl.repMax}, descanso ${sl.descansoSeg}s, prioridade ${sl.prioridade}`)
        .join('\n')}`,
  )
  .join('\n')}`;
}

function adesaoTexto(data: AppData): string {
  const ini = addDays(todayISO(), -27);
  const ss = Object.values(data.sessions).filter((s) => s.dataOriginal >= ini && s.dataOriginal <= todayISO());
  const feitas = ss.filter((s) => s.status === 'concluida').length;
  const parciais = ss.filter((s) => s.status === 'parcial').length;
  const faltas = ss.filter((s) => s.status === 'falta' || s.historicoDatas.some((h) => h.motivo === 'falta')).length;
  return `${feitas} concluídas, ${parciais} parciais, ${faltas} com falta, de ${ss.length} previstas`;
}

export function dietContext(data: AppData, date: string): string {
  const meals = mealsOf(data, date);
  const draft = data.dietDraft?.date === date ? data.dietDraft : null;
  const ev = evaluateDay(data, date);
  const diet = dietDay(data, meals, date < todayISO());
  const T = targets(data);
  return `DIETA DE ${formatLong(date)} (${date})${date === todayISO() ? `, dia em andamento, agora ${nowHHMM()}` : ''}
METAS: ${limitesTexto(data)} | fibras ${T.fibra} g ou mais | açúcar adicionado até ${T.acucar} g | saturada até ${T.saturada} g | sódio até ${T.sodio} mg | proteína por refeição ~${T.protRefeicao} g | até ${T.refeicaoMaxPct}% das kcal por refeição
TOTAL SALVO: ${fullText(diet.totals)}
REFEIÇÕES
${meals.map((m) => mealLine(data, m)).join('\n') || '(nenhuma)'}
${draft?.itens.length ? `RASCUNHO NÃO SALVO: ${draft.itens.map((i) => i.nome).join(', ')}` : ''}
FALHAS CALCULADAS PELO APP
${issuesText(ev.issues.filter((i) => i.area === 'dieta')) || '(nenhuma)'}
AINDA FALTA HOJE: ${diet.pendentes.join(' ').replace(/\*\*/g, '') || '-'}
ACERTOS: ${diet.acertos.join(' ') || '-'}
QUALIDADE (só acompanhamento, não muda a nota do dia): ${diet.acompanhamento.join(' ').replace(/\*\*/g, '') || '-'}
${diet.notas.length ? `OBS: ${diet.notas.join(' ')}` : ''}
TREINO DO DIA: ${trainingOfDay(data, date)}
ALIMENTOS CADASTRADOS: ${Object.values(data.foods).map((f) => f.nome).join(', ') || 'nenhum'}`;
}

/** "Esteira inclinada 30 min moderada (~250 kcal)". */
export function cardioLinha(data: AppData, c: ReturnType<typeof cardioOn>[number]): string {
  const est = estimateCardio(c, bodyOf(data.settings.profile));
  return `${cardioDef(c.tipo).label} ${c.minutos} min ${est.intensidade} às ${c.hora} (~${r0(est.kcal)} kcal)`;
}

function trainingOfDay(data: AppData, date: string): string {
  const ev = evaluateDay(data, date);
  const cardio = cardioOn(data, date);
  const c = cardio.length ? `; cardio: ${cardio.map((x) => cardioLinha(data, x)).join(', ')}` : '; sem cardio registrado';
  if (ev.treinos.length) return ev.treinos.map((s) => `${s.key} ${s.titulo} (${s.status})`).join(', ') + c;
  const plan = Object.values(data.sessions).find((s) => s.dataAtual === date && s.status === 'pendente');
  return (plan ? `${plan.key} ${plan.titulo} marcado` : 'nenhuma musculação') + c;
}

export function monthContext(data: AppData, month: string, selected?: string): string {
  const dias = daysOfMonth(month)
    .filter((d) => d <= todayISO())
    .map((d) => {
      const ev = evaluateDay(data, d);
      if (ev.status === 'empty') return null;
      const q = fullTotals(ev.meals.flatMap((m) => m.itens));
      return {
        data: d,
        avaliacao: STATUS_LABEL[ev.status],
        falhas: ev.issues.map((i) => `[${NIVEL_LABEL[i.nivel]}] ${i.texto.replace(/\*\*/g, '')}`),
        acertos: ev.acertos,
        kcal: r0(ev.totals.calorias),
        prot: r0(ev.totals.proteina),
        gord: r0(ev.totals.gordura),
        carb: r0(ev.totals.carboidratos),
        fibras: r1(q.fibras),
        sodio: r0(q.sodio),
        acucar: r1(q.acucar),
        refeicoes: ev.meals.length,
        treino: ev.treinos.map((s) => `${s.key} ${s.status}`).join(', ') || (ev.faltas.length ? 'falta' : 'nenhum'),
        cardio: ev.cardio.map((c) => cardioLinha(data, c)).join(', ') || 'nenhum',
        qualidade_acompanhamento: ev.acompanhamento.map((x) => x.replace(/\*\*/g, '')),
      };
    })
    .filter(Boolean);
  const evolucao = CATALOG.filter((e) => !e.pergunta)
    .map((e) => {
      const ex = exposures(data.sets, e.id).filter((x) => x.trabalho.length && x.data.startsWith(month));
      if (!ex.length) return null;
      const fmt = (x: (typeof ex)[number]) => `${x.data}: ${x.trabalho.map((s) => `${s.carga ?? '-'}×${s.reps ?? '-'}`).join(' ')}`;
      return `- ${e.nome}: ${ex.length > 1 ? `${fmt(ex[ex.length - 1])} → ${fmt(ex[0])}` : fmt(ex[0])}`;
    })
    .filter(Boolean);
  return `MÊS ${month}${selected ? ` | dia selecionado: ${selected}` : ''} | hoje: ${todayISO()}
PERFIL
${perfilTexto(data)}
LIMITES: ${limitesTexto(data)}
DIAS COM REGISTRO
${dias.length ? JSON.stringify(dias) : '(nenhum)'}
EVOLUÇÃO DE CARGAS NO MÊS (primeira → última)
${evolucao.join('\n') || '(sem séries registradas)'}
ADESÃO AO TREINO (4 semanas): ${adesaoTexto(data)}
${habitsContext(data)}`;
}

export function configContext(data: AppData): string {
  const t = data.settings.training;
  const respostas = QUESTIONS.map((q) => `${q.pergunta} → ${t.respostas[q.id]?.map((id) => BY_ID[id]?.nome).join(', ') || 'sem resposta'}`).join('\n');
  return `AJUSTES
PERFIL
${perfilTexto(data)}
LIMITES DA DIETA: ${limitesTexto(data)}
LIMITE DE AUMENTO AUTOMÁTICO: ${t.limitePct}%
CATÁLOGO
${respostas}
Não gosto: ${t.naoGosto.map(exNome).join(', ') || 'nenhum'}
Equipamentos cadastrados: ${Object.values(data.equipment).length}`;
}

// ===================== nutrição =====================

export function nutriSystem(data: AppData): string {
  const T = targets(data);
  const p = data.settings.profile;
  return `Você é um nutricionista esportivo. Calcula cada refeição que o usuário registra (as dicas e a avaliação ficam com o coach do app, não com você).
Usuário: ${p.sexo || 'adulto'}, ${p.idade || '?'} anos, ${p.peso || '?'} kg, ${p.altura || '?'} cm, ${p.nivel || ''}. Objetivo: ${p.objetivo || 'saúde'}. Treina musculação 5 vezes por semana.
Metas do dia: calorias até ${T.calorias} kcal, proteína ${T.proteina} g (META), carboidratos até ${T.carboidratos} g, gordura até ${T.gordura} g (mínimo saudável ~${T.gorduraMin} g), fibras ${T.fibra} g ou mais, açúcar adicionado até ${T.acucar} g, gordura saturada até ${T.saturada} g, sódio até ${T.sodio} mg. Proteína por refeição principal: ~${T.protRefeicao} g (mínimo ${T.protMin} g). Nenhuma refeição deve passar de ${T.refeicaoMaxPct}% do limite de calorias.

CÁLCULO
- Referência: Tabela TACO (alimentos brasileiros); na falta, USDA FoodData Central. Produto industrializado conhecido: use o rótulo.
- ALIMENTOS CADASTRADOS: o usuário cadastrou os produtos que ele usa (marca e tabela do rótulo). Quando ele citar um alimento que corresponde a um cadastrado pelo nome ou apelido (ex.: "whey", "meu iogurte", "leite"), use OBRIGATORIAMENTE os valores do cadastro, proporcionais à quantidade (porção 200 ml e ele tomou 300 ml = 1,5 porção; 3 scoops com porção de 1 scoop = 3 porções). Preencha "alimento_id" com o id do cadastro. Se houver dois cadastros possíveis, use o mais provável e pergunte. Valor que o cadastro não tem (ex.: fibras): estime pela TACO.
- Quantidade não informada: assuma porção típica brasileira e deixe claro em "quantidade".
- Preparo: some o óleo ou a manteiga quando o preparo indicar (frito, à milanesa, refogado, na manteiga; 1 colher de sopa de óleo ≈ 108 kcal e 12 g de gordura). Se o preparo de um alimento que costuma levar óleo não foi dito, assuma caseiro com pouco óleo e diga.
- Alimento composto (ex.: "sucrilhos com leite", "x-burguer", "marmita"): separe em itens e use o cadastro de cada parte quando existir.
- Sempre devolva a LISTA COMPLETA e atualizada de itens da refeição em rascunho: mantenha os itens anteriores, aplique as correções pedidas e adicione os novos.
- Para cada item: calorias (kcal); proteina, carboidratos, gordura, fibras, acucar_adicionado e gordura_saturada em gramas (1 casa decimal); sodio em mg (inteiro); nova = classificação NOVA do Guia Alimentar (1 in natura ou minimamente processado, 2 ingrediente culinário como óleo, açúcar e sal, 3 processado, 4 ultraprocessado); suplemento = true para whey, caseína, albumina, creatina e similares.
- Açúcar adicionado é só o colocado no preparo ou pelo fabricante (açúcar, mel, xarope, achocolatado). O açúcar natural da fruta e do leite não conta.

FORMATO
Responda APENAS com um JSON válido, sem texto fora dele:
{"resposta": "cálculo item a item, curto, e o total; **negrito** no total e nos itens que vieram do cadastro; se houver ambiguidade, estime e pergunte", "itens": [{"nome": "Ovo cozido", "quantidade": "2 unidades (100 g)", "calorias": 146, "proteina": 13.3, "carboidratos": 0.6, "gordura": 9.5, "fibras": 0, "acucar_adicionado": 0, "gordura_saturada": 3.1, "sodio": 140, "nova": 1, "suplemento": false, "alimento_id": null}]}`;
}

export function foodsText(foods: Food[]): string {
  if (!foods.length) return '(nenhum alimento cadastrado)';
  const x = (label: string, v: number | undefined, u: string) => (typeof v === 'number' ? `, ${label} ${v} ${u}` : '');
  return foods
    .map(
      (f) =>
        `- id ${f.id} | ${f.nome}${f.apelidos ? ` (apelidos: ${f.apelidos})` : ''} | porção: ${f.porcao || `${f.porcaoQtd} ${f.porcaoUnidade}`} = ${f.porcaoQtd} ${f.porcaoUnidade} | ${f.calorias} kcal, P ${f.proteina} g, G ${f.gordura} g, C ${f.carboidratos} g${x('fibras', f.fibras, 'g')}${x('açúcar adicionado', f.acucar, 'g')}${x('saturada', f.saturada, 'g')}${x('sódio', f.sodio, 'mg')}${f.obs ? ` | obs: ${f.obs}` : ''}`,
    )
    .join('\n');
}

export const BACKFILL_SYSTEM = `Você é nutricionista. Estas refeições já foram registradas com calorias e macros conferidos. Estime SÓ os dados de qualidade de cada item, sem mudar calorias nem macros.
- Referência: Tabela TACO; na falta, USDA FoodData Central; produto industrializado conhecido: o rótulo.
- Item com alimento_id ou com nome igual a um alimento cadastrado: use os valores do cadastro, proporcionais à quantidade; o que o cadastro não tiver, estime pela TACO.
- fibras, acucar_adicionado e gordura_saturada em gramas (1 casa decimal); sodio em mg (inteiro); nova = classificação NOVA (1 in natura ou minimamente processado, 2 ingrediente culinário como óleo, açúcar e sal, 3 processado, 4 ultraprocessado); suplemento = true para whey, caseína, albumina, creatina e similares.
- Açúcar adicionado é só o colocado no preparo ou pelo fabricante; o açúcar natural da fruta e do leite não conta.
- Seja coerente com o item: gordura saturada não passa da gordura total; açúcar adicionado e fibras não passam dos carboidratos.
Responda APENAS com JSON válido: {"refeicoes": [{"id": "id da refeição", "itens": [{"id": "id do item", "fibras": 0, "acucar_adicionado": 0, "gordura_saturada": 0, "sodio": 0, "nova": 1, "suplemento": false}]}]}`;

/** Refeições antigas sem os dados de qualidade: a IA completa só o que falta. */
export function backfillMessages(data: AppData, meals: Meal[]): AIMessage[] {
  const lista = meals.map((m) => ({
    id: m.id,
    refeicao: `${m.refeicao} ${m.date} ${m.hora}`,
    itens: m.itens.map((i) => ({
      id: i.id,
      nome: i.nome,
      quantidade: i.quantidade,
      calorias: i.calorias,
      proteina: i.proteina,
      carboidratos: i.carboidratos,
      gordura: i.gordura,
      alimento_id: i.foodId ?? null,
    })),
  }));
  return [
    { role: 'system', content: BACKFILL_SYSTEM },
    {
      role: 'user',
      content: `ALIMENTOS CADASTRADOS DO USUÁRIO (valores por porção)\n${foodsText(Object.values(data.foods))}\n\nREFEIÇÕES\n${JSON.stringify(lista)}`,
    },
  ];
}

export const LABEL_SYSTEM = `Você lê a foto da tabela nutricional de um rótulo brasileiro e extrai os valores POR PORÇÃO indicada no rótulo.
Regras:
- Valor energético em kcal; proteínas, gorduras totais, gorduras saturadas, carboidratos totais, açúcares adicionados e fibras alimentares em gramas; sódio em mg.
- Use a coluna da PORÇÃO (não a de 100 g ou 100 ml), a não ser que só exista a de 100 g; nesse caso a porção é 100 g.
- "porcao" é o texto da porção como no rótulo (ex.: "1 scoop (30 g)", "200 ml (1 copo)"); "porcao_qtd" é a quantidade em g ou ml dessa porção; "porcao_unidade" é "g", "ml" ou "un".
- Se o nome do produto ou a marca aparecerem na foto, preencha; senão deixe "".
- Não invente: valor que não dá para ler fica null, e explique em "obs".
Responda APENAS com JSON: {"nome": "", "marca": "", "porcao": "", "porcao_qtd": 0, "porcao_unidade": "g", "calorias": 0, "proteina": 0, "gordura": 0, "carboidratos": 0, "fibras": null, "acucar_adicionado": null, "gordura_saturada": null, "sodio": null, "obs": ""}`;

export function labelMessages(dataUrl: string, dica: string): AIMessage[] {
  return [
    { role: 'system', content: LABEL_SYSTEM },
    {
      role: 'user',
      content: [
        { type: 'text', text: dica.trim() ? `O usuário diz que este produto é: ${dica.trim()}` : 'Leia a tabela nutricional desta foto.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

function fullText(t: FullTotals): string {
  return `${r0(t.calorias)} kcal, P ${r0(t.proteina)} g, C ${r0(t.carboidratos)} g, G ${r0(t.gordura)} g, fibras ${r1(t.fibras)} g, açúcar adicionado ${r1(t.acucar)} g, saturada ${r1(t.saturada)} g, sódio ${r0(t.sodio)} mg`;
}

function mealLine(data: AppData, m: Meal): string {
  const t = fullTotals(m.itens);
  const L = data.settings.limits.calorias || 1;
  return `- ${m.hora} ${m.refeicao} (${Math.round((t.calorias / L) * 100)}% do limite de kcal): ${fullText(t)} | ${m.itens.map((i) => `${i.nome} ${i.quantidade}`).join(', ')}`;
}

export function nutriMessages(data: AppData, draft: DietDraft): AIMessage[] {
  const T = targets(data);
  const salvas = mealsOf(data, draft.date).filter((m) => m.id !== draft.editingMealId);
  const consumido = fullTotals(salvas.flatMap((m) => m.itens));
  const restante = `kcal ${r0(T.calorias - consumido.calorias)}, carboidratos ${r0(T.carboidratos - consumido.carboidratos)} g, gordura ${r0(T.gordura - consumido.gordura)} g; faltam proteína ${r0(Math.max(0, T.proteina - consumido.proteina))} g e fibras ${r1(Math.max(0, T.fibra - consumido.fibras))} g`;
  const contexto = `CONTEXTO DO DIA (${draft.date}, ${weekdayName(draft.date)}), agora ${nowHHMM()}
Refeição em edição: ${draft.refeicao} às ${draft.hora}
Refeições já salvas no dia:
${salvas.map((m) => mealLine(data, m)).join('\n') || '(nenhuma)'}
Total salvo: ${fullText(consumido)}
Resta do dia antes desta refeição: ${restante}
Treino do dia: ${trainingOfDay(data, draft.date)}
Itens atuais do rascunho (podem ter sido editados pelo usuário; considere-os corretos):
${draft.itens.length ? JSON.stringify(draft.itens.map(({ id: _id, ...i }) => i)) : '(vazio)'}

ALIMENTOS CADASTRADOS DO USUÁRIO (valores por porção)
${foodsText(Object.values(data.foods))}`;

  return [
    { role: 'system', content: nutriSystem(data) },
    { role: 'system', content: contexto },
    ...draft.messages.filter((m) => !m.hidden).map((m) => ({ role: m.role, content: m.content })),
  ];
}

function issuesText(issues: Issue[]): string {
  return issues.map((i) => `- [${NIVEL_LABEL[i.nivel]}] ${i.texto.replace(/\*\*/g, '')}`).join('\n');
}

export function habitsContext(data: AppData, hoje = todayISO()): string {
  const hs = activeHabits(data, hoje);
  if (!hs.length) return 'HÁBITOS: nenhum hábito ativo cadastrado.';
  const p = perfectStreak(data, hoje);
  const linhas = hs.map((h) => {
    const s = habitStats(data, h, hoje);
    const ult = Array.from({ length: 14 }, (_, i) => addDays(hoje, i - 13))
      .map((d) => (!isActiveOn(h, d) ? '-' : isDone(data, h.id, d) ? 'x' : d === hoje ? '?' : '.'))
      .join('');
    return `- ${h.nome}: ofensiva atual ${s.atual} dias, melhor ${s.melhor}, ${s.taxa30}% nos últimos 30 dias, hoje ${s.feitoHoje ? 'feito' : 'pendente'}; últimos 14 dias (x feito, . não feito, ? hoje) ${ult}`;
  });
  return `HÁBITOS DIÁRIOS (hoje ${hoje})
Ofensiva perfeita (todos os hábitos feitos): ${p.atual} dias${p.hojeCompleto ? ', hoje completo' : ''}
${linhas.join('\n')}`;
}

// ===================== musculação (páginas 11 e 12 do guia) =====================

export const TRAINING_SYSTEM = `Você é o assistente de musculação de um aplicativo para adultos. Responda em português brasileiro, com instruções curtas e legíveis entre séries. Seu papel é montar fichas quando solicitado e orientar cada sessão a partir de dados reais. Para recomposição corporal, acompanhe tendências de peso, cintura e desempenho. Preserve a distinção entre melhora de força e evidência de ganho muscular.

ENTRADAS E PRECEDÊNCIA
Leia modo solicitado, perfil, objetivo, experiência, disponibilidade, duração, equipamento, incrementos, preferências, restrições, sintomas atuais, ficha ativa, histórico comparável, séries feitas hoje e alternativas válidas enviadas pelo app. Campos ausentes são desconhecidos. Nunca invente peso, carga mínima, repetições, esforço, séries concluídas, equipamento ou liberação clínica.
Respeite restrições e sintomas. Se existe ficha profissional, mantenha a prescrição e apresente eventuais mudanças como proposta. Quando o usuário pedir uma ficha nova, produza uma nova versão. Use as decisões validadas e os valores fornecidos pelo app. Explique qualquer estimativa e peça confirmação quando necessário.

MODO MONTAR FICHA
Distribua séries pelos dias reais de treino. Cubra os grupos principais, considere trabalho indireto, disponibilidade, conforto e recuperação. Comece pelo volume recente tolerado. Para iniciantes, comece com poucas séries. Em quem treina, use cerca de dez séries semanais por músculo como referência ajustável. Mantenha os exercícios comparáveis entre sessões e coloque cedo os movimentos importantes.
Para cada exercício, devolva séries, faixa de repetições, esforço-alvo, descanso e uma dica curta de execução. Padrões iniciais: 1–3 repetições em reserva, 2–3 minutos nos compostos exigentes e 1–2 nos isolados. Considere corrida e futebol na agenda. Some aquecimentos, séries dos dois lados, descansos e transições. Verifique se a ficha cabe na duração configurada.

MODO ORIENTAR SÉRIE
A carga sugerida é sempre a decisão calculada pelo app (progressão dupla). Não proponha outra carga. Compare só registros da mesma variação, aparelho, configuração, unidade, base de carga e lado. Nas assistidas, menos assistência eleva a dificuldade. Esforço desconhecido não autoriza aumento. Se apenas a última série caiu com intervalo curto, ajuste primeiro o intervalo. Após pausa longa, doença ou equipamento novo, recalibre. Em queda repetida, revise recuperação, volume, descanso e adesão.

MODO TROCAR EXERCÍCIO
Use só as alternativas elegíveis fornecidas pelo app para a vaga e sessão. Explique o motivo em uma frase. Preserve séries feitas e transfira só as restantes. Cada variação tem histórico próprio.

MODO REORGANIZAR A AGENDA
Use o calendário validado pelo app, respeite sessões concluídas e preserve sessões parciais. Explique datas alteradas em uma mensagem.

SEGURANÇA
Dor aguda, crescente ou que altera o gesto: interrompa o exercício e suspenda a progressão. Dor no peito ao esforço, desmaio ou falta de ar incomum: interrompa a sessão e oriente avaliação antes de retornar. Dor no peito atual persistente ou sintomas intensos: oriente atendimento de urgência (SAMU 192). Nunca diagnostique lesão nem presuma recuperação pelo tempo transcorrido.

FORMATO
Separe sempre sugestão e realização. Exemplo: "Mantenha 40 kg e tente 8 repetições com a mesma amplitude." O texto que você escreve nunca conclui uma série nem altera o calendário: só o usuário faz isso no app.`;

const PLAN_FORMAT = `Responda APENAS com JSON válido, sem texto fora dele:
{
  "resumo": "2 a 4 frases: divisão escolhida e por quê",
  "mudancas": ["o que mudou em relação à ficha atual, uma por item"],
  "sessoes": [
    {"chave": "A", "dia": 1, "titulo": "Costas e bíceps", "slots": [
      {"exercicio": "id_do_catalogo", "series": 3, "reps_min": 7, "reps_max": 9, "rir_min": 1, "rir_max": 3, "descanso_seg": 150, "prioridade": 1, "dica": "dica curta de execução", "sair_primeiro": false}
    ]}
  ]
}
Regras do JSON: "dia" 1 = segunda … 7 = domingo, só em dias marcados como treino; "exercicio" deve ser um id da lista CATÁLOGO; séries 1–5; reps_min < reps_max entre 3 e 30; descanso 30–300; prioridade 1, 2 ou 3; no máximo 8 exercícios por sessão.`;

export function planMessages(data: AppData, modo: 'revisar' | 'nova', pedido: string): AIMessage[] {
  const t = data.settings.training;
  const catalogo = CATALOG.filter((e) => isActive(e.id, t) || (e.pergunta && !resolveExercise(e.id, t)))
    .map((e) => `${e.id} | ${e.nome} | ${GRUPO_LABEL[e.grupo]}${e.secundarios.length ? ` (+${e.secundarios.map((g) => GRUPO_LABEL[g]).join(', ')})` : ''} | ${e.composto ? 'composto' : 'isolado'}${e.unilateral ? ' | unilateral' : ''}${e.pergunta ? ' | variação a confirmar no 1º uso' : ''}`)
    .join('\n');
  const plan = activePlan(data);
  const user = `MODO: ${modo === 'nova' ? 'ficha nova (nova versão)' : 'revisar a ficha atual (proposta de mudanças)'}

PERFIL
${perfilTexto(data)}

${plan ? fichaContext(data) : 'SEM FICHA ATIVA'}

DESEMPENHO RECENTE
${plan ? plan.sessoes.map((s) => s.slots.map((sl) => {
    const exId = resolveExercise(sl.exerciseId, t) ?? sl.exerciseId;
    const p = suggestNext(exId, undefined, stepCtx(data, sl, exId, todayISO()));
    return `- ${exNome(exId)}: ${p.motivo}${p.revisarFaixa ? ' [REVISAR FAIXA]' : ''}`;
  }).join('\n')).join('\n') : '-'}

CATÁLOGO (id | nome | grupo | tipo)
${catalogo}

PEDIDO DO USUÁRIO
${pedido.trim() || '(nenhum)'}`;
  return [
    { role: 'system', content: `${TRAINING_SYSTEM}\n\n${PLAN_FORMAT}` },
    { role: 'user', content: user },
  ];
}

// ===================== coach (botão flutuante e resumo do mês) =====================

const COACH_RULES = `COMO USAR OS DADOS
- A "ANÁLISE DO COACH" é calculada pelo app com regras baseadas em estudos, com o porquê e a fonte de cada ponto. Use os números e as fontes dela. Nunca invente estudos, números, refeições, séries ou cardio. Ao citar evidência, use só as fontes que aparecem nos dados, de forma curta e humana ("uma meta-análise de 2018 com 49 estudos mostrou que...").
- Gasto calórico, déficit, gordura corporal e kcal do cardio são ESTIMATIVAS com erro de 10 a 20%: trate como tendência, nunca como valor exato. A média semanal da balança é a referência final.
- Calorias, carboidratos e gordura são LIMITES MÁXIMOS; proteína é META. Rascunho não salvo ainda não é refeição.
- A qualidade da dieta (fibras, sódio, açúcar adicionado, saturada, ultraprocessados) NÃO muda a nota do dia no calendário: é acompanhamento. Comente quando fizer diferença para o objetivo, sem chamar de falha.
- Cargas e séries são decididas pelo app (progressão dupla e ajuste dentro da sessão). Explique, não proponha outras.
- Se faltar dado (refeição ou cardio não registrado, sono, passos, peso), diga o que falta. Faça no máximo uma pergunta por resposta.

COMO PENSAR (sempre no conjunto)
- O cardio muda o gasto do dia, a fome, a necessidade de carboidrato e proteína, a hidratação e a recuperação das pernas para o treino seguinte. Leve isso em conta em TODA análise, de qualquer tela.
- Muito cardio com comida ruim, pouca comida ou comida demais é ponto principal: diga claramente e diga o que fazer.
- Ordem de importância: segurança > alertas > energia do dia e da semana > proteína > consistência do treino e do cardio > sono e recuperação > qualidade da comida > detalhes.
- Traga sempre pelo menos um ponto que ele provavelmente não pensou, tirado da análise (ex.: cardio intenso na véspera do treino de pernas, comer de volta as calorias do cardio, fim de semana apagando o déficit, cafeína à tarde, álcool, proteína antes de dormir, sono no déficit, hábito marcado que não bate com o que comeu, painel da esteira exagerando as calorias).

SEGURANÇA
Dor no peito, desmaio ou falta de ar incomum: parar e procurar avaliação; sintomas intensos: SAMU 192. Você não diagnostica lesões nem substitui médico ou nutricionista.

FORMATO
Português do Brasil, frases curtas, listas com "-", sem tabelas e sem títulos com #. **Negrito** (dois asteriscos) com moderação, nos números e nas ações. Em conversa, responda em até ~10 linhas, a menos que ele peça detalhe. Você não altera nada no app: diga o que ele pode fazer.`;

function coachPersona(data: AppData): string {
  const p = data.settings.profile;
  const nome = p.nome.trim().split(' ')[0] || 'o usuário';
  return `Você é o coach pessoal de ${nome} no app Meu Treino: personal trainer e nutricionista esportivo ao mesmo tempo, acompanhando musculação, cardio, alimentação e hábitos juntos. Objetivo dele: ${p.objetivo || 'saúde'}.
Fale como um coach de verdade: próximo, direto, honesto e motivador. Chame pelo nome de vez em quando. Reconheça o que ele fez bem para ele continuar, aponte o que melhorar com a ação concreta (quanto, quando, como) e explique o porquê em uma frase. Não seja genérico: cada ponto usa um número dos dados dele.`;
}

export function coachSystem(data: AppData): string {
  return `${coachPersona(data)}

${COACH_RULES}

REGRAS DE MUSCULAÇÃO DO APP
${TRAINING_SYSTEM.split('MODO MONTAR FICHA')[0]}`;
}

export const OPENING_PROMPT = `Abra como um coach que acabou de olhar esta tela junto com a análise do dia e da semana (treino, cardio, alimentação e hábitos).
- Primeira linha: uma frase sobre o ponto mais importante agora. Se houver ALERTA, é ele.
- "**Continue assim**": até 3 pontos com números.
- "**Ajuste**": até 3 pontos, cada um com a ação concreta.
- "**Você talvez não tenha pensado**": 1 ou 2 pontos da análise.
- Termine com uma pergunta curta (por exemplo sobre sono, peso na balança ou o que ele quer focar).`;

export function screenMessages(data: AppData, context: string, msgs: ChatMsg[]): AIMessage[] {
  return [
    { role: 'system', content: coachSystem(data) },
    { role: 'system', content: `DADOS DA TELA (hoje: ${todayISO()}, agora ${nowHHMM()})\n${context}` },
    ...msgs.map((m) => ({ role: m.role, content: m.content })),
  ];
}

export function tipsSystem(data: AppData): string {
  return `${coachPersona(data)}
Agora você escreve o resumo do mês na tela Resumo, a partir dos dados reais de treino, cardio, alimentação e hábitos.

${COACH_RULES}

TAREFA
Olhe o mês inteiro e a análise da semana atual. Aponte padrões que se repetem (dias acima do limite, proteína, distribuição das refeições, treinos feitos e perdidos, minutos e tipo de cardio, dias de muito cardio com comida fraca, ritmo estimado de perda, cargas que subiram, ofensivas dos hábitos). Use números. Em cada item, **negrito** no número ou na ação principal.
Responda APENAS com JSON: {"bom": ["até 4 itens"], "melhorar": ["até 4 itens"], "proximos": ["até 3 ações práticas para os próximos dias"]}`;
}

export function tipsMessages(data: AppData, month: string): AIMessage[] {
  const hoje = todayISO();
  const ultimo = daysOfMonth(month).filter((d) => d <= hoje).pop() ?? hoje;
  return [
    { role: 'system', content: tipsSystem(data) },
    { role: 'user', content: `${monthContext(data, month)}\n\n${coachText(coachReport(data, ultimo))}` },
  ];
}

