import { useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconSwap, IconTimer } from '../../components/Icons';
import Sheet from '../../components/Sheet';
import { useNow } from '../../lib/hooks';
import { fmtDur } from '../../lib/utils';
import type { Base, MotivoTroca, SetLog, Unidade } from '../../types';
import { answerQuestion, editSet, saveEquipment, setNextWeight } from '../../training/actions';
import { BASE_OPCOES, getEx, GRUPO_LABEL, QUESTION_BY_ID, type ExerciseDef } from '../../training/catalog';
import { fmtW } from '../../training/engine';
import { exName, setLine, tipoCurto } from './shared';

export function QuestionCard({ qid, exNome }: { qid: string; exNome: string }) {
  const q = QUESTION_BY_ID[qid];
  if (!q) return null;
  return (
    <section className="card">
      <span className="eyebrow">Primeira vez · {exNome}</span>
      <h2 className="mt8">{q.pergunta}</h2>
      <p className="muted small">Cada variação guarda o próprio histórico. Dá para mudar depois em Ajustes.</p>
      <div className="stack">
        {q.opcoes
          .filter((o) => o.ativa.length)
          .map((o) => (
            <button key={o.label} className="btn block outline" onClick={() => answerQuestion(qid, o.ativa)}>
              {o.label}
            </button>
          ))}
      </div>
    </section>
  );
}

export function EquipmentCard({ ex }: { ex: ExerciseDef }) {
  const [base, setBase] = useState<Base>(ex.baseSugerida);
  const [unidade, setUnidade] = useState<Unidade>('kg');
  return (
    <section className="card">
      <span className="eyebrow">Primeira vez neste aparelho</span>
      <h2 className="mt8">Como você conta o peso em {ex.nome.toLowerCase()}?</h2>
      <div className="options">
        {BASE_OPCOES.map((o) => (
          <button key={o.base} className={`option ${base === o.base ? 'on' : ''}`} onClick={() => setBase(o.base)}>
            <span className="option-title">{o.label}</span>
            <span className="option-desc">{o.desc}</span>
          </button>
        ))}
      </div>
      {base !== 'corporal' && (
        <div className="row gap">
          <span className="label">Unidade</span>
          <div className="segmented small">
            {(['kg', 'lb'] as const).map((u) => (
              <button key={u} className={unidade === u ? 'on' : ''} onClick={() => setUnidade(u)}>
                {u}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="btn primary block" onClick={() => saveEquipment(ex.equip, unidade, base)}>
        Salvar e continuar
      </button>
    </section>
  );
}

export function PainCheckCard({ onAnswer, exNome }: { onAnswer: (r: 'ok' | 'dor') => void; exNome: string }) {
  return (
    <section className="card">
      <span className="eyebrow">
        <IconAlert className="i14" /> Checagem
      </span>
      <h2 className="mt8">Na última vez você marcou dor em {exNome.toLowerCase()}. Como está hoje?</h2>
      <p className="muted small">A progressão de carga continua suspensa neste exercício.</p>
      <div className="stack">
        <button className="btn block outline" onClick={() => onAnswer('ok')}>
          Sem dor, posso fazer
        </button>
        <button className="btn block outline" onClick={() => onAnswer('dor')}>
          Ainda dói: pular hoje
        </button>
      </div>
    </section>
  );
}

export function NextWeightAsk({ equipId, de, assist, unidade, motivo }: { equipId: string; de: number; assist: boolean; unidade: string; motivo: string }) {
  const [v, setV] = useState('');
  const n = Number(v.replace(',', '.'));
  const valido = n > 0 && (assist ? n < de : n > de);
  return (
    <div className="ask">
      <p className="small">{motivo}</p>
      <label className="field">
        <span>{assist ? `Próximo nível com menos assistência (abaixo de ${fmtW(de)} ${unidade})` : `Próximo peso disponível acima de ${fmtW(de)} ${unidade} (inclua anilhas extras)`}</span>
        <input inputMode="decimal" value={v} placeholder={unidade} onChange={(e) => setV(e.target.value)} />
      </label>
      <div className="row gap">
        <button className="btn primary grow" disabled={!valido} onClick={() => setNextWeight(equipId, de, n)}>
          Salvar
        </button>
        <button className="btn grow" onClick={() => setNextWeight(equipId, de, -1)}>
          Não existe
        </button>
      </div>
    </div>
  );
}

const MOTIVOS: { v: MotivoTroca; label: string }[] = [
  { v: 'hoje_nao', label: 'Hoje não quero' },
  { v: 'ocupado', label: 'Ocupado' },
  { v: 'nao_gosto', label: 'Não gosto' },
];

export function OfferCard({
  atual,
  oferta,
  temMais,
  onUse,
  onNext,
  onBack,
  onSkip,
}: {
  atual: string;
  oferta: string;
  temMais: boolean;
  onUse: (m: MotivoTroca, evitar: boolean) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const alt = getEx(oferta);
  const [motivo, setMotivo] = useState<MotivoTroca | null>(null);
  const [evitar, setEvitar] = useState(false);
  useEffect(() => {
    setMotivo(null);
    setEvitar(false);
  }, [oferta]);
  return (
    <section className="card">
      <span className="eyebrow">
        <IconSwap className="i14" /> Trocar {exName(atual).toLowerCase()}
      </span>
      <h2 className="mt8">{alt.nome}</h2>
      <p className="muted small">
        Mesmo grupo ({GRUPO_LABEL[alt.grupo].toLowerCase()}) e mesmo tipo de movimento.{alt.unilateral ? ' Unilateral: o tempo conta os dois lados.' : ''}
        {alt.obs ? ` ${alt.obs}` : ''} As séries já feitas ficam no exercício original.
      </p>
      {motivo === null ? (
        <div className="stack">
          <button className="btn primary block" onClick={() => setMotivo('hoje_nao')}>
            Usar esta
          </button>
          <div className="row gap">
            {temMais && (
              <button className="btn grow" onClick={onNext}>
                Trocar
              </button>
            )}
            <button className="btn grow" onClick={onBack}>
              Voltar
            </button>
            <button className="btn grow" onClick={onSkip}>
              Pular
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="label mt8">Motivo da troca</div>
          <div className="chips">
            {MOTIVOS.map((m) => (
              <button key={m.v} className={`chip ${motivo === m.v ? 'on' : ''}`} onClick={() => setMotivo(m.v)}>
                {m.label}
              </button>
            ))}
          </div>
          {motivo === 'nao_gosto' && (
            <label className="check-row">
              <input type="checkbox" checked={evitar} onChange={(e) => setEvitar(e.target.checked)} />
              <span>Não sugerir {exName(atual).toLowerCase()} nas próximas fichas e trocas</span>
            </label>
          )}
          <div className="row gap">
            <button className="btn grow" onClick={() => setMotivo(null)}>
              Cancelar
            </button>
            <button className="btn primary grow" onClick={() => onUse(motivo, evitar)}>
              Confirmar troca
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Barra fina de descanso: fica presa no topo e deixa o cartão da série visível sem rolar. */
export function RestCard({ ate, total, onAdd, onSkip }: { ate: number; total: number; onAdd: () => void; onSkip: () => void }) {
  const now = useNow(250);
  const rest = Math.max(0, (ate - now) / 1000);
  const pct = total > 0 ? Math.min(1, 1 - rest / total) : 1;
  const fired = useRef(false);
  useEffect(() => {
    if (rest <= 0 && !fired.current) {
      fired.current = true;
      navigator.vibrate?.([200, 100, 200]);
    }
  }, [rest]);
  return (
    <section className="rest-bar" aria-label="Descanso">
      <div className="rest-bar-row">
        <IconTimer className="i18" />
        <span className="rest-bar-label">Descanso</span>
        <span className="rest-bar-time">{fmtDur(rest)}</span>
        <button className="rest-bar-btn" onClick={onAdd}>
          +30 s
        </button>
        <button className="rest-bar-btn light" onClick={onSkip}>
          Pular
        </button>
      </div>
      <div className="rest-bar-progress">
        <div style={{ width: `${pct * 100}%` }} />
      </div>
    </section>
  );
}

export function PainSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: NonNullable<SetLog['dorTipo']>) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Como é a dor?">
      <div className="stack">
        <button className="option" onClick={() => onPick('leve')}>
          <span className="option-title">Leve, não muda o movimento</span>
          <span className="option-desc">Registra a série e suspende a progressão deste exercício.</span>
        </button>
        <button className="option" onClick={() => onPick('aguda')}>
          <span className="option-title">Aguda, crescente ou muda o movimento</span>
          <span className="option-desc">Interrompe este exercício hoje, sem troca automática pelo mesmo gesto.</span>
        </button>
        <button className="option strong" onClick={() => onPick('alerta')}>
          <span className="option-title">Dor no peito, desmaio ou falta de ar</span>
          <span className="option-desc">Interrompe a sessão.</span>
        </button>
      </div>
    </Sheet>
  );
}

/** Reserva escolhida. aprox = número aproximado (depois de 4+); mais = só se sabe o mínimo. */
export interface RirPick {
  rir: number | null;
  aprox?: boolean;
  mais?: boolean;
}

/** Primeira linha: tocar registra a série. "4+" abre RIR_MAIS (nunca vira exatamente 4). */
const RIR_OPTS: { v: number | null; label: string; abre?: boolean }[] = [
  { v: 0, label: '0' },
  { v: 1, label: '1' },
  { v: 2, label: '2' },
  { v: 3, label: '3' },
  { v: 4, label: '4+', abre: true },
  { v: null, label: 'Não sei' },
];

export const RIR_MAIS: (RirPick & { label: string })[] = [
  { rir: 4, aprox: true, label: '4' },
  { rir: 5, aprox: true, label: '5' },
  { rir: 6, aprox: true, label: '6' },
  { rir: 8, aprox: true, label: '8' },
  { rir: 10, mais: true, label: '10+' },
  { rir: 4, mais: true, label: 'Não sei quantas' },
];

const EDIT_RIR: (RirPick & { label: string })[] = [
  { rir: 0, label: '0' },
  { rir: 1, label: '1' },
  { rir: 2, label: '2' },
  { rir: 3, label: '3' },
  { rir: 4, aprox: true, label: '≈4' },
  { rir: 5, aprox: true, label: '≈5' },
  { rir: 6, aprox: true, label: '≈6' },
  { rir: 8, aprox: true, label: '≈8' },
  { rir: 10, mais: true, label: '10+' },
  { rir: 4, mais: true, label: '4+ sem saber quanto' },
  { rir: null, label: 'Não sei' },
];

const samePick = (a: RirPick, b: RirPick) => a.rir === b.rir && !!a.aprox === !!b.aprox && !!a.mais === !!b.mais;

export function EditSetSheet({ set, onClose }: { set: SetLog | null; onClose: () => void }) {
  const [carga, setCarga] = useState('');
  const [reps, setReps] = useState(0);
  const [pick, setPick] = useState<RirPick>({ rir: null });
  const [ajuda, setAjuda] = useState(false);
  const [dor, setDor] = useState(false);
  useEffect(() => {
    if (!set) return;
    setCarga(set.carga == null ? '' : String(set.carga));
    setReps(set.reps ?? 0);
    // Registros antigos com 4 vinham do botão 4+: contam como "4 ou mais".
    setPick({ rir: set.rir, aprox: set.rirAprox, mais: set.rirMais || (set.rir === 4 && !set.rirAprox) });
    setAjuda(set.ajuda);
    setDor(set.dor);
  }, [set]);
  if (!set) return null;
  const save = () => {
    const c = carga.trim() === '' ? null : Number(carga.replace(',', '.'));
    const work = set.tipo === 'trabalho';
    editSet(set.id, {
      carga: c != null && !Number.isNaN(c) ? c : null,
      reps,
      rir: work ? pick.rir : null,
      rirAprox: work && pick.aprox,
      rirMais: work && pick.mais,
      ajuda,
      dor,
    });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Corrigir · ${exName(set.exerciseId)} · ${tipoCurto(set)}`}>
      <p className="muted small">Registro atual: {setLine(set)}. As próximas sugestões são recalculadas com a correção.</p>
      <label className="field">
        <span>Peso ({set.unidade})</span>
        <input inputMode="decimal" value={carga} onChange={(e) => setCarga(e.target.value)} />
      </label>
      <div className="field">
        <span>Repetições</span>
        <Stepper value={reps} onChange={setReps} min={0} />
      </div>
      {set.tipo === 'trabalho' && (
        <>
          <div className="label">Repetições em reserva</div>
          <div className="chips">
            {EDIT_RIR.map((o) => (
              <button key={o.label} className={`chip ${samePick(pick, o) ? 'on' : ''}`} onClick={() => setPick({ rir: o.rir, aprox: o.aprox, mais: o.mais })}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="chips mt8">
        <button className={`chip ${ajuda ? 'on' : ''}`} onClick={() => setAjuda(!ajuda)}>
          Com ajuda
        </button>
        <button className={`chip ${dor ? 'on' : ''}`} onClick={() => setDor(!dor)}>
          Senti dor
        </button>
      </div>
      <button className="btn primary block" onClick={save}>
        <IconCheck /> Salvar correção
      </button>
    </Sheet>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="stepper">
      <button aria-label="Menos" onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="stepper-val">{value}</span>
      <button aria-label="Mais" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  );
}

export { RIR_OPTS };
