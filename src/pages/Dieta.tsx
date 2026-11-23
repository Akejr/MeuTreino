import { useState } from 'react';
import { useAIContext } from '../components/AIChat';
import { ChatInput, ChatMessages } from '../components/Chat';
import DateNav from '../components/DateNav';
import { ask } from '../components/Dialog';
import { IconApple, IconCoffee, IconDieta, IconMoon, IconSparkle, IconSun, IconSunrise, IconTrash, IconZap } from '../components/Icons';
import { KcalCard, MacroGrid } from '../components/MacroBars';
import NumberField from '../components/NumberField';
import Segmented from '../components/Segmented';
import { chatJSON } from '../lib/openrouter';
import { dietContext, foodsText, nutriMessages } from '../lib/prompts';
import { mealsOf, sumMacros } from '../lib/score';
import { getData, setData, useData } from '../lib/storage';
import { dayLabel, errMsg, nowHHMM, r0, r1, todayISO, uid } from '../lib/utils';
import type { AppData, DietDraft, FoodItem, Macros, Meal } from '../types';
import Alimentos from './dieta/Alimentos';

const REFEICOES = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Pré-treino', 'Pós-treino', 'Jantar', 'Ceia', 'Outro'];

function refeicaoPorHora(h: number) {
  if (h < 10) return 'Café da manhã';
  if (h < 12) return 'Lanche da manhã';
  if (h < 15) return 'Almoço';
  if (h < 19) return 'Lanche da tarde';
  if (h < 22) return 'Jantar';
  return 'Ceia';
}

type NutriAI = { resposta?: string; itens?: (Partial<FoodItem> & { alimento_id?: string | null })[] };

function normalizeItens(itens: NutriAI['itens'], d: AppData): FoodItem[] {
  return (Array.isArray(itens) ? itens : []).map((i) => ({
    id: uid(),
    nome: String(i.nome ?? 'Item'),
    quantidade: String(i.quantidade ?? ''),
    calorias: r1(Number(i.calorias)),
    proteina: r1(Number(i.proteina)),
    gordura: r1(Number(i.gordura)),
    carboidratos: r1(Number(i.carboidratos)),
    foodId: i.alimento_id && d.foods[i.alimento_id] ? i.alimento_id : undefined,
  }));
}

const MEAL_ICON: Record<string, typeof IconSun> = {
  'Café da manhã': IconSunrise,
  'Lanche da manhã': IconCoffee,
  Almoço: IconSun,
  'Lanche da tarde': IconApple,
  'Pré-treino': IconZap,
  'Pós-treino': IconZap,
  Jantar: IconMoon,
  Ceia: IconMoon,
};

function MealIcon({ refeicao }: { refeicao: string }) {
  const Icon = MEAL_ICON[refeicao] ?? IconDieta;
  return (
    <span className="tile">
      <Icon />
    </span>
  );
}

function MacroChips({ m, strong }: { m: Macros; strong?: boolean }) {
  return (
    <div className={`macro-line ${strong ? 'strong' : ''}`}>
      <span>{r0(m.calorias)} kcal</span>
      <span>P {r0(m.proteina)} g</span>
      <span>C {r0(m.carboidratos)} g</span>
      <span>G {r0(m.gordura)} g</span>
    </div>
  );
}

const setDraft = (fn: (d: DietDraft | null) => DietDraft | null) => setData((d) => ({ ...d, dietDraft: fn(d.dietDraft) }));

/** Rascunho sem nada digitado nem calculado: pode sair sem perguntar. */
const draftVazio = (d: DietDraft | null) =>
  !d || (!d.messages.length && d.itens.every((i) => !i.nome.trim() && !i.quantidade.trim() && !i.calorias && !i.proteina && !i.gordura && !i.carboidratos));

type View = 'dia' | 'alimentos';

export default function Dieta() {
  const data = useData();
  const [view, setView] = useState<View>('dia');
  const [date, setDate] = useState(todayISO());
  useAIContext(
    view === 'dia' ? `dieta:${date}` : 'dieta:alimentos',
    view === 'dia' ? `Dieta · ${dayLabel(date)}` : 'Meus alimentos',
    () => (view === 'dia' ? dietContext(getData(), date) : `ALIMENTOS CADASTRADOS\n${foodsText(Object.values(getData().foods))}`),
  );
  return (
    <>
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'dia', label: 'Refeições' },
          { value: 'alimentos', label: 'Meus alimentos' },
        ]}
      />
      {view === 'dia' ? <Dia data={data} date={date} setDate={setDate} onAlimentos={() => setView('alimentos')} /> : <Alimentos data={data} />}
    </>
  );
}

function Dia({ data, date, setDate, onAlimentos }: { data: AppData; date: string; setDate: (d: string) => void; onAlimentos: () => void }) {
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const draft = data.dietDraft;
  const meals = mealsOf(data, date);
  const totals = sumMacros(meals.flatMap((m) => m.itens));
  const draftTotals = draft ? sumMacros(draft.itens) : undefined;
  const limits = data.settings.limits;
  const temAlimentos = Object.keys(data.foods).length > 0;

  function newDraft(): DietDraft {
    return { date, refeicao: refeicaoPorHora(new Date().getHours()), hora: nowHHMM(), messages: [], itens: [] };
  }

  async function enviar(text: string) {
    const base = getData().dietDraft ?? newDraft();
    const withUser: DietDraft = { ...base, messages: [...base.messages, { role: 'user', content: text, ts: Date.now() }] };
    setDraft(() => withUser);
    setLoading(true);
    setErro('');
    try {
      const res = await chatJSON<NutriAI>(getData(), nutriMessages(getData(), withUser));
      const itens = normalizeItens(res.itens, getData());
      setDraft((d) =>
        d
          ? {
              ...d,
              itens,
              messages: [...d.messages, { role: 'assistant', content: res.resposta?.trim() || 'Cálculo atualizado.', ts: Date.now() }],
            }
          : d,
      );
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  function updateItem(id: string, patch: Partial<FoodItem>) {
    setDraft((d) => (d ? { ...d, itens: d.itens.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : d));
  }

  function addItem() {
    const item: FoodItem = { id: uid(), nome: '', quantidade: '', calorias: 0, proteina: 0, gordura: 0, carboidratos: 0 };
    setDraft((d) => ({ ...(d ?? newDraft()), itens: [...(d?.itens ?? []), item] }));
  }

  function salvar() {
    if (!draft || !draft.itens.length) return;
    const meal: Meal = {
      id: draft.editingMealId ?? uid(),
      date: draft.date,
      refeicao: draft.refeicao,
      hora: draft.hora,
      itens: draft.itens,
      criadoEm: Date.now(),
    };
    setData((d) => ({ ...d, meals: { ...d.meals, [meal.id]: meal }, dietDraft: null }));
    setDate(meal.date);
  }

  async function descartar() {
    if (draftVazio(draft)) {
      setDraft(() => null);
      return;
    }
    const ok = await ask(
      draft?.editingMealId
        ? { title: 'Cancelar a edição?', message: 'A refeição salva continua como estava.', confirm: 'Cancelar edição', cancel: 'Continuar editando' }
        : { title: 'Descartar esta refeição?', message: 'Os itens e a conversa deste rascunho serão apagados.', confirm: 'Descartar', cancel: 'Voltar', danger: true },
    );
    if (ok) setDraft(() => null);
  }

  async function editar(m: Meal) {
    if (!draftVazio(draft)) {
      const ok = await ask({ title: 'Substituir o rascunho?', message: 'Já existe uma refeição em rascunho. Ela será descartada para editar esta.', confirm: 'Substituir', danger: true });
      if (!ok) return;
    }
    setDraft(() => ({ date: m.date, refeicao: m.refeicao, hora: m.hora, editingMealId: m.id, messages: [], itens: m.itens.map((i) => ({ ...i })) }));
    setTimeout(() => document.getElementById('draft')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  async function apagar(m: Meal) {
    if (!(await ask({ title: `Apagar ${m.refeicao.toLowerCase()} das ${m.hora}?`, confirm: 'Apagar', danger: true }))) return;
    setData((d) => {
      const meals = { ...d.meals };
      delete meals[m.id];
      return { ...d, meals };
    });
  }

  const exemplos = temAlimentos
    ? ['300 ml de leite com 3 scoops de whey', '2 iogurtes', 'Sucrilhos com leite']
    : ['2 ovos mexidos e 1 pão francês', '150 g de frango e 100 g de arroz', '1 banana'];

  return (
    <>
      <DateNav date={date} onChange={setDate} />

      <KcalCard totals={totals} limits={limits} extra={draft?.date === date ? draftTotals : undefined} />
      <MacroGrid totals={totals} limits={limits} extra={draft?.date === date ? draftTotals : undefined} />

      {meals.length > 0 && <div className="section-title">Refeições</div>}
      {meals.map((m) => {
        const t = sumMacros(m.itens);
        return (
          <section key={m.id} className="card meal">
            <div className="row">
              <MealIcon refeicao={m.refeicao} />
              <button className="meal-head grow" onClick={() => void editar(m)}>
                <strong>{m.refeicao}</strong>
                <span className="muted small">
                  {m.hora} · {r0(t.calorias)} kcal
                </span>
              </button>
              <button className="icon-btn" aria-label="Apagar refeição" onClick={() => void apagar(m)}>
                <IconTrash />
              </button>
            </div>
            <ul className="items">
              {m.itens.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.nome} <span className="muted small">{i.quantidade}</span>
                  </span>
                  <span className="muted small">{r0(i.calorias)} kcal</span>
                </li>
              ))}
            </ul>
            <MacroChips m={t} />
            <button className="link small" onClick={() => void editar(m)}>
              Editar
            </button>
          </section>
        );
      })}

      <section className="card add-card" id="draft">
        <div className="row add-head">
          <span className="tile">
            <IconSparkle />
          </span>
          <div className="grow">
            <h2>{draft?.editingMealId ? 'Editar refeição' : 'Adicionar refeição'}</h2>
            <span className="muted small">A IA calcula com os seus alimentos cadastrados. Você confere e salva.</span>
          </div>
        </div>
        {draft && draft.date !== date && <p className="notice">Este rascunho é de {dayLabel(draft.date)} ({draft.date}).</p>}
        {!draft && (
          <div className="row gap wrap">
            {exemplos.map((s) => (
              <button key={s} className="chip" disabled={loading} onClick={() => void enviar(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {!draft && !temAlimentos && (
          <button className="notice action" onClick={onAlimentos}>
            Cadastre seu whey, leite e iogurte em Meus alimentos para a IA usar a tabela certa.
          </button>
        )}

        {draft && (
          <div className="row gap">
            <select value={draft.refeicao} onChange={(e) => setDraft((d) => (d ? { ...d, refeicao: e.target.value } : d))}>
              {REFEICOES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input type="time" value={draft.hora} onChange={(e) => setDraft((d) => (d ? { ...d, hora: e.target.value } : d))} className="time" />
          </div>
        )}

        <ChatMessages messages={draft?.messages ?? []} loading={loading} />
        {erro && <p className="error">{erro}</p>}

        {draft && draft.itens.length > 0 && (
          <div className="editor">
            {draft.itens.map((i) => (
              <div key={i.id} className="food">
                <div className="row gap">
                  <input className="grow" value={i.nome} placeholder="Alimento" onChange={(e) => updateItem(i.id, { nome: e.target.value })} />
                  <button className="icon-btn" aria-label="Remover item" onClick={() => setDraft((d) => (d ? { ...d, itens: d.itens.filter((x) => x.id !== i.id) } : d))}>
                    <IconTrash />
                  </button>
                </div>
                {i.foodId && data.foods[i.foodId] && <span className="tag solid self-start">Seu cadastro: {data.foods[i.foodId].nome}</span>}
                <input value={i.quantidade} placeholder="Quantidade" onChange={(e) => updateItem(i.id, { quantidade: e.target.value })} />
                <div className="grid4">
                  <NumberField label="kcal" value={i.calorias} onChange={(n) => updateItem(i.id, { calorias: n })} />
                  <NumberField label="Prot" value={i.proteina} onChange={(n) => updateItem(i.id, { proteina: n })} />
                  <NumberField label="Gord" value={i.gordura} onChange={(n) => updateItem(i.id, { gordura: n })} />
                  <NumberField label="Carb" value={i.carboidratos} onChange={(n) => updateItem(i.id, { carboidratos: n })} />
                </div>
              </div>
            ))}
            {draftTotals && <MacroChips m={draftTotals} strong />}
          </div>
        )}

        <ChatInput onSend={(t) => void enviar(t)} disabled={loading} placeholder={draft?.itens.length ? 'Corrija ou adicione algo… (ex.: "foram 3 ovos")' : 'O que você comeu?'} />

        <div className="row gap wrap">
          <button className="btn ghost" onClick={addItem}>
            + Item manual
          </button>
          {draft && (
            <button className="btn ghost danger" onClick={() => void descartar()}>
              {draft.editingMealId ? 'Cancelar' : 'Descartar'}
            </button>
          )}
          {draft && (
            <button className="btn primary grow" disabled={!draft.itens.length || loading} onClick={salvar}>
              Salvar refeição
            </button>
          )}
        </div>
      </section>
    </>
  );
}
