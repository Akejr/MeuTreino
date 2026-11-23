import { useEffect, useMemo, useRef, useState } from 'react';
import { useAIContext } from '../components/AIChat';
import { IconBack, IconNext, IconSparkle, IconSync } from '../components/Icons';
import MacroBars from '../components/MacroBars';
import { RichInline } from '../components/RichText';
import { useOnline } from '../lib/hooks';
import { chatJSON } from '../lib/openrouter';
import { monthContext, tipsMessages } from '../lib/prompts';
import { evaluateDay, STATUS_LABEL } from '../lib/score';
import { getData, setDataRaw, useData } from '../lib/storage';
import { addMonths, daysOfMonth, errMsg, formatLong, formatMonth, monthKey, parseISO, todayISO } from '../lib/utils';
import type { AppData, Tips } from '../types';

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Muda quando os dados do mês mudam (refeições, sessões, séries, limites). */
function signature(data: AppData, month: string): string {
  const ms = Object.values(data.meals).filter((m) => m.date.startsWith(month)).map((m) => `${m.id}:${m._u ?? 0}`);
  const ss = Object.values(data.sessions)
    .filter((s) => (s.dataReal ?? s.dataAtual).startsWith(month))
    .map((s) => `${s.id}:${s.status}`);
  const sets = Object.values(data.sets).filter((s) => s.data.startsWith(month)).length;
  return [ms.sort().join(','), ss.sort().join(','), sets, JSON.stringify(data.settings.limits)].join('|');
}

export default function Resumo() {
  const data = useData();
  const online = useOnline();
  const today = todayISO();
  const [month, setMonth] = useState(monthKey(today));
  const [sel, setSel] = useState(today);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  useAIContext(`resumo:${month}`, `Resumo · ${formatMonth(month)}`, () => monthContext(getData(), month, sel));

  const days = daysOfMonth(month);
  const lead = parseISO(days[0]).getDay();
  const evals = useMemo(() => Object.fromEntries(days.map((d) => [d, evaluateDay(data, d)])), [data, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { good: 0, ok: 0, bad: 0 };
  for (const d of days) {
    const s = evals[d].status;
    if (s !== 'empty') counts[s]++;
  }
  const comDieta = days.filter((d) => evals[d].meals.length > 0);
  const mediaKcal = comDieta.length ? comDieta.reduce((s, d) => s + evals[d].totals.calorias, 0) / comDieta.length : 0;
  const treinos = Object.values(data.sessions).filter((s) => s.status === 'concluida' && (s.dataReal ?? s.dataAtual).startsWith(month)).length;
  const selEval = evaluateDay(data, sel);
  const registrados = counts.good + counts.ok + counts.bad;

  const tips = data.tips[month];
  const sig = signature(data, month);
  const desatualizado = !tips || tips.assinatura !== sig;
  const tentou = useRef<string>('');

  async function gerar() {
    setLoading(true);
    setErro('');
    try {
      const d = getData();
      const r = await chatJSON<Partial<Tips>>(d, tipsMessages(d, month), 0.4);
      const lista = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 5) : []);
      const novo: Tips = { assinatura: signature(getData(), month), geradoEm: Date.now(), bom: lista(r.bom), melhorar: lista(r.melhorar), proximos: lista(r.proximos) };
      setDataRaw((x) => ({ ...x, tips: { ...x.tips, [month]: novo } }));
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  // Gera as dicas sozinho quando os dados do mês mudaram (uma tentativa por assinatura).
  useEffect(() => {
    if (online && desatualizado && registrados > 0 && !loading && tentou.current !== `${month}|${sig}`) {
      tentou.current = `${month}|${sig}`;
      void gerar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, sig, month, registrados]);

  function mudarMes(n: number) {
    const m = addMonths(month, n);
    setMonth(m);
    setSel(m === monthKey(today) ? today : `${m}-01`);
  }

  return (
    <>
      <section className="card hero">
        <span className="hero-label">{formatMonth(month)}</span>
        <h2 className="hero-title">
          {counts.good} {counts.good === 1 ? 'dia bom' : 'dias bons'}
        </h2>
        <p className="hero-sub">{registrados === 1 ? '1 dia com registro' : `${registrados} dias com registro`} neste mês</p>
        <div className="hero-stats">
          <div>
            <strong>{treinos}</strong>
            <span>treinos</span>
          </div>
          <div>
            <strong>{Math.round(mediaKcal).toLocaleString('pt-BR')}</strong>
            <span>kcal média</span>
          </div>
          <div>
            <strong>{counts.bad}</strong>
            <span>dias ruins</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <button className="icon-btn soft" aria-label="Mês anterior" onClick={() => mudarMes(-1)}>
            <IconBack />
          </button>
          <h2 className="m0">{formatMonth(month)}</h2>
          <button className="icon-btn soft" aria-label="Próximo mês" onClick={() => mudarMes(1)}>
            <IconNext />
          </button>
        </div>
        <div className="cal">
          {WEEK.map((w, i) => (
            <div key={i} className="cal-head">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`b${i}`} />
          ))}
          {days.map((d) => (
            <button
              key={d}
              className={`cal-day ${evals[d].status} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`}
              onClick={() => setSel(d)}
              aria-label={`${d}: ${STATUS_LABEL[evals[d].status]}`}
            >
              {Number(d.slice(8))}
              {evals[d].treinos.some((s) => s.status === 'concluida') && <i className="cal-dot" />}
            </button>
          ))}
        </div>
        <div className="legend small">
          <span>
            <i className="dot good" /> Bom {counts.good}
          </span>
          <span>
            <i className="dot ok" /> Mais ou menos {counts.ok}
          </span>
          <span>
            <i className="dot bad" /> Ruim {counts.bad}
          </span>
          <span>
            <i className="dot train" /> Treino
          </span>
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h3 className="m0">{formatLong(sel)}</h3>
          <span className={`badge ${selEval.status}`}>{STATUS_LABEL[selEval.status]}</span>
        </div>
        {selEval.motivos.length > 0 && (
          <ul className="reasons">
            {selEval.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {selEval.meals.length > 0 ? <MacroBars totals={selEval.totals} limits={data.settings.limits} /> : <p className="muted small">Sem refeições registradas.</p>}
        <div className="day-workout">
          <span>
            <span className="label">Treino</span>
            <br />
            {selEval.treinos.length ? selEval.treinos.map((s) => `${s.key} · ${s.titulo}`).join(', ') : selEval.faltas.length ? 'Falta' : <span className="muted">Nenhum</span>}
          </span>
          {selEval.treinos[0] && <span className="badge">{selEval.treinos[0].status === 'concluida' ? 'Concluído' : 'Parcial'}</span>}
        </div>
      </section>

      <div className="section-title">Dicas do coach</div>
      <section className="card">
        <div className="row between add-head">
          <div className="row">
            <span className="tile">
              <IconSparkle />
            </span>
            <div>
              <h2 className="m0">O que foi bom e o que melhorar</h2>
              <span className="muted small">
                {tips ? `Atualizado ${new Date(tips.geradoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Gerado com os dados do mês'}
              </span>
            </div>
          </div>
          <button className="icon-btn soft" aria-label="Atualizar dicas" disabled={loading || !online} onClick={() => void gerar()}>
            <IconSync className={loading ? 'spin' : ''} />
          </button>
        </div>
        {registrados === 0 && <p className="muted small">Registre refeições e treinos para receber dicas.</p>}
        {loading && !tips && <p className="muted small">Analisando o mês…</p>}
        {!online && desatualizado && <p className="muted small">Sem internet: as dicas são atualizadas quando a conexão voltar.</p>}
        {erro && <p className="error">{erro}</p>}
        {tips && (
          <div className={`tips ${loading ? 'dim' : ''}`}>
            <TipList title="Bom" items={tips.bom} />
            <TipList title="Pode melhorar" items={tips.melhorar} />
            <TipList title="Próximos passos" items={tips.proximos} />
            {desatualizado && !loading && <p className="muted small">Os dados mudaram desde esta análise.</p>}
          </div>
        )}
        <p className="muted small">Para perguntar algo, use o botão do coach no canto da tela.</p>
      </section>
    </>
  );
}

function TipList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="tip-group">
      <div className="label">{title}</div>
      <ul>
        {items.map((t) => (
          <li key={t}>
            <RichInline text={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}
