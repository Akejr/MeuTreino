/** Peças da análise: lista de falhas com nível, qualidade da dieta e listas de pendências/acertos. */
import { NIVEL_LABEL, type FullTotals, type Issue, type Targets } from '../lib/nutrition';
import { useLocalFlag } from '../lib/hooks';
import { fmtNum, r0 } from '../lib/utils';
import { IconDown } from './Icons';
import { RichInline } from './RichText';

const AREA: Record<Issue['area'], string> = { dieta: 'Dieta', treino: 'Treino', habitos: 'Hábitos' };

export function IssueList({ issues, grouped }: { issues: Issue[]; grouped?: boolean }) {
  if (!issues.length) return null;
  if (!grouped) {
    return (
      <ul className="issues">
        {issues.map((i, k) => (
          <IssueRow key={k} i={i} />
        ))}
      </ul>
    );
  }
  const areas = (['dieta', 'treino', 'habitos'] as const).filter((a) => issues.some((i) => i.area === a));
  return (
    <>
      {areas.map((a) => (
        <div key={a} className="issue-group">
          <div className="issue-area">{AREA[a]}</div>
          <ul className="issues">
            {issues
              .filter((i) => i.area === a)
              .map((i, k) => (
                <IssueRow key={k} i={i} />
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function IssueRow({ i }: { i: Issue }) {
  return (
    <li className={`issue n${i.nivel}`}>
      <span className="issue-dot" aria-label={NIVEL_LABEL[i.nivel]} />
      <span className="grow">
        <RichInline text={i.texto} />
      </span>
      <span className="issue-tag">{NIVEL_LABEL[i.nivel]}</span>
    </li>
  );
}

export function TextList({ items, kind }: { items: string[]; kind: 'pendente' | 'acerto' | 'nota' }) {
  if (!items.length) return null;
  return (
    <ul className={`tlist ${kind}`}>
      {items.map((t, k) => (
        <li key={k}>
          <RichInline text={t} />
        </li>
      ))}
    </ul>
  );
}

const fmt1 = (n: number) => fmtNum(Math.round(n * 10) / 10, 1);

/**
 * Fibras (mínimo), açúcar adicionado, saturada e sódio (máximos) e % de ultraprocessados.
 * A seta minimiza e maximiza; o estado fica guardado (`memo`) até ele abrir de novo.
 */
export function QualityCard({ t, T, title = 'Qualidade do dia', memo = 'qualidade-dia' }: { t: FullTotals; T: Targets; title?: string; memo?: string }) {
  const [fechado, setFechado] = useLocalFlag(memo);
  const rows = [
    { label: 'Fibras', v: t.fibras, lim: T.fibra, unit: 'g', min: true, cob: t.cobertura.fibras, f: fmt1 },
    { label: 'Açúcar adicionado', v: t.acucar, lim: T.acucar, unit: 'g', min: false, cob: t.cobertura.acucar, f: fmt1 },
    { label: 'Gordura saturada', v: t.saturada, lim: T.saturada, unit: 'g', min: false, cob: t.cobertura.saturada, f: fmt1 },
    { label: 'Sódio', v: t.sodio, lim: T.sodio, unit: 'mg', min: false, cob: t.cobertura.sodio, f: (n: number) => r0(n).toLocaleString('pt-BR') },
  ];
  const ultra = t.novaKcal > 0 ? Math.round((t.ultraKcal / t.novaKcal) * 100) : null;
  const semDado = rows.some((r) => t.itens > 0 && r.cob < 1);
  const alertas = rows.filter((r) => (r.min ? t.itens > 0 && r.v < r.lim : r.v > r.lim * 1.01)).length;
  return (
    <section className={`card quality ${fechado ? 'closed' : ''}`}>
      <button className="q-toggle" aria-expanded={!fechado} onClick={() => setFechado(!fechado)}>
        <span className="label grow">{title}</span>
        {fechado && alertas > 0 && <span className="q-count">{alertas === 1 ? '1 fora da meta' : `${alertas} fora da meta`}</span>}
        <IconDown className={`chev ${fechado ? '' : 'up'}`} />
      </button>
      {!fechado && (
        <>
      <div className="q-rows">
        {rows.map((r) => {
          const pct = r.lim ? Math.min(100, (r.v / r.lim) * 100) : 0;
          const ruim = r.min ? t.itens > 0 && r.v < r.lim : r.v > r.lim * 1.01;
          return (
            <div key={r.label} className={`q-row ${ruim ? 'warn' : ''}`}>
              <div className="q-head">
                <span>{r.label}</span>
                <span className="q-val">
                  {t.itens && r.cob === 0 ? '—' : r.f(r.v)} <small>{r.min ? `meta ${r.lim}` : `máx ${r.f(r.lim)}`} {r.unit}</small>
                </span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="q-foot">
        <span>Ultraprocessados</span>
        <strong>{ultra == null ? '—' : `${ultra}% das kcal`}</strong>
      </div>
      {semDado && <p className="muted small">Alguns itens ainda não têm todos os dados. Com internet, o app estima os que faltam.</p>}
        </>
      )}
    </section>
  );
}
