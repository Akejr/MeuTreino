import { useEffect, useState } from 'react';
import { IconSparkle } from '../../components/Icons';
import Sheet from '../../components/Sheet';
import { useOnline } from '../../lib/hooks';
import { chatJSON } from '../../lib/openrouter';
import { planMessages } from '../../lib/prompts';
import { getData } from '../../lib/storage';
import { addDays, errMsg, fmtDur, todayISO, uid, weekStart } from '../../lib/utils';
import type { AppData, PlanSlot, PlanVersion } from '../../types';
import { activatePlan, nextPlanVersion } from '../../training/actions';
import { getEx, GRUPO_LABEL, resolveExercise, type Grupo } from '../../training/catalog';
import { estimateSession, planVolume, realizedVolume, type Volume } from '../../training/engine';
import { validatePlan, type AIPlan } from '../../training/planAI';
import { activePlan } from '../../training/schedule';
import { Stepper } from './Cards';
import { minutes } from './shared';

const DIA = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

export default function Ficha({ data }: { data: AppData }) {
  const plan = activePlan(data);
  const online = useOnline();
  const [edit, setEdit] = useState<{ sessionKey: string; slot: PlanSlot } | null>(null);
  const [pedido, setPedido] = useState('');
  const [loading, setLoading] = useState<'revisar' | 'nova' | null>(null);
  const [erro, setErro] = useState('');
  const [proposta, setProposta] = useState<{ plan?: PlanVersion; erros: string[]; avisos: string[]; mudancas: string[] } | null>(null);
  const t = data.settings.training;
  const w = weekStart(todayISO());

  async function gerar(modo: 'revisar' | 'nova') {
    setLoading(modo);
    setErro('');
    setProposta(null);
    try {
      const d = getData();
      const raw = await chatJSON<AIPlan>(d, planMessages(d, modo, pedido), 0.4);
      setProposta(validatePlan(raw, d, nextPlanVersion(d)));
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLoading(null);
    }
  }

  if (!plan) return <p className="muted pad">Nenhuma ficha ativa.</p>;
  const versoes = Object.values(data.plans).sort((a, b) => b.versao - a.versao);

  return (
    <>
      <section className="card hero">
        <span className="hero-label">
          Ficha ativa · v{plan.versao} · desde {plan.vigenciaInicio.split('-').reverse().join('/')}
        </span>
        <h2 className="hero-title">{plan.nome}</h2>
        {plan.resumo && <p className="hero-sub">{plan.resumo}</p>}
        <div className="hero-stats">
          <div>
            <strong>{plan.sessoes.length}</strong>
            <span>sessões</span>
          </div>
          <div>
            <strong>{plan.sessoes.reduce((n, s) => n + s.slots.reduce((m, x) => m + x.series, 0), 0)}</strong>
            <span>séries/semana</span>
          </div>
          <div>
            <strong>{minutes(plan.sessoes.reduce((n, s) => n + estimateSession(s, t), 0) / plan.sessoes.length)}</strong>
            <span>média</span>
          </div>
        </div>
      </section>

      <div className="section-title">Volume semanal</div>
      <VolumeTable previsto={planVolume(plan, t)} feito={realizedVolume(data.sets, w, addDays(w, 6))} />
      <p className="muted small pad">Diretas: o músculo é o alvo do exercício. Indiretas: ele ajuda (ex.: tríceps no supino). Aquecimentos não contam.</p>

      <div className="section-title">Sessões</div>
      {plan.sessoes.map((s) => (
        <section key={s.key} className="card">
          <div className="row between">
            <div>
              <div className="eyebrow">
                {DIA[s.dia]} · {minutes(estimateSession(s, t))} · {s.slots.reduce((n, x) => n + x.series, 0)} séries
              </div>
              <h2 className="m0">
                {s.key} · {s.titulo}
              </h2>
            </div>
          </div>
          <div className="plan-slots">
            {s.slots.map((sl, i) => {
              const exId = resolveExercise(sl.exerciseId, t) ?? sl.exerciseId;
              const ex = getEx(exId);
              return (
                <button key={sl.id} className="plan-slot" onClick={() => setEdit({ sessionKey: s.key, slot: sl })}>
                  <span className="num">{i + 1}</span>
                  <div className="grow">
                    <div className="strong">{ex.nome}</div>
                    <div className="muted small">
                      {sl.series} × {sl.repMin}–{sl.repMax}
                      {ex.unilateral ? ' por lado' : ''} · reserva {sl.rirMin}–{sl.rirMax} · descanso {fmtDur(sl.descansoSeg)}
                      {sl.limitePct != null ? ` · aumento até ${sl.limitePct}%` : ''}
                      {sl.sairPrimeiro ? ' · sai primeiro se faltar tempo' : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div className="section-title">Revisar com IA</div>
      <section className="card">
        <div className="row add-head">
          <span className="tile">
            <IconSparkle />
          </span>
          <div className="grow">
            <h2 className="m0">Personal IA</h2>
            <span className="muted small">Usa seu histórico real. A proposta só vale depois que você ativar.</span>
          </div>
        </div>
        <textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: quero priorizar braços; não posso na quarta; joelho sensível…" />
        <div className="row gap">
          <button className="btn grow" disabled={!!loading || !online} onClick={() => gerar('revisar')}>
            {loading === 'revisar' ? 'Analisando…' : 'Revisar ficha'}
          </button>
          <button className="btn primary grow" disabled={!!loading || !online} onClick={() => gerar('nova')}>
            {loading === 'nova' ? 'Montando…' : 'Ficha nova'}
          </button>
        </div>
        {!online && <p className="muted small">Precisa de internet.</p>}
        {erro && <p className="error">{erro}</p>}
      </section>

      {proposta && <Proposta p={proposta} data={data} onDiscard={() => setProposta(null)} />}

      <div className="section-title">Versões</div>
      <div className="list-card">
        {versoes.map((p) => (
          <div key={p.id} className="hist-item">
            <div className="grow">
              <div className="strong">
                v{p.versao} · {p.nome}
              </div>
              <div className="muted small">
                {p.status === 'ativa' ? 'Ativa' : 'Arquivada'} · {p.origem} · {p.vigenciaInicio}
                {p.vigenciaFim ? ` até ${p.vigenciaFim}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      <EditSlotSheet plan={plan} edit={edit} onClose={() => setEdit(null)} data={data} />
    </>
  );
}

function VolumeTable({ previsto, feito }: { previsto: Volume; feito: Volume }) {
  const grupos = [...new Set([...Object.keys(previsto), ...Object.keys(feito)])] as Grupo[];
  grupos.sort((a, b) => (previsto[b]?.diretas ?? 0) - (previsto[a]?.diretas ?? 0));
  return (
    <section className="card tight">
      <div className="vol head">
        <span>Grupo</span>
        <span>Diretas</span>
        <span>Indiretas</span>
        <span>Feitas</span>
      </div>
      {grupos.map((g) => (
        <div key={g} className="vol">
          <span>{GRUPO_LABEL[g]}</span>
          <span className="strong">{previsto[g]?.diretas ?? 0}</span>
          <span>{previsto[g]?.indiretas ?? 0}</span>
          <span>{feito[g]?.diretas ?? 0}</span>
        </div>
      ))}
    </section>
  );
}

function Proposta({ p, data, onDiscard }: { p: { plan?: PlanVersion; erros: string[]; avisos: string[]; mudancas: string[] }; data: AppData; onDiscard: () => void }) {
  const t = data.settings.training;
  if (!p.plan) {
    return (
      <section className="card">
        <h2>Proposta recusada pelo app</h2>
        <p className="muted small">A resposta da IA não passou na validação. Nada foi alterado.</p>
        <ul className="plain">
          {p.erros.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <button className="btn block" onClick={onDiscard}>
          Fechar
        </button>
      </section>
    );
  }
  const plan = p.plan;
  return (
    <section className="card proposal">
      <span className="eyebrow">Proposta · v{plan.versao}</span>
      <h2 className="mt8">Nova ficha sugerida</h2>
      {plan.resumo && <p className="small">{plan.resumo}</p>}
      {p.mudancas.length > 0 && (
        <ul className="plain">
          {p.mudancas.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {p.avisos.map((a) => (
        <p key={a} className="notice">
          {a}
        </p>
      ))}
      {plan.sessoes.map((s) => (
        <div key={s.key} className="prop-session">
          <div className="strong">
            {s.key} · {DIA[s.dia]} · {s.titulo} · {minutes(estimateSession(s, t))}
          </div>
          {s.slots.map((sl) => (
            <div key={sl.id} className="muted small">
              {getEx(sl.exerciseId).nome} · {sl.series}×{sl.repMin}–{sl.repMax} · {fmtDur(sl.descansoSeg)}
            </div>
          ))}
        </div>
      ))}
      <div className="section-title">Volume da proposta</div>
      <VolumeTable previsto={planVolume(plan, t)} feito={{}} />
      <div className="row gap">
        <button className="btn grow" onClick={onDiscard}>
          Descartar
        </button>
        <button
          className="btn primary grow"
          onClick={() => {
            activatePlan(plan);
            onDiscard();
          }}
        >
          Ativar a partir de hoje
        </button>
      </div>
      <p className="muted small">A ficha atual fica guardada no histórico. Treinos já feitos não mudam.</p>
    </section>
  );
}

function EditSlotSheet({ plan, edit, onClose, data }: { plan: PlanVersion; edit: { sessionKey: string; slot: PlanSlot } | null; onClose: () => void; data: AppData }) {
  const [v, setV] = useState<PlanSlot | null>(null);
  useEffect(() => {
    setV(edit ? { ...edit.slot } : null);
  }, [edit]);
  if (!edit || !v) return null;
  const ex = getEx(resolveExercise(v.exerciseId, data.settings.training) ?? v.exerciseId);
  const limiteGeral = data.settings.training.limitePct;
  const valido = v.repMin < v.repMax && v.series >= 1;
  function salvar() {
    const novo: PlanVersion = {
      ...plan,
      id: uid(),
      versao: nextPlanVersion(getData()),
      nome: `${plan.nome.replace(/ · editada$/, '')} · editada`,
      origem: 'manual',
      criadoEm: Date.now(),
      status: 'proposta',
      vigenciaFim: undefined,
      _u: undefined,
      sessoes: plan.sessoes.map((s) => (s.key === edit!.sessionKey ? { ...s, slots: s.slots.map((x) => (x.id === v!.id ? v! : x)) } : s)),
    };
    activatePlan(novo);
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={ex.nome}>
      <p className="muted small">Salvar cria uma nova versão da ficha a partir de hoje. A versão atual fica no histórico.</p>
      <div className="grid2">
        <div className="field">
          <span>Séries</span>
          <Stepper value={v.series} onChange={(n) => setV({ ...v, series: n })} min={1} max={6} />
        </div>
        <div className="field">
          <span>Descanso (s)</span>
          <Stepper value={v.descansoSeg} onChange={(n) => setV({ ...v, descansoSeg: n })} min={30} max={300} />
        </div>
        <div className="field">
          <span>Reps mín.</span>
          <Stepper value={v.repMin} onChange={(n) => setV({ ...v, repMin: n })} min={1} max={30} />
        </div>
        <div className="field">
          <span>Reps máx.</span>
          <Stepper value={v.repMax} onChange={(n) => setV({ ...v, repMax: n })} min={2} max={40} />
        </div>
      </div>
      <div className="field">
        <span>Maior aumento automático nesta vaga (%)</span>
        <div className="chips">
          {[undefined, 5, 10, 15, 20, 25].map((p) => (
            <button key={String(p)} className={`chip ${v.limitePct === p ? 'on' : ''}`} onClick={() => setV({ ...v, limitePct: p })}>
              {p == null ? `Geral (${limiteGeral}%)` : `${p}%`}
            </button>
          ))}
        </div>
      </div>
      {!valido && <p className="error">O mínimo de repetições precisa ser menor que o máximo.</p>}
      <button className="btn primary block" disabled={!valido} onClick={salvar}>
        Salvar como nova versão
      </button>
    </Sheet>
  );
}
