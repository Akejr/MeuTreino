import { addDays, dayLabel, dow, formatShort } from '../../lib/utils';
import type { AppData, Session } from '../../types';
export function MovePicker({ data, s, hoje, onPick }: { data: AppData; s: Session; hoje: string; onPick: (d: string) => void }) {
  const t = data.settings.training;
  const dias = Array.from({ length: 14 }, (_, i) => addDays(hoje, i));
  return (
    <div className="stack">
      {dias.map((d) => {
        const tipo = t.dias[dow(d)];
        const outra = Object.values(data.sessions).find((x) => x.id !== s.id && x.status !== 'falta' && (x.dataReal ?? x.dataAtual) === d);
        const fixa = outra && !(outra.status === 'pendente' || (outra.status === 'parcial' && outra.retomar));
        return (
          <button key={d} className={`option ${d === s.dataAtual ? 'on' : ''}`} disabled={!!fixa || tipo === 'indisponivel'} onClick={() => onPick(d)}>
            <span className="option-title">
              {dayLabel(d)} · {formatShort(d)}
            </span>
            <span className="option-desc">
              {tipo === 'indisponivel' ? 'Indisponível' : outra ? `${outra.key} · ${outra.titulo}${fixa ? ' (feito)' : ' · as duas trocam de data'}` : tipo === 'disponivel' ? 'Disponível para reposição' : 'Livre'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
