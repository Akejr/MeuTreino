import type { Limits, Macros } from '../types';
import { r0 } from '../lib/utils';

const MACROS = [
  { k: 'proteina', label: 'Proteína', meta: true, cls: 'm-prot' },
  { k: 'carboidratos', label: 'Carboidratos', meta: false, cls: 'm-carb' },
  { k: 'gordura', label: 'Gordura', meta: false, cls: 'm-fat' },
] as const;

const fmt = (n: number) => r0(n).toLocaleString('pt-BR');

function Ring({ pct, over, size = 92 }: { pct: number; over: boolean; size?: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 92 92" width={size} height={size} aria-hidden>
      <circle cx="46" cy="46" r={r} className="ring-track" />
      <circle
        cx="46"
        cy="46"
        r={r}
        className={`ring-fill ${over ? 'over' : ''}`}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))}
      />
    </svg>
  );
}

/** Card de calorias (gradiente, usado como destaque). */
export function KcalCard({ totals, limits, extra }: { totals: Macros; limits: Limits; extra?: Macros }) {
  const kcal = totals.calorias + (extra?.calorias ?? 0);
  const lim = limits.calorias || 1;
  const restante = lim - kcal;
  const over = kcal > lim * 1.03;
  return (
    <section className={`card hero kcal ${over ? 'over' : ''}`}>
      <div className="kcal-text">
        <span className="hero-label">Calorias do dia</span>
        <div className="kcal-num">{fmt(kcal)}</div>
        <span className="kcal-sub">de {fmt(limits.calorias)} kcal</span>
        <span className="pill-light">
          {restante >= 0 ? `${fmt(restante)} kcal restantes` : `${fmt(-restante)} kcal acima`}
        </span>
        {extra && extra.calorias > 0 && <span className="kcal-sub">inclui {fmt(extra.calorias)} kcal do rascunho</span>}
      </div>
      <div className="ring-wrap">
        <Ring pct={kcal / lim} over={over} />
        <span className="ring-pct">{Math.round((kcal / lim) * 100)}%</span>
      </div>
    </section>
  );
}

/** Três cards coloridos de macronutrientes. */
export function MacroGrid({ totals, limits, extra }: { totals: Macros; limits: Limits; extra?: Macros }) {
  return (
    <div className="macro-grid">
      {MACROS.map(({ k, label, meta, cls }) => {
        const v = totals[k] + (extra?.[k] ?? 0);
        const lim = limits[k] || 1;
        const over = !meta && v > lim * 1.03;
        return (
          <div key={k} className={`macro ${cls} ${over ? 'over' : ''}`}>
            <span className="macro-label">{label}</span>
            <div className="macro-num">
              {r0(v)}
              <small>g</small>
            </div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${Math.min(100, (v / lim) * 100)}%` }} />
            </div>
            <span className="macro-lim">
              {meta ? 'meta' : 'máx'} {limits[k]} g
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Versão compacta (calorias + macros) para dentro de outro card. */
export default function MacroBars({ totals, limits }: { totals: Macros; limits: Limits }) {
  const lim = limits.calorias || 1;
  const over = totals.calorias > lim * 1.03;
  return (
    <div className="macros-compact">
      <div className="kcal-compact">
        <div>
          <span className="label">Calorias</span>
          <div className={`kcal-num-sm ${over ? 'text-bad' : ''}`}>
            {fmt(totals.calorias)} <small>/ {fmt(limits.calorias)} kcal</small>
          </div>
        </div>
        <div className="ring-wrap sm">
          <Ring pct={totals.calorias / lim} over={over} size={64} />
        </div>
      </div>
      <MacroGrid totals={totals} limits={limits} />
    </div>
  );
}
