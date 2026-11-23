import type { AppData, ChatMsg, DietDraft, Food, PlanVersion, Session } from '../types';
import { BY_ID, CATALOG, getEx, GRUPO_LABEL, isActive, QUESTIONS, resolveExercise } from '../training/catalog';
import {
  estimateSession,
  exposures,
  planVolume,
  realizedVolume,
  sessionSteps,
  stepCtx,
  suggestNext,
  unitOf,
  type Volume,
} from '../training/engine';
import { activePlan, nextSession, planSessionOf, weekView } from '../training/schedule';
import type { AIMessage } from './openrouter';
import { dayTotals, evaluateDay, mealsOf, STATUS_LABEL, sumMacros } from './score';
import { addDays, daysOfMonth, formatLong, r0, todayISO, weekStart, weekdayName } from './utils';

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
        `- ${exNome(st.exerciseId)} · ${st.tipo} ${st.posicao}${st.lado ? ` lado ${st.lado}` : ''}: ${set!.status === 'pulada' ? 'pulada' : `${set!.carga ?? '-'} ${set!.unidade} × ${set!.reps ?? '-'} reps, reserva ${set!.rir ?? 'não sei'}${set!.ajuda ? ', com ajuda' : ''}${set!.dor ? `, DOR (${set!.dorTipo})` : ''}`}`,
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
  const t = dayTotals(data, date);
  const draft = data.dietDraft?.date === date ? data.dietDraft : null;
  return `DIETA DE ${formatLong(date)} (${date})
LIMITES: ${limitesTexto(data)}
TOTAL SALVO: ${r0(t.calorias)} kcal, P ${r0(t.proteina)} g, G ${r0(t.gordura)} g, C ${r0(t.carboidratos)} g
REFEIÇÕES
${
  meals
    .map((m) => {
      const s = sumMacros(m.itens);
      return `- ${m.hora} ${m.refeicao} (${r0(s.calorias)} kcal, P ${r0(s.proteina)}): ${m.itens.map((i) => `${i.nome} ${i.quantidade}`).join(', ')}`;
    })
    .join('\n') || '(nenhuma)'
}
${draft?.itens.length ? `RASCUNHO NÃO SALVO: ${draft.itens.map((i) => i.nome).join(', ')}` : ''}
TREINO DO DIA: ${trainingOfDay(data, date)}
ALIMENTOS CADASTRADOS: ${Object.values(data.foods).map((f) => f.nome).join(', ') || 'nenhum'}`;
}

function trainingOfDay(data: AppData, date: string): string {
  const ev = evaluateDay(data, date);
  if (ev.treinos.length) return ev.treinos.map((s) => `${s.key} ${s.titulo} (${s.status})`).join(', ');
  const plan = Object.values(data.sessions).find((s) => s.dataAtual === date && s.status === 'pendente');
  return plan ? `${plan.key} ${plan.titulo} marcado` : 'nenhum';
}

export function monthContext(data: AppData, month: string, selected?: string): string {
  const dias = daysOfMonth(month)
    .filter((d) => d <= todayISO())
    .map((d) => {
      const ev = evaluateDay(data, d);
      if (ev.status === 'empty') return null;
      return {
        data: d,
        avaliacao: STATUS_LABEL[ev.status],
        motivos: ev.motivos,
        kcal: r0(ev.totals.calorias),
        prot: r0(ev.totals.proteina),
        gord: r0(ev.totals.gordura),
        carb: r0(ev.totals.carboidratos),
        refeicoes: ev.meals.length,
        treino: ev.treinos.map((s) => `${s.key} ${s.status}`).join(', ') || (ev.faltas.length ? 'falta' : 'nenhum'),
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
ADESÃO AO TREINO (4 semanas): ${adesaoTexto(data)}`;
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

export const NUTRI_SYSTEM = `Você é um nutricionista que calcula calorias e macronutrientes do que o usuário comeu.

Regras:
- Use como referência a Tabela TACO (alimentos brasileiros) e, na falta, a USDA.
- Se a quantidade não for informada, assuma uma porção típica brasileira e deixe isso claro no campo "quantidade".
- Se o usuário mencionar marca ou produto industrializado, use os valores do rótulo se souber.
- ALIMENTOS CADASTRADOS: o usuário cadastrou os produtos que ele usa (marca e tabela do rótulo). Quando ele citar um alimento que corresponde a um cadastrado pelo nome ou apelido (ex.: "whey", "meu iogurte", "leite"), use OBRIGATORIAMENTE os valores do cadastro, proporcionais à quantidade (ex.: porção 200 ml e ele tomou 300 ml = 1,5 porção; 3 scoops com porção de 1 scoop = 3 porções). Preencha "alimento_id" com o id do cadastro. Se houver dois cadastros possíveis, use o mais provável e pergunte.
- Alimento composto (ex.: "sucrilhos com leite"): separe em itens e use o cadastro de cada parte quando existir.
- Sempre devolva a LISTA COMPLETA e atualizada de itens da refeição em rascunho: mantenha os itens anteriores, aplique as correções pedidas e adicione os novos.
- calorias em kcal; proteina, gordura e carboidratos em gramas; somente números, com no máximo 1 casa decimal.
- No campo "resposta", explique os cálculos de forma curta (ex.: "2 ovos (100 g): 143 kcal...") e o total. Destaque com **negrito** o total e os itens que vieram do cadastro. Se houver ambiguidade, faça a melhor estimativa e pergunte para confirmar.

Responda APENAS com um JSON válido, sem texto fora dele:
{"resposta": "texto", "itens": [{"nome": "Ovo cozido", "quantidade": "2 unidades (100 g)", "calorias": 146, "proteina": 13.3, "gordura": 9.5, "carboidratos": 0.6, "alimento_id": null}]}`;

export function foodsText(foods: Food[]): string {
  if (!foods.length) return '(nenhum alimento cadastrado)';
  return foods
    .map(
      (f) =>
        `- id ${f.id} | ${f.nome}${f.apelidos ? ` (apelidos: ${f.apelidos})` : ''} | porção: ${f.porcao || `${f.porcaoQtd} ${f.porcaoUnidade}`} = ${f.porcaoQtd} ${f.porcaoUnidade} | ${f.calorias} kcal, P ${f.proteina} g, G ${f.gordura} g, C ${f.carboidratos} g${f.obs ? ` | obs: ${f.obs}` : ''}`,
    )
    .join('\n');
}

export const LABEL_SYSTEM = `Você lê a foto da tabela nutricional de um rótulo brasileiro e extrai os valores POR PORÇÃO indicada no rótulo.
Regras:
- Valor energético em kcal; proteínas, gorduras totais e carboidratos totais em gramas.
- "porcao" é o texto da porção como no rótulo (ex.: "1 scoop (30 g)", "200 ml (1 copo)"); "porcao_qtd" é a quantidade em g ou ml dessa porção; "porcao_unidade" é "g", "ml" ou "un".
- Se o nome do produto ou a marca aparecerem na foto, preencha; senão deixe "".
- Não invente: valor que não dá para ler fica null, e explique em "obs".
Responda APENAS com JSON: {"nome": "", "marca": "", "porcao": "", "porcao_qtd": 0, "porcao_unidade": "g", "calorias": 0, "proteina": 0, "gordura": 0, "carboidratos": 0, "obs": ""}`;

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

export function nutriMessages(data: AppData, draft: DietDraft): AIMessage[] {
  const consumido = dayTotals(data, draft.date);
  const contexto = `CONTEXTO
Data da refeição: ${draft.date} | Refeição: ${draft.refeicao}
Limites diários: ${limitesTexto(data)}
Já consumido no dia (refeições salvas, sem o rascunho): ${r0(consumido.calorias)} kcal, P ${r0(consumido.proteina)} g, G ${r0(consumido.gordura)} g, C ${r0(consumido.carboidratos)} g
Itens atuais do rascunho (podem ter sido editados pelo usuário; considere-os corretos):
${draft.itens.length ? JSON.stringify(draft.itens.map(({ id: _id, ...i }) => i)) : '(vazio)'}

ALIMENTOS CADASTRADOS DO USUÁRIO (valores por porção)
${foodsText(Object.values(data.foods))}`;

  return [
    { role: 'system', content: NUTRI_SYSTEM },
    { role: 'system', content: contexto },
    ...draft.messages.filter((m) => !m.hidden).map((m) => ({ role: m.role, content: m.content })),
  ];
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

// ===================== resumo e chat por tela =====================

export const TIPS_SYSTEM = `Você é o coach do usuário (personal trainer + nutricionista). Você recebe os dados reais de treino e alimentação do mês.
Regras: baseie-se SOMENTE nos dados; use números (médias, dias acima do limite, % da meta de proteína, sessões feitas, cargas). Não invente. Se faltar dado, diga. Português do Brasil, frases curtas. Em cada item, destaque com **negrito** o número ou a ação mais importante. Calorias, carboidratos e gordura são LIMITES MÁXIMOS: ficar abaixo é bom e não é meta a atingir. Proteína é META: o ideal é chegar perto dela. Rascunho não salvo ainda não conta como refeição.
Responda APENAS com JSON: {"bom": ["até 4 itens"], "melhorar": ["até 4 itens"], "proximos": ["até 3 ações práticas para os próximos dias"]}`;

export function tipsMessages(data: AppData, month: string): AIMessage[] {
  return [
    { role: 'system', content: TIPS_SYSTEM },
    { role: 'user', content: monthContext(data, month) },
  ];
}

export const SCREEN_SYSTEM = `Você é o coach do app Meu Treino (personal trainer + nutricionista). O usuário abriu o chat a partir de uma tela do app; os dados dessa tela vêm abaixo e são atualizados a cada mensagem.
Regras:
- Baseie-se SOMENTE nos dados fornecidos. Não invente números, pesos, séries nem refeições.
- Cargas e metas de treino são decididas pelo app (progressão dupla). Explique-as, não proponha outras.
- Dieta: Calorias, carboidratos e gordura são LIMITES MÁXIMOS: ficar abaixo é bom e não é meta a atingir. Proteína é META: o ideal é chegar perto dela. Rascunho não salvo ainda não conta como refeição.
- Você não altera nada no app: sugira o que o usuário pode fazer.
- Seja direto: frases curtas, listas com "-", sem tabelas e sem títulos com #.
- Destaque com **negrito** (dois asteriscos) os pontos importantes: números, metas, alertas e a ação recomendada. Use negrito com moderação, no máximo um trecho por item.
- Segurança: dor no peito, desmaio ou falta de ar incomum → parar e procurar avaliação; sintomas intensos → SAMU 192.

Regras de musculação do app:
${TRAINING_SYSTEM.split('MODO MONTAR FICHA')[0]}`;

export const OPENING_PROMPT =
  'Abra a conversa com uma leitura curta desta tela: até 3 pontos bons e até 3 pontos a melhorar, com números dos dados. Use as linhas "**Bom**" e "**Pode melhorar**" como títulos, cada ponto numa linha com "-". Termine com uma pergunta curta oferecendo detalhar algo.';

export function screenMessages(context: string, msgs: ChatMsg[]): AIMessage[] {
  return [
    { role: 'system', content: SCREEN_SYSTEM },
    { role: 'system', content: `DADOS DA TELA (hoje: ${todayISO()})\n${context}` },
    ...msgs.map((m) => ({ role: m.role, content: m.content })),
  ];
}
