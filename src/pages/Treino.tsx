import { useEffect, useState } from 'react';
import { useAIContext } from '../components/AIChat';
import { IconAlert, IconDown, IconNext, IconPlay, IconTreino } from '../components/Icons';
import Segmented from '../components/Segmented';
import Sheet from '../components/Sheet';
import { trainingContext } from '../lib/prompts';
import { getData, useData } from '../lib/storage';
import { dayLabel, dow, formatShort, todayISO, weekdayName, WEEKDAY_SHORT } from '../lib/utils';
import type { AppData, Session } from '../types';
import { applyReschedule, ensureTraining, finishSession, markNoMakeup, moveTo, setSlotStatus, skipToday, startSession } from '../training/actions';
import { getEx, resolveExercise } from '../training/catalog';
import { dropCandidate, estimateSession, exposures, fmtW, medianDuration, slotActive, stepCtx, suggestNext, unitOf } from '../training/engine';
import { computeReschedule, inQueue, isPaused, nextSession, openFromPast, overdue, planSessionOf, queue, weekView, type Change } from '../training/schedule';
import Agenda from './treino/Agenda';
import Ficha from './treino/Ficha';
import { MovePicker } from './treino/MovePicker';
import SessionPreview from './treino/SessionPreview';
import { exName, minutes } from './treino/shared';

type View = 'proximo' | 'agenda' | 'ficha';

export default function Treino() {
  const data = useData();
  const hoje = todayISO();
  const [view, setView] = useState<View>('proximo');
  useEffect(() => {
    ensureTraining(hoje);
  }, [hoje]);
  useAIContext(`treino:${view}`, view === 'ficha' ? 'Ficha de treino' : view === 'agenda' ? 'Agenda de treinos' : 'Próximo treino', () => trainingContext(getData()));

  return (
    <>
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: 'proximo', label: 'Próximo' },
          { value: 'agenda', label: 'Agenda' },
          { value: 'ficha', label: 'Ficha' },
        ]}
      />
      {view === 'proximo' && <Proximo data={data} hoje={hoje} onAgenda={() => setView('agenda')} />}
      {view === 'agenda' && <Agenda data={data} hoje={hoje} />}
      {view === 'ficha' && <Ficha data={data} />}
    </>
  );
}

function fmtDia(iso: string) {
  return `${weekdayName(iso)} ${iso.slice(8)}/${iso.slice(5, 7)}`;
}

function Proximo({ data, hoje, onAgenda }: { data: AppData; hoje: string; onAgenda: () => void }) {
  const [resched, setResched] = useState<{ changes: Change[]; mensagem: string; avisos: string[] } | null>(null);
  const [mover, setMover] = useState<Session | null>(null);
  const [preview, setPreview] = useState<Session | null>(null);
  const [msg, setMsg] = useState('');
  const atrasadas = overdue(data, hoje);
  const passada = openFromPast(data, hoje);
  const next = nextSession(data);
  const ps = next && planSessionOf(data, next);
  const t = data.settings.training;
  const proximos = queue(data)
    .filter((s) => s.id !== next?.id && s.dataAtual >= hoje)
    .sort((a, b) => a.dataAtual.localeCompare(b.dataAtual))
    .slice(0, 6);

  function mostrar(changes: Change[]) {
    setMsg(changes.length ? changes.map((c) => `${data.sessions[c.id]?.key}: ${fmtDia(c.de)} → ${fmtDia(c.para)}`).join(' · ') : '');
  }

  return (
    <>
      {passada && (
        <section className="card banner">
          <IconAlert className="i18" />
          <div className="grow">
            <strong>
              {passada.key} · {passada.titulo} ficou pausado desde {fmtDia(passada.dataReal ?? passada.dataAtual)}.
            </strong>
            <div className="row gap wrap mt8">
              <button className="btn small primary" onClick={() => startSession(passada.id)}>
                Continuar
              </button>
              <button className="btn small" onClick={() => finishSession(passada.id, 'encerrar')}>
                Encerrar com o realizado
              </button>
            </div>
          </div>
        </section>
      )}

      {atrasadas.length > 0 && !passada && (
        <section className="card banner">
          <IconAlert className="i18" />
          <div className="grow">
            <strong>
              {atrasadas.length === 1 ? 'Treino não feito' : `${atrasadas.length} treinos não feitos`}:{' '}
              {atrasadas.map((s) => `${s.key} (${fmtDia(s.dataAtual)})`).join(', ')}
            </strong>
            <p className="muted small">Os treinos concluídos ficam como estão. Só as pendências mudam de data.</p>
            <div className="row gap wrap">
              <button className="btn small primary" onClick={() => setResched(computeReschedule(data, hoje))}>
                Reorganizar agenda
              </button>
              <button className="btn small" onClick={() => markNoMakeup(atrasadas.map((s) => s.id))}>
                Não repor
              </button>
            </div>
          </div>
        </section>
      )}

      {msg && <p className="notice">Datas alteradas: {msg}</p>}

      {!next || !ps ? (
        <section className="card empty">
          <div className="empty-icon">
            <IconTreino />
          </div>
          <h2>Sem treino na fila</h2>
          <p className="muted small">Veja a ficha ou a agenda para planejar a semana.</p>
        </section>
      ) : (
        <NextCard data={data} s={next} hoje={hoje} onMove={() => setMover(next)} onSkipToday={() => mostrar(skipToday(next.id))} />
      )}

      {next && ps && <ExerciseList data={data} s={next} hoje={hoje} />}

      {proximos.length > 0 && (
        <>
          <div className="section-title">Próximos dias</div>
          <div className="list-card">
            {proximos.map((s) => {
              const p = planSessionOf(data, s);
              if (!p) return null;
              const series = p.slots.filter((x) => slotActive(s, x.id)).reduce((n, x) => n + x.series, 0);
              return (
                <button key={s.id} className="up-row" onClick={() => setPreview(s)}>
                  <div className="up-date">
                    <span className="wd">{WEEKDAY_SHORT[dow(s.dataAtual)]}</span>
                    <span className="dn">{s.dataAtual.slice(8)}</span>
                  </div>
                  <div className="grow">
                    <div className="strong">
                      {s.key} · {s.titulo}
                    </div>
                    <div className="muted small">
                      {minutes(medianDuration(data, s.key) ?? estimateSession(p, t, s))} · {series} séries
                      {s.retomar ? ' · restante' : s.dataAtual !== s.dataOriginal ? ` · era ${weekdayName(s.dataOriginal)}` : ''}
                    </div>
                  </div>
                  <IconNext className="chev" />
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="section-title row between">
        <span>Esta semana</span>
        <button className="link small" onClick={onAgenda}>
          Ver agenda
        </button>
      </div>
      <WeekStrip data={data} hoje={hoje} onPick={setPreview} />

      <Sheet open={!!resched} onClose={() => setResched(null)} title="Nova agenda">
        {resched && (
          <>
            <pre className="changes">{resched.mensagem}</pre>
            {resched.avisos.map((a) => (
              <p key={a} className="notice">
                {a}
              </p>
            ))}
            <p className="muted small">Sábado e domingo só entram se estiverem marcados como disponíveis em Ajustes. Nunca ficam duas sessões no mesmo dia.</p>
            <button
              className="btn primary block"
              disabled={!resched.changes.length}
              onClick={() => {
                applyReschedule(resched.changes);
                mostrar(resched.changes);
                setResched(null);
              }}
            >
              Confirmar novas datas
            </button>
          </>
        )}
      </Sheet>

      <SessionPreview
        data={data}
        s={preview}
        hoje={hoje}
        onClose={() => setPreview(null)}
        onMove={(s) => {
          setPreview(null);
          setMover(s);
        }}
      />

      <Sheet open={!!mover} onClose={() => setMover(null)} title={mover ? `Reagendar ${mover.key} · ${mover.titulo}` : ''}>
        {mover && (
          <MovePicker
            data={data}
            s={mover}
            hoje={hoje}
            onPick={(d) => {
              moveTo(mover.id, d);
              setMover(null);
            }}
          />
        )}
      </Sheet>
      {!t.dias.some((x) => x === 'treino') && <p className="notice">Nenhum dia está marcado como dia de treino em Ajustes.</p>}
    </>
  );
}

function NextCard({ data, s, hoje, onMove, onSkipToday }: { data: AppData; s: Session; hoje: string; onMove: () => void; onSkipToday: () => void }) {
  const ps = planSessionOf(data, s)!;
  const t = data.settings.training;
  const pausado = isPaused(s);
  const est = estimateSession(ps, t, s, s.inicio ? data : undefined);
  const mediana = medianDuration(data, s.key);
  const ativos = ps.slots.filter((x) => slotActive(s, x.id));
  const series = ativos.reduce((n, x) => n + x.series, 0);
  const drop = dropCandidate(ps, s);
  const longa = !s.inicio && estimateSession(ps, t, s) > t.duracaoMin && drop;
  const outraAberta = Object.values(data.sessions).some((x) => x.status === 'em_andamento' && x.id !== s.id);
  const removidos = ps.slots.filter((x) => s.slots[x.id]?.status === 'removido');
  const feitas = Object.values(data.sets).filter((x) => x.sessionId === s.id && x.tipo === 'trabalho' && x.status === 'feita').length;

  return (
    <section className="card hero">
      <span className="hero-label">{pausado ? `Pausado · ${feitas} séries feitas` : s.retomar ? 'Retomar o restante' : `Próximo treino · ${dayLabel(s.dataAtual)}`}</span>
      <h2 className="hero-title">
        {s.key} · {s.titulo}
      </h2>
      <p className="hero-sub">
        {formatShort(s.dataAtual)}
        {s.dataAtual !== s.dataOriginal ? ` · era ${fmtDia(s.dataOriginal)}` : ''}
      </p>
      <div className="hero-stats">
        <div>
          <strong>{minutes(s.inicio ? est : mediana ?? est)}</strong>
          <span>{s.inicio ? 'restante' : mediana ? 'mediana real' : 'estimativa'}</span>
        </div>
        <div>
          <strong>{series}</strong>
          <span>séries</span>
        </div>
        <div>
          <strong>{ativos.length}</strong>
          <span>exercícios</span>
        </div>
      </div>
      {longa && drop && (
        <div className="hero-note">
          Estimativa acima de {t.duracaoMin} min. Pode tirar <strong>{exName(drop.exerciseId)}</strong> hoje.
          <button className="btn small light mt8" onClick={() => setSlotStatus(s.id, drop.id, 'removido')}>
            Tirar hoje
          </button>
        </div>
      )}
      {removidos.length > 0 && (
        <div className="hero-note">
          Fora hoje: {removidos.map((x) => exName(x.exerciseId)).join(', ')}.{' '}
          <button className="link light" onClick={() => removidos.forEach((x) => setSlotStatus(s.id, x.id, 'ativo'))}>
            Desfazer
          </button>
        </div>
      )}
      <button className="btn light block mt12" disabled={outraAberta} onClick={() => startSession(s.id)}>
        <IconPlay /> {pausado ? 'Continuar treino' : s.retomar ? 'Retomar o restante' : 'Iniciar treino'}
      </button>
      {pausado && (
        <button className="btn ghost-light block mt8" onClick={() => finishSession(s.id, 'encerrar')}>
          Encerrar com o realizado
        </button>
      )}
      {s.status !== 'em_andamento' && (
        <div className="row gap mt8">
          <button className="btn ghost-light grow" onClick={onMove}>
            Reagendar
          </button>
          {s.dataAtual === hoje && (
            <button className="btn ghost-light grow" onClick={onSkipToday}>
              Hoje não vou
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ExerciseList({ data, s, hoje }: { data: AppData; s: Session; hoje: string }) {
  const ps = planSessionOf(data, s)!;
  const t = data.settings.training;
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <>
      <div className="section-title">Exercícios e última vez</div>
      <div className="list-card">
        {ps.slots.map((slot) => {
          const resolved = resolveExercise(slot.exerciseId, t);
          const exId = resolved ?? slot.exerciseId;
          const ex = getEx(exId);
          const ctx = stepCtx(data, slot, exId, hoje, s.inicio ? s.id : undefined);
          const p = suggestNext(exId, ex.unilateral ? 'D' : undefined, ctx);
          const u = unitOf(ctx.eq);
          const off = !slotActive(s, slot.id);
          const exp = exposures(data.sets, exId).filter((e) => e.trabalho.length).slice(0, 4);
          const meta = p.cargas[0] != null ? `${fmtW(p.cargas[0]!)} ${u} · ${p.metas.map((m) => m ?? '?').join('/')}` : 'primeira vez';
          return (
            <div key={slot.id} className={`ex-row ${off ? 'off' : ''}`}>
              <button className="ex-row-head" onClick={() => setAberto(aberto === slot.id ? null : slot.id)}>
                <div className="grow">
                  <div className="ex-name">{ex.nome}</div>
                  <div className="muted small">
                    {slot.series}× {slot.repMin}–{slot.repMax}
                    {ex.unilateral ? ' por lado' : ''}
                    {!resolved ? ' · variação a confirmar' : ''}
                    {p.ultima ? ` · última ${p.ultima.cargas[0] != null ? fmtW(p.ultima.cargas[0]!) + ' ' + u + ' × ' : ''}${p.ultima.reps.join('/')}` : ''}
                  </div>
                </div>
                <div className="ex-meta-right">
                  <span className={`tag ${p.acao === 'subir' ? 'solid' : ''}`}>{meta}</span>
                  {p.revisarFaixa && <span className="tag">revisar faixa</span>}
                  {p.acao === 'dor' && <span className="tag">dor</span>}
                </div>
                <IconDown className={`chev ${aberto === slot.id ? 'up' : ''}`} />
              </button>
              {aberto === slot.id && (
                <div className="ex-row-body">
                  <p className="small">{p.motivo}</p>
                  {slot.dica && <p className="muted small">Execução: {slot.dica}</p>}
                  {exp.length > 0 && (
                    <div className="hist">
                      {exp.map((e) => (
                        <div key={e.sessionId} className="hist-row">
                          <span>{formatShort(e.data)}</span>
                          <span>{e.trabalho.map((x) => `${x.carga != null ? fmtW(x.carga) : '-'}×${x.reps}`).join('  ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function WeekStrip({ data, hoje, onPick }: { data: AppData; hoje: string; onPick: (s: Session) => void }) {
  const cells = weekView(data, hoje);
  return (
    <div className="week">
      {cells.map((c) => {
        const s = c.sessoes.find((x) => x.status !== 'falta');
        const st = s?.status;
        const podeVer = s && (inQueue(s) || s.virtual);
        return (
          <button
            key={c.date}
            className={`week-day ${c.date === hoje ? 'today' : ''} ${st === 'concluida' ? 'done' : ''} ${c.faltas.length && !s ? 'miss' : ''}`}
            disabled={!podeVer}
            onClick={() => s && onPick(s)}
          >
            <span className="wd">{WEEKDAY_SHORT[dow(c.date)]}</span>
            <span className="wk">{s ? s.key : c.faltas.length ? '×' : '·'}</span>
          </button>
        );
      })}
    </div>
  );
}
