import { useState } from 'react';
import { useAIContext } from '../components/AIChat';
import { ask, toast } from '../components/Dialog';
import { IconCheck, IconDown, IconFlame, IconPlus } from '../components/Icons';
import Sheet from '../components/Sheet';
import { addHabit, archiveHabit, deleteHabit, renameHabit, restoreHabit, toggleHabit } from '../habits/actions';
import { activeHabits, archivedHabits, habitStats, isActiveOn, isDone, perfectStreak } from '../habits/habits';
import { habitsContext } from '../lib/prompts';
import { getData, useData } from '../lib/storage';
import { addDays, dow, todayISO, WEEKDAY_SHORT } from '../lib/utils';
import type { AppData, Habit } from '../types';

const SUGESTOES = ['Beber 3 L de água', 'Dormir 7 h ou mais', '10 mil passos', 'Tomar creatina', 'Alongar 10 min', 'Sem doce', 'Ler 20 min'];
const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`);

function marcar(h: Habit, date: string) {
  const antes = getData();
  const marcando = !isDone(antes, h.id, date);
  toggleHabit(h.id, date);
  if (!marcando) return;
  navigator.vibrate?.(25);
  const hoje = todayISO();
  if (date !== hoje) return;
  const d = getData();
  const hs = activeHabits(d, hoje);
  if (hs.length > 1 && hs.every((x) => isDone(d, x.id, hoje))) toast('Todos os hábitos de hoje feitos');
}

export default function Habitos() {
  const data = useData();
  const hoje = todayISO();
  const [novo, setNovo] = useState(false);
  const [edit, setEdit] = useState<Habit | null>(null);
  useAIContext('habitos', 'Hábitos', () => habitsContext(getData()));

  const hs = activeHabits(data, hoje);
  const arquivados = archivedHabits(data);
  const feitos = hs.filter((h) => isDone(data, h.id, hoje)).length;
  const perf = perfectStreak(data, hoje);
  const stats = hs.map((h) => habitStats(data, h, hoje));
  const melhor = Math.max(0, ...stats.map((s) => s.melhor));
  const media = stats.length ? Math.round(stats.reduce((n, s) => n + s.taxa30, 0) / stats.length) : 0;

  return (
    <>
      {hs.length > 0 ? (
        <section className="card hero">
          <span className="hero-label">
            Hoje · {feitos} de {hs.length}
          </span>
          <h2 className="hero-title">
            <IconFlame className="hero-flame" /> {dias(perf.atual)}
          </h2>
          <p className="hero-sub">{perf.hojeCompleto ? 'Ofensiva perfeita: todos os hábitos feitos hoje.' : perf.atual ? 'De ofensiva perfeita. Faça todos hoje para manter.' : 'Faça todos os hábitos hoje para começar uma ofensiva perfeita.'}</p>
          <div className="progress">
            <div style={{ width: `${(feitos / hs.length) * 100}%` }} />
          </div>
          <div className="hero-stats">
            <div>
              <strong>{melhor}</strong>
              <span>melhor sequência</span>
            </div>
            <div>
              <strong>{media}%</strong>
              <span>em 30 dias</span>
            </div>
            <div>
              <strong>{hs.length}</strong>
              <span>hábitos</span>
            </div>
          </div>
        </section>
      ) : (
        <section className="card empty">
          <div className="empty-icon">
            <IconFlame />
          </div>
          <h2>Crie seus hábitos diários</h2>
          <p className="muted small">Marque todo dia o que você fez. Cada dia seguido aumenta a ofensiva do hábito.</p>
          <div className="chips center">
            {SUGESTOES.slice(0, 5).map((s) => (
              <button key={s} className="chip" onClick={() => addHabit(s)}>
                + {s}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="section-title row between">
        <span>{hs.length ? 'Hoje' : 'Seus hábitos'}</span>
        <button className="btn small" onClick={() => setNovo(true)}>
          <IconPlus /> Novo hábito
        </button>
      </div>

      {hs.map((h, k) => (
        <HabitCard key={h.id} data={data} h={h} hoje={hoje} s={stats[k]} onEdit={() => setEdit(h)} />
      ))}

      {arquivados.length > 0 && (
        <details className="card advanced">
          <summary>
            <span className="grow">
              <span className="strong">Arquivados ({arquivados.length})</span>
              <br />
              <span className="muted small">Não contam mais no dia. O histórico fica guardado.</span>
            </span>
            <IconDown className="chev" />
          </summary>
          <div className="adv-block">
            {arquivados.map((h) => (
              <div key={h.id} className="status-row">
                <span>{h.nome}</span>
                <span className="row gap0">
                  <button className="btn small" onClick={() => restoreHabit(h.id)}>
                    Reativar
                  </button>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <NewHabitSheet open={novo} onClose={() => setNovo(false)} existentes={hs.map((h) => h.nome.toLowerCase())} />
      <EditHabitSheet h={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function HabitCard({ data, h, hoje, s, onEdit }: { data: AppData; h: Habit; hoje: string; s: ReturnType<typeof habitStats>; onEdit: () => void }) {
  const semana = Array.from({ length: 7 }, (_, i) => addDays(hoje, i - 6));
  const msg = s.feitoHoje
    ? `Feito hoje · melhor sequência ${s.melhor}`
    : s.emRisco
      ? `Marque hoje para manter ${dias(s.atual)}`
      : `Melhor sequência ${s.melhor} · ${s.taxa30}% em 30 dias`;
  return (
    <section className={`card habit ${s.feitoHoje ? 'done' : ''}`}>
      <div className="row">
        <div className={`streak ${s.atual > 0 ? 'on' : ''} ${s.feitoHoje ? 'lit' : ''}`} aria-label={`Ofensiva de ${dias(s.atual)}`}>
          <IconFlame />
          <strong>{s.atual}</strong>
        </div>
        <button className="habit-name grow" onClick={onEdit}>
          <span className="strong">{h.nome}</span>
          <span className={`small ${s.emRisco ? 'risk' : 'muted'}`}>{msg}</span>
        </button>
        <button className={`habit-check ${s.feitoHoje ? 'on' : ''}`} aria-label={s.feitoHoje ? `Desmarcar ${h.nome}` : `Marcar ${h.nome}`} onClick={() => marcar(h, hoje)}>
          <IconCheck />
        </button>
      </div>
      <div className="hweek">
        {semana.map((d) => {
          const ativo = isActiveOn(h, d);
          const feito = isDone(data, h.id, d);
          return (
            <button key={d} className={`hday ${feito ? 'on' : ''} ${d === hoje ? 'today' : ''}`} disabled={!ativo} onClick={() => marcar(h, d)} aria-label={`${d}: ${feito ? 'feito' : 'não feito'}`}>
              <span>{WEEKDAY_SHORT[dow(d)].slice(0, 1)}</span>
              <i />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NewHabitSheet({ open, onClose, existentes }: { open: boolean; onClose: () => void; existentes: string[] }) {
  const [nome, setNome] = useState('');
  const repetido = existentes.includes(nome.trim().toLowerCase());
  function criar(n = nome) {
    if (!n.trim() || existentes.includes(n.trim().toLowerCase())) return;
    addHabit(n);
    toast('Hábito criado');
    setNome('');
    onClose();
  }
  return (
    <Sheet open={open} onClose={onClose} title="Novo hábito">
      <label className="field">
        <span>O que você quer fazer todos os dias?</span>
        <input value={nome} maxLength={60} placeholder="Ex.: Beber 3 L de água" onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criar()} />
      </label>
      {repetido && <p className="notice">Você já tem um hábito com esse nome.</p>}
      <div className="chips">
        {SUGESTOES.filter((s) => !existentes.includes(s.toLowerCase())).map((s) => (
          <button key={s} className="chip" onClick={() => setNome(s)}>
            {s}
          </button>
        ))}
      </div>
      <p className="muted small">Começa a contar hoje. Dá para marcar até 7 dias para trás, se esquecer.</p>
      <button className="btn primary block" disabled={!nome.trim() || repetido} onClick={() => criar()}>
        Criar hábito
      </button>
    </Sheet>
  );
}

function EditHabitSheet({ h, onClose }: { h: Habit | null; onClose: () => void }) {
  const [nome, setNome] = useState('');
  const [id, setId] = useState<string | null>(null);
  if (h && h.id !== id) {
    setId(h.id);
    setNome(h.nome);
  }
  if (!h) return null;
  async function arquivar() {
    if (!(await ask({ title: `Arquivar "${h!.nome}"?`, message: 'Para de contar a partir de hoje. O histórico e a ofensiva ficam guardados e dá para reativar.', confirm: 'Arquivar' }))) return;
    archiveHabit(h!.id);
    onClose();
  }
  async function apagar() {
    if (!(await ask({ title: `Apagar "${h!.nome}"?`, message: 'Apaga o hábito e todo o histórico dele.', confirm: 'Apagar', danger: true }))) return;
    deleteHabit(h!.id);
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title="Editar hábito">
      <label className="field">
        <span>Nome</span>
        <input value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} />
      </label>
      <button
        className="btn primary block"
        disabled={!nome.trim() || nome.trim() === h.nome}
        onClick={() => {
          renameHabit(h.id, nome);
          onClose();
        }}
      >
        Salvar nome
      </button>
      <div className="row gap mt12">
        <button className="btn grow" onClick={() => void arquivar()}>
          Arquivar
        </button>
        <button className="btn ghost danger grow" onClick={() => void apagar()}>
          Apagar
        </button>
      </div>
    </Sheet>
  );
}
