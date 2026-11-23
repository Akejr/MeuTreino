import { addDays, dayLabel, formatLong, todayISO } from '../lib/utils';
import { IconBack, IconNext } from './Icons';

export default function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  return (
    <div className="datenav">
      <button className="icon-btn" aria-label="Dia anterior" onClick={() => onChange(addDays(date, -1))}>
        <IconBack />
      </button>
      <label className="datenav-label">
        <strong>{dayLabel(date)}</strong>
        <span className="muted small">{formatLong(date)}</span>
        <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </label>
      <button className="icon-btn" aria-label="Próximo dia" onClick={() => onChange(addDays(date, 1))}>
        <IconNext />
      </button>
      {date !== todayISO() && (
        <button className="chip" onClick={() => onChange(todayISO())}>
          Hoje
        </button>
      )}
    </div>
  );
}
