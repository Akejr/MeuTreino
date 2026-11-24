/** Área de cardio do treino: registro rápido do dia e resumo dos últimos 7 dias. */
import { useEffect, useState } from 'react';
import { ask } from '../../components/Dialog';
import { IconDown, IconPlus, IconTrash } from '../../components/Icons';
import { OptNumberField } from '../../components/NumberField';
import Sheet from '../../components/Sheet';
import { cardioBetween, cardioOn, deleteCardio, novoCardio, saveCardio } from '../../cardio/cardio';
import { coachWeek } from '../../coach/coach';
import { bodyOf, CARDIO, cardioDef, estimateCardio, INTENSIDADE, METODO_LABEL } from '../../coach/energy';
import { getData } from '../../lib/storage';
import { addDays, dayLabel, fmtNum, todayISO } from '../../lib/utils';
import type { AppData, Cardio } from '../../types';

const kcalTxt = (n: number) => `~${Math.round(n).toLocaleString('pt-BR')} kcal`;

export function CardioSheet({ open, initial, onClose }: { open: boolean; initial: Cardio | null; onClose: () => void }) {
  const [c, setC] = useState<Cardio | null>(initial);
  const [minTxt, setMinTxt] = useState('');
  useEffect(() => {
    if (open && initial) {
      setC(initial);
      setMinTxt(String(initial.minutos));
    }
  }, [open, initial]);
  if (!open || !c) return null;
  const data = getData();
  const editando = !!data.cardio[c.id];
  const def = cardioDef(c.tipo);
  const est = estimateCardio(c, bodyOf(data.settings.profile));
  const set = (patch: Partial<Cardio>) => setC((x) => (x ? { ...x, ...patch } : x));
  const setMin = (n: number) => {
    const v = Math.max(1, Math.min(600, Math.round(n)));
    set({ minutos: v });
    setMinTxt(String(v));
  };
  const valido = c.minutos > 0 && !!c.date && /^\d{2}:\d{2}$/.test(c.hora);

  return (
    <Sheet open onClose={onClose} title={editando ? 'Editar cardio' : 'Registrar cardio'}>
      <div className="label">Tipo</div>
      <div className="chips">
        {CARDIO.map((t) => (
          <button key={t.id} className={`chip ${c.tipo === t.id ? 'on' : ''}`} onClick={() => set({ tipo: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="inputs mt8">
        <div className="field">
          <span>Duração (min)</span>
          <div className="weight">
            <button aria-label="Menos 5 minutos" onClick={() => setMin(c.minutos - 5)}>
              −
            </button>
            <input
              inputMode="numeric"
              value={minTxt}
              onChange={(e) => {
                setMinTxt(e.target.value);
                const n = Number(e.target.value);
                if (n > 0) set({ minutos: Math.round(n) });
              }}
              onFocus={(e) => e.target.select()}
            />
            <button aria-label="Mais 5 minutos" onClick={() => setMin(c.minutos + 5)}>
              +
            </button>
          </div>
        </div>
        <label className="field">
          <span>Começou às</span>
          <input type="time" value={c.hora} onChange={(e) => set({ hora: e.target.value })} />
        </label>
      </div>

      <div className="label mt8">Intensidade (teste da fala)</div>
      <div className="options three">
        {INTENSIDADE.map((i) => (
          <button key={i.v} className={`option ${c.intensidade === i.v ? 'on' : ''}`} onClick={() => set({ intensidade: i.v })}>
            <span className="option-title">{i.label}</span>
            <span className="option-desc">{i.desc}</span>
          </button>
        ))}
      </div>

      <label className="field">
        <span>Dia</span>
        <input type="date" value={c.date} max={todayISO()} onChange={(e) => e.target.value && set({ date: e.target.value })} />
      </label>

      <details className="advanced cardio-more">
        <summary>
          <span className="grow">Mais detalhes (opcional): melhoram a estimativa</span>
          <IconDown className="chev" />
        </summary>
        <div className="grid2">
          {def.campos.includes('distancia') && <OptNumberField label="Distância (km)" value={c.distanciaKm} onChange={(n) => set({ distanciaKm: n })} />}
          {def.campos.includes('inclinacao') && <OptNumberField label="Inclinação (%)" value={c.inclinacao} onChange={(n) => set({ inclinacao: n })} />}
          {def.campos.includes('watts') && <OptNumberField label="Potência (W)" value={c.watts} onChange={(n) => set({ watts: n })} />}
          <OptNumberField label="FC média (bpm)" value={c.fcMedia} onChange={(n) => set({ fcMedia: n })} />
          <OptNumberField label="kcal do aparelho" value={c.kcalAparelho} onChange={(n) => set({ kcalAparelho: n })} />
        </div>
        <label className="field">
          <span>Observação</span>
          <input value={c.obs ?? ''} placeholder="Ex.: tiros de 1 min" onChange={(e) => set({ obs: e.target.value })} />
        </label>
      </details>

      <p className="cardio-est">
        <strong>{kcalTxt(est.kcal)}</strong> · {fmtNum(Math.round(est.met * 10) / 10, 1)} METs
        {est.velocidadeKmh ? ` · ${fmtNum(Math.round(est.velocidadeKmh * 10) / 10, 1)} km/h` : ''}
        {est.pctFcMax ? ` · ${Math.round(est.pctFcMax)}% da FC máx. (${est.intensidade})` : ''}
        <br />
        <span className="muted small">Estimativa por {METODO_LABEL[est.metodo]}.</span>
      </p>

      <button
        className="btn primary block"
        disabled={!valido}
        onClick={() => {
          saveCardio(c);
          onClose();
        }}
      >
        {editando ? 'Salvar alterações' : 'Registrar cardio'}
      </button>
      {editando && (
        <button
          className="btn ghost danger block"
          onClick={async () => {
            if (await ask({ title: 'Apagar este cardio?', message: `${def.label}, ${c.minutos} min, ${dayLabel(c.date).toLowerCase()}.`, confirm: 'Apagar', danger: true })) {
              deleteCardio(c.id);
              onClose();
            }
          }}
        >
          <IconTrash /> Apagar
        </button>
      )}
    </Sheet>
  );
}

/** Botão + sheet para registrar cardio de qualquer tela (ex.: durante o treino). */
export function useCardioSheet(date?: string) {
  const [edit, setEdit] = useState<Cardio | null>(null);
  return {
    abrir: (c?: Cardio) => setEdit(c ?? novoCardio(getData(), date ?? todayISO())),
    sheet: <CardioSheet open={!!edit} initial={edit} onClose={() => setEdit(null)} />,
  };
}

export function CardioSection({ data, hoje }: { data: AppData; hoje: string }) {
  const { abrir, sheet } = useCardioSheet(hoje);
  const body = bodyOf(data.settings.profile);
  const deHoje = cardioOn(data, hoje);
  const ontem = cardioOn(data, addDays(hoje, -1));
  const semana = coachWeek(data, hoje);
  const ultimos = cardioBetween(data, addDays(hoje, -6), hoje).length;
  const lista = deHoje.length ? deHoje : ontem;
  return (
    <>
      <div className="section-title row between">
        <span>Cardio</span>
        <span className="muted small">
          {Math.round(semana.minutosOms)} de 150–300 min na semana
        </span>
      </div>
      <section className="card cardio-card">
        {lista.length > 0 ? (
          <>
            <div className="label">{deHoje.length ? 'Hoje' : 'Ontem'}</div>
            <div className="cardio-list">
              {lista.map((c) => {
                const est = estimateCardio(c, body);
                return (
                  <button key={c.id} className="cardio-row" onClick={() => abrir(c)}>
                    <span className="grow">
                      <strong>{cardioDef(c.tipo).label}</strong>
                      <span className="muted small">
                        {' '}
                        · {c.minutos} min · {est.intensidade} · {c.hora}
                      </span>
                    </span>
                    <span className="small strong">{kcalTxt(est.kcal)}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="muted small m0">{ultimos ? 'Nenhum cardio hoje.' : 'Nenhum cardio registrado nos últimos 7 dias.'} O coach usa o cardio para calcular o gasto do dia e ajustar as dicas de comida e treino.</p>
        )}
        <button className="btn block outline" onClick={() => abrir()}>
          <IconPlus /> Registrar cardio
        </button>
      </section>
      {sheet}
    </>
  );
}
