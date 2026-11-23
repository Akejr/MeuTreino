/** Prévia de um treino de outro dia: exercícios, metas atuais e tempo. */
import Sheet from '../../components/Sheet';
import { dayLabel, formatShort, weekdayName } from '../../lib/utils';
import type { AppData, Session } from '../../types';
import { getEx, resolveExercise } from '../../training/catalog';
import { estimateSession, fmtW, medianDuration, slotActive, stepCtx, suggestNext, unitOf } from '../../training/engine';
import { inQueue, planSessionOf } from '../../training/schedule';
import { minutes } from './shared';

export default function SessionPreview({ data, s, hoje, onClose, onMove }: { data: AppData; s: Session | null; hoje: string; onClose: () => void; onMove: (s: Session) => void }) {
  if (!s) return null;
  const ps = planSessionOf(data, s);
  if (!ps) return null;
  const t = data.settings.training;
  const est = medianDuration(data, s.key) ?? estimateSession(ps, t, s);
  const ativos = ps.slots.filter((x) => slotActive(s, x.id));
  const series = ativos.reduce((n, x) => n + x.series, 0);
  return (
    <Sheet open onClose={onClose} title={`${s.key} · ${s.titulo}`}>
      <div className="eyebrow">
        {dayLabel(s.dataAtual)} · {formatShort(s.dataAtual)}
        {s.dataAtual !== s.dataOriginal ? ` · era ${weekdayName(s.dataOriginal)}` : ''}
      </div>
      <div className="preview-stats">
        <div>
          <strong>{minutes(est)}</strong>
          <span>estimativa</span>
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
      <div className="preview-list">
        {ativos.map((slot, i) => {
          const exId = resolveExercise(slot.exerciseId, t) ?? slot.exerciseId;
          const ex = getEx(exId);
          const ctx = stepCtx(data, slot, exId, hoje);
          const p = suggestNext(exId, ex.unilateral ? 'D' : undefined, ctx);
          const u = unitOf(ctx.eq);
          const meta = p.cargas[0] != null ? `${fmtW(p.cargas[0]!)} ${u} · ${p.metas.map((m) => m ?? '?').join('/')}` : 'primeira vez';
          return (
            <div key={slot.id} className="preview-row">
              <span className="num">{i + 1}</span>
              <div className="grow">
                <div className="strong">{ex.nome}</div>
                <div className="muted small">
                  {slot.series}× {slot.repMin}–{slot.repMax}
                  {ex.unilateral ? ' por lado' : ''}
                  {p.ultima ? ` · última ${p.ultima.cargas[0] != null ? `${fmtW(p.ultima.cargas[0]!)} ${u} × ` : ''}${p.ultima.reps.join('/')}` : ''}
                </div>
              </div>
              <span className={`tag ${p.acao === 'subir' ? 'solid' : ''}`}>{meta}</span>
            </div>
          );
        })}
      </div>
      <p className="muted small">Metas calculadas com o histórico de hoje. Elas mudam conforme você treina até lá.</p>
      {s.virtual ? (
        <p className="notice">Esta semana ainda não foi criada na agenda. Dá para mover este treino quando ela começar.</p>
      ) : (
        inQueue(s) && (
          <button className="btn block" onClick={() => onMove(s)}>
            Mover para outro dia
          </button>
        )
      )}
    </Sheet>
  );
}
