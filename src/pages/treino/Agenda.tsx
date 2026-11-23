import { useState } from 'react';
import { IconBack, IconNext } from '../../components/Icons';
import Sheet from '../../components/Sheet';
import { addDays, dow, formatShort, weekStart, weekdayName, WEEKDAY_SHORT } from '../../lib/utils';
import type { AppData, Session, SetLog } from '../../types';
import { moveTo } from '../../training/actions';
import { fmtW } from '../../training/engine';
import { inQueue, weekView } from '../../training/schedule';
import { MovePicker } from './MovePicker';
import SessionPreview from './SessionPreview';
import { EditSetSheet } from './Cards';
import { exName, setLine, tipoCurto } from './shared';

const STATUS: Record<Session['status'], string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  parcial: 'Parcial',
  concluida: 'Concluído',
  falta: 'Falta',
};

export default function Agenda({ data, hoje }: { data: AppData; hoje: string }) {
  const [week, setWeek] = useState(weekStart(hoje));
  const [mover, setMover] = useState<Session | null>(null);
  const [hist, setHist] = useState<Session | null>(null);
  const [preview, setPreview] = useState<Session | null>(null);
  const cells = weekView(data, week);
  const historico = Object.values(data.sessions)
    .filter((s) => s.status === 'concluida' || s.status === 'parcial' || s.status === 'falta')
    .sort((a, b) => (b.dataReal ?? b.dataAtual).localeCompare(a.dataReal ?? a.dataAtual))
    .slice(0, 30);

  return (
    <>
      <section className="card">
        <div className="row between">
          <button className="icon-btn soft" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}>
            <IconBack />
          </button>
          <h2 className="m0">
            {week.slice(8)}/{week.slice(5, 7)} – {addDays(week, 6).slice(8)}/{addDays(week, 6).slice(5, 7)}
          </h2>
          <button className="icon-btn soft" aria-label="Próxima semana" onClick={() => setWeek(addDays(week, 7))}>
            <IconNext />
          </button>
        </div>
        <div className="agenda">
          {cells.map((c) => {
            const tipo = data.settings.training.dias[dow(c.date)];
            return (
              <div key={c.date} className={`agenda-day ${c.date === hoje ? 'today' : ''}`}>
                <div className="agenda-date">
                  <span className="wd">{WEEKDAY_SHORT[dow(c.date)]}</span>
                  <span className="dn">{c.date.slice(8)}</span>
                </div>
                <div className="grow">
                  {c.sessoes.map((s) => {
                    const feito = (s.status === 'concluida' || s.status === 'parcial') && c.date === (s.dataReal ?? s.dataAtual);
                    const previsto = (inQueue(s) && c.date === s.dataAtual) || s.virtual;
                    return (
                      <button
                        key={s.id}
                        className={`agenda-item ${s.virtual ? 'virtual' : ''}`}
                        disabled={!feito && !previsto}
                        onClick={() => (feito ? setHist(s) : setPreview(s))}
                      >
                        <div className="grow">
                          <div className="strong">
                            {s.key} · {s.titulo}
                          </div>
                          <div className="muted small">
                            {s.virtual ? 'Previsto' : s.retomar && c.date === s.dataAtual && c.date !== (s.dataReal ?? '') ? 'Restante a fazer' : STATUS[s.status]}
                            {c.date !== s.dataOriginal && c.date !== s.dataReal ? ` · era ${weekdayName(s.dataOriginal)}` : ''}
                            {s.duracaoSeg ? ` · ${Math.round(s.duracaoSeg / 60)} min` : ''}
                          </div>
                        </div>
                        {(feito || previsto) && <IconNext className="chev" />}
                      </button>
                    );
                  })}
                  {c.faltas.map((s) => (
                    <div key={`f-${s.id}`} className="agenda-item miss">
                      <span className="muted small">
                        Falta registrada · {s.key} {s.titulo}
                      </span>
                    </div>
                  ))}
                  {!c.sessoes.length && !c.faltas.length && <span className="muted small">{tipo === 'indisponivel' ? 'Indisponível' : tipo === 'disponivel' ? 'Livre (reposição)' : 'Livre'}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="section-title">Histórico</div>
      {historico.length === 0 && <p className="muted small pad">Nenhum treino registrado ainda.</p>}
      <div className="list-card">
        {historico.map((s) => {
          const n = Object.values(data.sets).filter((x) => x.sessionId === s.id && x.tipo === 'trabalho' && x.status === 'feita').length;
          return (
            <button key={s.id} className="hist-item" onClick={() => s.status !== 'falta' && setHist(s)}>
              <div className="grow">
                <div className="strong">
                  {s.key} · {s.titulo}
                </div>
                <div className="muted small">
                  {formatShort(s.dataReal ?? s.dataAtual)} · {STATUS[s.status]}
                  {s.duracaoSeg ? ` · ${Math.round(s.duracaoSeg / 60)} min` : ''}
                  {n ? ` · ${n} séries` : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Sheet open={!!mover} onClose={() => setMover(null)} title={mover ? `Mover ${mover.key} · ${mover.titulo}` : ''}>
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
      <HistorySheet data={data} s={hist} onClose={() => setHist(null)} />
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
    </>
  );
}

function HistorySheet({ data, s, onClose }: { data: AppData; s: Session | null; onClose: () => void }) {
  const [edit, setEdit] = useState<SetLog | null>(null);
  if (!s) return null;
  const sets = Object.values(data.sets)
    .filter((x) => x.sessionId === s.id)
    .sort((a, b) => a.confirmadoEm - b.confirmadoEm);
  const porEx = new Map<string, SetLog[]>();
  for (const x of sets) porEx.set(x.exerciseId, [...(porEx.get(x.exerciseId) ?? []), x]);
  return (
    <>
      <Sheet open={!edit} onClose={onClose} title={`${s.key} · ${s.titulo}`}>
        <p className="muted small">
          {formatShort(s.dataReal ?? s.dataAtual)} · {STATUS[s.status]}
          {s.duracaoSeg ? ` · ${Math.round(s.duracaoSeg / 60)} min` : ''}. Toque numa série para corrigir.
        </p>
        {[...porEx].map(([exId, list]) => (
          <div key={exId} className="hist-block">
            <div className="strong">{exName(exId)}</div>
            {list.map((x) => (
              <button key={x.id} className="set-row" onClick={() => x.status === 'feita' && setEdit(x)}>
                <span>{tipoCurto(x)}</span>
                <span>{setLine(x)}</span>
              </button>
            ))}
          </div>
        ))}
        {!sets.length && <p className="muted small">Nenhuma série registrada.</p>}
        <p className="muted small">Pesos em {sets[0] ? `${sets[0].unidade}` : 'kg'}. {sets.some((x) => x.carga != null) ? `Maior carga: ${fmtW(Math.max(...sets.map((x) => x.carga ?? 0)))}.` : ''}</p>
      </Sheet>
      <EditSetSheet set={edit} onClose={() => setEdit(null)} />
    </>
  );
}
