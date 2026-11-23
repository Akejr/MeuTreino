import { useEffect, useMemo, useRef, useState } from 'react';
import { useAIContext } from '../../components/AIChat';
import { IconAlert, IconBack, IconCheck, IconPause, IconPlus, IconSkip, IconSwap } from '../../components/Icons';
import { useNow } from '../../lib/hooks';
import { showSession } from '../../lib/sessionUI';
import { sessionContext } from '../../lib/prompts';
import { getData, useData } from '../../lib/storage';
import { fmtDur, todayISO } from '../../lib/utils';
import type { AppData, PlanSession, Session, SetLog } from '../../types';
import {
  acceptOffer,
  addExtraSlot,
  addRest,
  addWarmup,
  confirmStep,
  dismissOffer,
  finishSession,
  pauseSession,
  removeExtraSlot,
  setPainCheck,
  setSlotStatus,
  showNextAlternative,
  skipRest,
  skipStep,
} from '../../training/actions';
import Sheet from '../../components/Sheet';
import { BY_ID, getEx, GRUPO_LABEL } from '../../training/catalog';
import {
  dropCandidate,
  estimateSession,
  exposures,
  extraCandidates,
  extraSlot,
  fmtPct,
  fmtW,
  harder,
  sessionSteps,
  slotActive,
  slotSegments,
  stepCtx,
  suggestForStep,
  suggestNext,
  swapCandidates,
  unitOf,
  type Step,
} from '../../training/engine';
import { planSessionOf } from '../../training/schedule';
import {
  EditSetSheet,
  EquipmentCard,
  NextWeightAsk,
  OfferCard,
  PainCheckCard,
  PainSheet,
  QuestionCard,
  RestCard,
  RIR_MAIS,
  RIR_OPTS,
  Stepper,
  type RirPick,
} from './Cards';
import EndSheet from './EndSheet';
import { exName, ladoLabel, loadUnit, setLine, stepLabel, tipoCurto } from './shared';

function elapsedSec(s: Session, now: number) {
  return s.intervalos.reduce((n, iv) => n + ((iv.f ?? now) - iv.i), 0) / 1000;
}

export default function SessionView({ id, onExit }: { id: string; onExit: () => void }) {
  const data = useData();
  const hoje = todayISO();
  const s = data.sessions[id];
  const ps = s && planSessionOf(data, s);
  const now = useNow(1000, s?.status === 'em_andamento');
  const [editing, setEditing] = useState<SetLog | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  useAIContext(`sessao:${id}`, s ? `${s.key} · ${s.titulo}` : 'Treino', () => sessionContext(getData(), id), 1);
  const ativo = s?.status === 'em_andamento';
  // Mantém a sessão na tela depois de concluir/encerrar, para mostrar o resumo.
  useEffect(() => {
    if (ativo) showSession(id);
  }, [ativo, id]);

  if (!s || !ps) return null;
  const t = data.settings.training;
  const steps = sessionSteps(ps, s, t).filter((st) => slotActive(s, st.slotId));
  const pend = steps.filter((st) => !data.sets[st.id]);
  const step = s.status === 'em_andamento' ? pend[0] : undefined;
  const resting = !!s.descansoAte && s.descansoAte > now;
  const done = steps.length - pend.length;
  const elapsed = elapsedSec(s, now);
  const restante = estimateSession(ps, t, s, data);
  const drop = dropCandidate(ps, s);
  const dropFeito = drop && sessionSteps(ps, s, t).some((st) => st.slotId === drop.id && data.sets[st.id]);
  const passa = s.status === 'em_andamento' && elapsed / 60 + restante > t.duracaoMin + 3 && drop && !dropFeito && pend.some((p) => p.slotId === drop.id);
  const alerta = Object.values(data.sets).some((x) => x.sessionId === id && x.dorTipo === 'alerta');

  function pausar() {
    setEndOpen(false);
    pauseSession(id);
    showSession(null);
  }

  function concluir() {
    showSession(id);
    finishSession(id);
  }

  return (
    <div className="session">
      <div className="session-top">
        {ativo ? (
          <button className="round-btn" aria-label="Pausar treino" onClick={pausar}>
            <IconPause />
          </button>
        ) : (
          <button className="round-btn" aria-label="Voltar" onClick={onExit}>
            <IconBack />
          </button>
        )}
        <div className="grow">
          <div className="eyebrow">
            {s.status === 'em_andamento' ? 'Em andamento' : s.status === 'concluida' ? 'Concluído' : 'Encerrado'} · {fmtDur(elapsed)}
          </div>
          <div className="session-title">
            {s.key} · {s.titulo}
          </div>
        </div>
        <span className="badge">
          {done}/{steps.length}
        </span>
      </div>
      <div className="progress dark">
        <div style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
      </div>

      {alerta && (
        <section className="card alert">
          <h2>
            <IconAlert className="i18" /> Pare o treino agora
          </h2>
          <p>Procure avaliação médica antes de voltar a treinar. Se a dor no peito continuar ou for forte, ligue 192 (SAMU).</p>
        </section>
      )}

      {passa && drop && (
        <div className="notice action">
          <span className="grow">
            Pelo ritmo, a sessão passa de {t.duracaoMin} min. Pode tirar hoje: <strong>{exName(drop.exerciseId)}</strong>.
          </span>
          <button className="btn small" onClick={() => setSlotStatus(id, drop.id, 'removido')}>
            Tirar
          </button>
        </div>
      )}

      {resting && s.descansoAte && <RestCard ate={s.descansoAte} total={s.descansoSeg ?? 60} onAdd={() => addRest(id, 30)} onSkip={() => skipRest(id)} />}

      {step && <CurrentStep key={step.id} s={s} ps={ps} step={step} data={data} hoje={hoje} />}

      {s.status === 'em_andamento' && !step && (
        <section className="card hero">
          <span className="hero-label">Tudo feito</span>
          <h2 className="hero-title">Treino completo</h2>
          <p className="hero-sub">{fmtDur(elapsed)} de treino. Confira o resumo e conclua para salvar.</p>
          <button className="btn light block" onClick={concluir}>
            <IconCheck /> Concluir treino
          </button>
        </section>
      )}

      {s.status !== 'em_andamento' && <Summary s={s} ps={ps} data={data} />}

      <div className="section-title">Exercícios</div>
      <SlotList s={s} ps={ps} data={data} current={step} onEdit={setEditing} />

      {s.status === 'em_andamento' && (
        <button className="btn block outline mt12" onClick={() => setAddOpen(true)}>
          <IconPlus /> Adicionar exercício
        </button>
      )}
      {s.status === 'em_andamento' && (
        <button className="btn block outline mt12" onClick={() => setEndOpen(true)}>
          Encerrar treino
        </button>
      )}
      {s.status !== 'em_andamento' && (
        <button className="btn block primary mt12" onClick={onExit}>
          Voltar ao início
        </button>
      )}

      <EndSheet data={data} s={s} open={endOpen} onClose={() => setEndOpen(false)} />
      <AddExerciseSheet open={addOpen} s={s} ps={ps} data={data} onClose={() => setAddOpen(false)} />

      <EditSetSheet set={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CurrentStep({ s, ps, step, data, hoje }: { s: Session; ps: PlanSession; step: Step; data: AppData; hoje: string }) {
  const slot = ps.slots.find((x) => x.id === step.slotId)!;
  const st = s.slots[slot.id];
  const ex = getEx(step.exerciseId);
  const eq = data.equipment[ex.equip];

  if (ex.pergunta) return <QuestionCard qid={ex.pergunta} exNome={ex.nome} />;
  if (!eq) return <EquipmentCard ex={ex} />;

  const slotFeito = Object.values(data.sets).some((x) => x.sessionId === s.id && x.slotId === slot.id);
  const ultimaComDor = exposures(data.sets, step.exerciseId, undefined, s.id).find((e) => e.trabalho.length)?.trabalho.some((x) => x.dor);
  if (ultimaComDor && !st?.dorCheck && !slotFeito) return <PainCheckCard exNome={ex.nome} onAnswer={(r) => setPainCheck(s.id, slot.id, r)} />;

  if (st?.oferta) {
    const segs = slotSegments(slot, st, data.settings.training);
    return (
      <OfferCard
        atual={segs[segs.length - 1].exerciseId}
        oferta={st.oferta}
        temMais={swapCandidates(ps, s, slot.id, data).length > 0}
        onUse={(m, evitar) => acceptOffer(s.id, slot.id, m, evitar)}
        onNext={() => showNextAlternative(s.id, slot.id)}
        onBack={() => dismissOffer(s.id, slot.id)}
        onSkip={() => setSlotStatus(s.id, slot.id, 'pulado')}
      />
    );
  }

  return <StepCard s={s} ps={ps} step={step} data={data} hoje={hoje} />;
}

function StepCard({ s, ps, step, data, hoje }: { s: Session; ps: PlanSession; step: Step; data: AppData; hoje: string }) {
  const slot = ps.slots.find((x) => x.id === step.slotId)!;
  const ex = getEx(step.exerciseId);
  const eq = data.equipment[ex.equip];
  const u = unitOf(eq);
  const corporal = eq?.base === 'corporal';
  const sug = useMemo(() => suggestForStep(step, s, slot, data, hoje), [step, s, slot, data, hoje]);
  const [carga, setCarga] = useState(sug.carga != null ? String(sug.carga) : '');
  const [reps, setReps] = useState<number>(sug.reps ?? slot.repMin);
  const [ajuda, setAjuda] = useState(false);
  const [dor, setDor] = useState(false);
  const [painFor, setPainFor] = useState<RirPick | null>(null);
  /** Tocou em 4+: pergunta quantas sobraram, aproximadamente. */
  const [mais, setMais] = useState(false);
  const lock = useRef(0);

  useEffect(() => {
    setCarga(sug.carga != null ? String(sug.carga) : '');
    setReps(sug.reps ?? (step.tipo === 'aquecimento' ? 8 : step.tipo === 'aproximacao' ? 4 : slot.repMin));
  }, [sug.carga, sug.reps, step.tipo, slot.repMin]);

  const cargaNum = carga.trim() === '' ? null : Number(carga.replace(',', '.'));
  const cargaOk = corporal || (cargaNum != null && !Number.isNaN(cargaNum) && cargaNum >= 0);
  const isWork = step.tipo === 'trabalho';
  const plan = sug.plan;
  const perguntar = isWork && sug.perguntarProximo != null;
  const candidatos = swapCandidates(ps, s, slot.id, data);

  function confirm(pick: RirPick, dorTipo?: SetLog['dorTipo']) {
    if (Date.now() < lock.current) return;
    if (!cargaOk) return;
    if (dor && !dorTipo) {
      setPainFor(pick);
      return;
    }
    lock.current = Date.now() + 800;
    setMais(false);
    confirmStep(s.id, step, {
      carga: corporal ? null : cargaNum,
      reps,
      rir: isWork ? pick.rir : null,
      rirAprox: pick.aprox,
      rirMais: pick.mais,
      ajuda,
      dor: !!dorTipo,
      dorTipo,
      cargaSugerida: sug.carga,
      metaReps: sug.reps,
      sequencia: sug.sequencia,
    });
  }

  function bump(dir: 1 | -1) {
    const cur = cargaNum ?? 0;
    const known = (eq?.conhecidos ?? []).filter((k) => (dir > 0 ? k > cur : k < cur));
    const nextKnown = known.length ? (dir > 0 ? Math.min(...known) : Math.max(...known)) : undefined;
    const delta = eq?.base === 'por_halter' ? 1 : u === 'lb' ? 5 : 2.5;
    const nx = nextKnown ?? Math.max(0, cur + dir * delta);
    setCarga(String(nx));
  }

  const primeira = isWork && !Object.values(data.sets).some((x) => x.sessionId === s.id && x.exerciseId === step.exerciseId && x.tipo === 'trabalho' && x.status === 'feita');
  const nxt = primeira && plan?.refCarga != null ? harder(eq, plan.refCarga) : undefined;

  return (
    <section className="card step">
      {(step.lado || (plan?.revisarFaixa && isWork)) && (
        <div className="step-head">
          {step.lado && <span className="tag">{ladoLabel(step.lado)}</span>}
          {plan?.revisarFaixa && isWork && <span className="tag">Revisar faixa</span>}
        </div>
      )}
      <h2 className="step-title">{ex.nome}</h2>
      <div className="step-sub">{stepLabel(step, slot)}</div>

      <p className="suggest">{sug.motivo}</p>
      {sug.dica && <p className="muted small">{sug.dica}</p>}
      {isWork && step.posicao === 1 && slot.dica && <p className="muted small">Execução: {slot.dica}</p>}
      {primeira && !sug.opcao && plan?.salto && plan.acao !== 'subir' && nxt != null && (
        <p className="muted small">
          Próximo degrau registrado: {fmtW(nxt)} {u}
          {plan.salto.pct != null ? ` (${eq?.base === 'assistencia' ? '' : '+'}${fmtPct(plan.salto.pct)})` : ''}.
        </p>
      )}

      {perguntar && eq && (
        <NextWeightAsk equipId={ex.equip} de={sug.perguntarProximo!} assist={eq.base === 'assistencia'} unidade={u} motivo="Para decidir o aumento, o app precisa saber o próximo peso real desta máquina." />
      )}
      {sug.opcao && (
        <button
          className={`btn block small ${cargaNum === sug.opcao.carga ? 'primary' : 'outline'}`}
          onClick={() => {
            setCarga(String(sug.opcao!.carga));
            setReps(sug.opcao!.reps);
          }}
        >
          {sug.opcao.texto}
        </button>
      )}

      <div className="inputs">
        {!corporal && (
          <div className="field">
            <span>
              Peso <em className="unit">{loadUnit(eq)}</em>
            </span>
            <div className="weight">
              <button aria-label="Diminuir peso" onClick={() => bump(-1)}>
                −
              </button>
              <input inputMode="decimal" value={carga} placeholder="—" onChange={(e) => setCarga(e.target.value)} onFocus={(e) => e.target.select()} />
              <button aria-label="Aumentar peso" onClick={() => bump(1)}>
                +
              </button>
            </div>
          </div>
        )}
        <div className="field">
          <span>Repetições completas{ex.unilateral ? ' (este lado)' : ''}</span>
          <Stepper value={reps} onChange={setReps} min={0} max={50} />
        </div>
      </div>
      {sug.voltarPara != null && (
        <button className="link small" onClick={() => setCarga(String(sug.voltarPara))}>
          Usar {fmtW(sug.voltarPara)} {u} (carga anterior)
        </button>
      )}
      {!cargaOk && <p className="muted small">Informe o peso usado para registrar.</p>}

      <div className="chips">
        <button className={`chip ${ajuda ? 'on' : ''}`} onClick={() => setAjuda(!ajuda)}>
          Com ajuda
        </button>
        <button className={`chip ${dor ? 'on' : ''}`} onClick={() => setDor(!dor)}>
          Senti dor
        </button>
      </div>

      {isWork && !mais && (
        <>
          <div className="label mt8">Quantas repetições a mais você conseguiria?</div>
          <div className="rir">
            {RIR_OPTS.map((o) => (
              <button
                key={o.label}
                className={o.v === null ? 'wide' : ''}
                disabled={!cargaOk}
                onClick={() => (o.abre ? setMais(true) : confirm({ rir: o.v }))}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="hint">Tocar no número registra a série.</p>
        </>
      )}
      {isWork && mais && (
        <>
          <div className="row between mt8">
            <span className="label">4 ou mais: quantas, aproximadamente?</span>
            <button className="link small" onClick={() => setMais(false)}>
              Voltar
            </button>
          </div>
          <div className="rir">
            {RIR_MAIS.map((o) => (
              <button key={o.label} className={o.label.length > 3 ? 'wide' : ''} disabled={!cargaOk} onClick={() => confirm({ rir: o.rir, aprox: o.aprox, mais: o.mais })}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="hint">Tocar registra a série.</p>
        </>
      )}
      {!isWork && (
        <div className="row gap mt12">
          <button className="btn grow" onClick={() => skipStep(s.id, step)}>
            Pular
          </button>
          <button className="btn primary grow2" disabled={!cargaOk} onClick={() => confirm({ rir: null })}>
            <IconCheck /> Registrar
          </button>
        </div>
      )}

      <div className="step-actions">
        {candidatos.length > 0 && (
          <button className="link-btn" onClick={() => showNextAlternative(s.id, slot.id)}>
            <IconSwap /> Trocar exercício
          </button>
        )}
        <button className="link-btn" onClick={() => addWarmup(s.id, slot.id)}>
          <IconPlus /> Aquecimento
        </button>
        <button className="link-btn" onClick={() => setSlotStatus(s.id, slot.id, 'pulado')}>
          <IconSkip /> Pular exercício
        </button>
      </div>

      <PainSheet
        open={!!painFor}
        onClose={() => setPainFor(null)}
        onPick={(tipo) => {
          const pick = painFor ?? { rir: null };
          setPainFor(null);
          confirm(pick, tipo);
        }}
      />
    </section>
  );
}

/** Exercício extra só neste treino, escolhido entre os que trabalham os músculos de hoje. */
function AddExerciseSheet({ open, s, ps, data, onClose }: { open: boolean; s: Session; ps: PlanSession; data: AppData; onClose: () => void }) {
  if (!open) return null;
  const ids = extraCandidates(ps, s, data.settings.training);
  const grupos = [...new Set(ids.map((id) => getEx(id).grupo))];
  return (
    <Sheet open onClose={onClose} title="Adicionar exercício">
      <p className="muted small">Entra no fim deste treino, só hoje: a ficha e os outros dias não mudam. As opções trabalham os músculos do treino de hoje.</p>
      {!ids.length && <p className="small">Nenhum exercício relacionado disponível no catálogo.</p>}
      {grupos.map((g) => (
        <div key={g}>
          <div className="label mt12">{GRUPO_LABEL[g]}</div>
          <div className="stack">
            {ids
              .filter((id) => getEx(id).grupo === g)
              .map((id) => {
                const e = getEx(id);
                const sl = extraSlot('', id);
                return (
                  <button
                    key={id}
                    className="option"
                    onClick={() => {
                      addExtraSlot(s.id, id);
                      onClose();
                    }}
                  >
                    <span className="option-title">{e.nome}</span>
                    <span className="option-desc">
                      {sl.series} × {sl.repMin}–{sl.repMax}
                      {e.unilateral ? ' por lado' : ''} · descanso {fmtDur(sl.descansoSeg)}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function Summary({ s, ps, data }: { s: Session; ps: PlanSession; data: AppData }) {
  const t = data.settings.training;
  const hoje = todayISO();
  const minutos = Math.round((s.duracaoSeg ?? 0) / 60);
  return (
    <section className="card hero">
      <span className="hero-label">{s.status === 'concluida' ? 'Treino concluído e salvo' : 'Treino encerrado e salvo'}</span>
      <h2 className="hero-title">{minutos} min</h2>
      <div className="summary">
        {ps.slots.map((slot) => {
          const sets = Object.values(data.sets)
            .filter((x) => x.sessionId === s.id && x.slotId === slot.id && x.tipo === 'trabalho' && x.status === 'feita')
            .sort((a, b) => a.posicao - b.posicao || (a.lado ?? '').localeCompare(b.lado ?? ''));
          const exIds = [...new Set(sets.map((x) => x.exerciseId))];
          const st = s.slots[slot.id];
          if (!sets.length) {
            return (
              <div key={slot.id} className="sum-row">
                <strong>{exName(slotSegments(slot, st, t)[0].exerciseId)}</strong>
                <span>{st?.status === 'removido' ? 'retirado por tempo' : st?.status === 'dor' ? 'interrompido por dor' : 'não feito'}</span>
              </div>
            );
          }
          return exIds.map((exId) => {
            const mine = sets.filter((x) => x.exerciseId === exId);
            const lados = getEx(exId).unilateral ? (['D', 'E'] as const) : [undefined];
            const ctx = stepCtx(data, slot, exId, hoje);
            const metas = lados.map((l) => suggestNext(exId, l, ctx).motivo);
            return (
              <div key={`${slot.id}-${exId}`} className="sum-row">
                <strong>{BY_ID[exId]?.nome ?? exId}</strong>
                <span>{mine.map((x) => `${x.lado ? `${x.lado} ` : ''}${x.carga != null ? fmtW(x.carga) + '×' : ''}${x.reps}`).join('  ')}</span>
                <span className="sum-next">Próxima: {metas[0]}</span>
              </div>
            );
          });
        })}
      </div>
    </section>
  );
}

function SlotList({ s, ps, data, current, onEdit }: { s: Session; ps: PlanSession; data: AppData; current?: Step; onEdit: (x: SetLog) => void }) {
  const t = data.settings.training;
  const all = sessionSteps(ps, s, t);
  return (
    <div className="slot-list">
      {ps.slots.map((slot) => {
        const st = s.slots[slot.id];
        const segs = slotSegments(slot, st, t);
        const mine = all.filter((x) => x.slotId === slot.id);
        const work = mine.filter((x) => x.tipo === 'trabalho');
        const feitos = work.filter((x) => data.sets[x.id]?.status === 'feita').length;
        const registros = Object.values(data.sets)
          .filter((x) => x.sessionId === s.id && x.slotId === slot.id)
          .sort((a, b) => a.confirmadoEm - b.confirmadoEm);
        const status = st?.status ?? 'ativo';
        const isCur = current?.slotId === slot.id;
        const extra = !!s.extras?.some((x) => x.id === slot.id);
        return (
          <div key={slot.id} className={`slot ${isCur ? 'cur' : ''} ${status !== 'ativo' ? 'off' : ''} ${work.length && feitos === work.length ? 'done' : ''}`}>
            <div className="slot-head">
              <div className="grow">
                <div className="slot-name">{segs.map((x) => exName(x.exerciseId)).join(' → ')}</div>
                <div className="muted small">
                  {extra ? 'Só hoje · ' : ''}
                  {slot.series}× {slot.repMin}–{slot.repMax}
                  {getEx(segs[segs.length - 1].exerciseId).unilateral ? ' por lado' : ''} · descanso {fmtDur(slot.descansoSeg)}
                  {status === 'pulado' ? ' · pulado' : status === 'dor' ? ' · interrompido por dor' : status === 'removido' ? ' · retirado por tempo' : ''}
                </div>
                {extra && !registros.length && s.status === 'em_andamento' && (
                  <button className="link small" onClick={() => removeExtraSlot(s.id, slot.id)}>
                    Remover
                  </button>
                )}
              </div>
              <span className="count">
                {feitos}/{work.length}
              </span>
            </div>
            {registros.length > 0 && (
              <div className="sets">
                {registros.map((x) => (
                  <button key={x.id} className="set-row" onClick={() => x.status === 'feita' && onEdit(x)}>
                    <span>{tipoCurto(x)}</span>
                    <span>{setLine(x)}</span>
                  </button>
                ))}
              </div>
            )}
            {status !== 'ativo' && s.status === 'em_andamento' && (
              <button className="link small" onClick={() => setSlotStatus(s.id, slot.id, 'ativo')}>
                Desfazer
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
