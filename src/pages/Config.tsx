import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessCodeForm } from '../components/AccessGate';
import { useAIContext } from '../components/AIChat';
import { ask, notify, toast } from '../components/Dialog';
import { IconBox, IconCloud, IconDown, IconFlame, IconShield, IconTreino, IconUser } from '../components/Icons';
import NumberField from '../components/NumberField';
import { useOnline } from '../lib/hooks';
import { accessCodeOf } from '../lib/openrouter';
import { configContext } from '../lib/prompts';
import { exportBackup, getData, getSaveError, importBackup, listSnapshots, pendingCount, restoreSnapshot, setData, storageInfo, useData, type SnapshotInfo } from '../lib/storage';
import { syncNow, useSyncStatus } from '../lib/sync';
import { errMsg } from '../lib/utils';
import type { Base, DiaTipo, Limits, Profile, Settings, TrainingSettings, Unidade } from '../types';
import { answerQuestion, removeNextWeight, saveEquipment } from '../training/actions';
import { BASE_LABEL, BASE_OPCOES, CATALOG, getEx, QUESTIONS } from '../training/catalog';
import { fmtW } from '../training/engine';

const PROFILE_FIELDS: [keyof Profile, string, string][] = [
  ['nome', 'Nome', ''],
  ['sexo', 'Sexo', ''],
  ['idade', 'Idade', 'anos'],
  ['peso', 'Peso (kg)', ''],
  ['altura', 'Altura (cm)', ''],
  ['nivel', 'Experiência', ''],
];

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIA_TIPO: { v: DiaTipo; label: string }[] = [
  { v: 'treino', label: 'Treino' },
  { v: 'disponivel', label: 'Reposição' },
  { v: 'indisponivel', label: 'Não' },
];

function Head({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="row card-head">
      <span className="tile">{icon}</span>
      <div className="grow">
        <h2 className="m0">{title}</h2>
        <span className="muted small">{sub}</span>
      </div>
    </div>
  );
}

export default function Config() {
  const data = useData();
  const s = data.settings;
  useAIContext('ajustes', 'Ajustes', () => configContext(getData()));
  const setS = (patch: Partial<Settings>) => setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setT = (patch: Partial<TrainingSettings>) => setData((d) => ({ ...d, settings: { ...d.settings, training: { ...d.settings.training, ...patch } } }));
  const setL = (k: keyof Limits, v: number) => setS({ limits: { ...s.limits, [k]: v } });
  const setP = (k: keyof Profile, v: string) => setS({ profile: { ...s.profile, [k]: v } });

  return (
    <>
      <section className="card">
        <Head icon={<IconUser />} title="Perfil" sub="Usado pelo personal e pelo coach" />
        <div className="grid2">
          {PROFILE_FIELDS.map(([k, label, ph]) => (
            <label key={k} className="field">
              <span>{label}</span>
              <input value={s.profile[k]} placeholder={ph} inputMode={k === 'peso' || k === 'altura' || k === 'idade' ? 'decimal' : undefined} onChange={(e) => setP(k, e.target.value)} />
            </label>
          ))}
        </div>
        <label className="field">
          <span>Objetivo</span>
          <input value={s.profile.objetivo} onChange={(e) => setP('objetivo', e.target.value)} />
        </label>
        <label className="field">
          <span>Restrições, lesões, corrida e futebol</span>
          <textarea rows={3} value={s.profile.observacoes} onChange={(e) => setP('observacoes', e.target.value)} />
        </label>
      </section>

      <section className="card">
        <Head icon={<IconFlame />} title="Limites da dieta" sub="Por dia" />
        <div className="grid2">
          <NumberField label="Proteína meta (g)" value={s.limits.proteina} onChange={(n) => setL('proteina', n)} />
          <NumberField label="Calorias máx (kcal)" value={s.limits.calorias} onChange={(n) => setL('calorias', n)} />
          <NumberField label="Carboidratos máx (g)" value={s.limits.carboidratos} onChange={(n) => setL('carboidratos', n)} />
          <NumberField label="Gordura máx (g)" value={s.limits.gordura} onChange={(n) => setL('gordura', n)} />
        </div>
      </section>

      <section className="card">
        <Head icon={<IconTreino />} title="Treino" sub="Agenda, tempo e progressão" />
        <div className="grid2">
          <NumberField label="Duração alvo (min)" value={s.training.duracaoMin} onChange={(n) => setT({ duracaoMin: Math.max(20, Math.round(n)) })} />
          <NumberField label="Maior aumento automático (%)" value={s.training.limitePct} onChange={(n) => setT({ limitePct: Math.max(0, n) })} />
        </div>
        <div className="label mt12">Dias da semana</div>
        <div className="days">
          {DIAS.map((nome, i) => (
            <div key={nome} className="day-row">
              <span>{nome}</span>
              <div className="segmented small">
                {DIA_TIPO.map((o) => (
                  <button key={o.v} className={s.training.dias[i] === o.v ? 'on' : ''} onClick={() => setT({ dias: s.training.dias.map((x, j) => (j === i ? o.v : x)) })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="muted small">Reposição: o app só usa o dia para repor um treino perdido.</p>
      </section>

      <Servidor />
      <Backup />

      <details className="card advanced">
        <summary>
          <span className="tile">
            <IconBox />
          </span>
          <span className="grow">
            <span className="strong">Aparelhos e variações</span>
            <br />
            <span className="muted small">Já configurado. Mexa só se trocar de academia ou errar algo.</span>
          </span>
          <IconDown className="chev" />
        </summary>
        <Catalogo t={s.training} setT={setT} />
        <Equipamentos />
      </details>
    </>
  );
}

function Servidor() {
  const st = useSyncStatus();
  const data = useData();
  const online = useOnline();
  const [trocar, setTrocar] = useState(false);
  const pend = pendingCount(data);
  const temCodigo = !!accessCodeOf(data);

  const estado =
    st.state === 'syncing'
      ? 'Sincronizando…'
      : st.state === 'offline'
        ? 'Sem internet: fica salvo no aparelho e sobe quando a conexão voltar.'
        : st.state === 'denied'
          ? 'Código de acesso incorreto.'
          : st.state === 'error'
            ? `Erro: ${st.error}`
            : data.sync.lastSyncAt
              ? `Copiado às ${new Date(data.sync.lastSyncAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'Aguardando a primeira cópia';

  return (
    <section className="card">
      <Head icon={<IconCloud />} title="Cópia no servidor" sub="Seus dados guardados fora do celular" />
      {temCodigo && !trocar ? (
        <>
          <div className="status-row">
            <span>Estado</span>
            <span className="right">{estado}</span>
          </div>
          <div className="status-row">
            <span>Alterações aguardando envio</span>
            <strong>{pend}</strong>
          </div>
          <div className="row gap">
            <button className="btn grow" disabled={!online || st.state === 'syncing'} onClick={() => void syncNow()}>
              Sincronizar agora
            </button>
            <button className="btn grow" onClick={() => setTrocar(true)}>
              Trocar código
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">Digite o código de acesso uma vez neste aparelho. Ele libera a IA e a cópia no servidor.</p>
          <AccessCodeForm onDone={() => setTrocar(false)} />
          {pend > 0 && <p className="muted small">{pend} registros deste aparelho serão enviados depois do código.</p>}
        </>
      )}
    </section>
  );
}

function Catalogo({ t, setT }: { t: TrainingSettings; setT: (p: Partial<TrainingSettings>) => void }) {
  const opcionais = CATALOG.filter((e) => e.opcional);
  return (
    <div className="adv-block">
      <div className="label">Variações dos aparelhos</div>
      {QUESTIONS.map((q) => (
        <div key={q.id} className="q">
          <div className="small strong">{q.pergunta}</div>
          <div className="chips">
            {q.opcoes.map((o) => {
              const on = t.respostas[q.id] !== undefined && JSON.stringify([...(t.respostas[q.id] ?? [])].sort()) === JSON.stringify([...o.ativa].sort());
              return (
                <button key={o.label} className={`chip ${on ? 'on' : ''}`} onClick={() => answerQuestion(q.id, o.ativa)}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="label mt12">Opcionais aceitos no catálogo</div>
      <div className="chips">
        {opcionais.map((e) => {
          const on = t.aceitos.includes(e.id);
          return (
            <button key={e.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setT({ aceitos: on ? t.aceitos.filter((x) => x !== e.id) : [...t.aceitos, e.id] })}>
              {e.nome}
            </button>
          );
        })}
      </div>
      <div className="label mt12">Não gosto (fora de trocas e fichas)</div>
      {t.naoGosto.length === 0 && <p className="muted small">Nenhum. Ao trocar um exercício por "não gosto", você pode marcar aqui.</p>}
      <div className="chips">
        {t.naoGosto.map((id) => (
          <button key={id} className="chip on" onClick={() => setT({ naoGosto: t.naoGosto.filter((x) => x !== id) })}>
            {getEx(id).nome} ×
          </button>
        ))}
      </div>
    </div>
  );
}

function Equipamentos() {
  const data = useData();
  const lista = Object.values(data.equipment).sort((a, b) => a.id.localeCompare(b.id));
  const nomes = (equip: string) =>
    CATALOG.filter((e) => e.equip === equip && !e.pergunta)
      .map((e) => e.nome)
      .join(', ');
  return (
    <div className="adv-block">
      <div className="label">Base da carga e próximos pesos</div>
      {lista.length === 0 && <p className="muted small">O app pergunta na primeira vez que você usar cada aparelho.</p>}
      {lista.map((eq) => (
        <details key={eq.id} className="equip">
          <summary>
            <span className="grow">
              <span className="strong">{nomes(eq.id) || eq.id}</span>
              <br />
              <span className="muted small">
                {eq.unidade} {BASE_LABEL[eq.base]}
                {eq.conhecidos.length ? ` · pesos vistos: ${eq.conhecidos.map(fmtW).join(', ')}` : ''}
              </span>
            </span>
          </summary>
          <div className="chips mt8">
            {BASE_OPCOES.map((o) => (
              <button key={o.base} className={`chip ${eq.base === o.base ? 'on' : ''}`} onClick={() => saveEquipment(eq.id, eq.unidade, o.base as Base)}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="chips mt8">
            {(['kg', 'lb'] as Unidade[]).map((u) => (
              <button key={u} className={`chip ${eq.unidade === u ? 'on' : ''}`} onClick={() => saveEquipment(eq.id, u, eq.base)}>
                {u}
              </button>
            ))}
          </div>
          {Object.keys(eq.proximo).length > 0 && (
            <>
              <div className="label mt8">Próximo peso registrado</div>
              {Object.entries(eq.proximo).map(([de, para]) => (
                <div key={de} className="status-row">
                  <span>
                    {fmtW(Number(de))} → {para < 0 ? 'não existe' : fmtW(para)} {eq.unidade}
                  </span>
                  <button className="link small" onClick={() => removeNextWeight(eq.id, de)}>
                    Corrigir
                  </button>
                </div>
              ))}
            </>
          )}
        </details>
      ))}
    </div>
  );
}

function Backup() {
  const data = useData();
  const [info, setInfo] = useState<{ persisted: boolean; usage: number; quota: number } | null>(null);
  const [snaps, setSnaps] = useState<SnapshotInfo[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    storageInfo().then(setInfo);
    listSnapshots()
      .then(setSnaps)
      .catch(() => {});
  }, [data.updatedAt]);

  async function importar(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    const ok = await ask({ title: 'Importar este backup?', message: 'Os dados atuais serão substituídos. Uma cópia deles fica guardada nos snapshots.', confirm: 'Importar', danger: true });
    if (!ok) return;
    try {
      await importBackup(f);
      toast('Backup importado');
    } catch (e) {
      await notify('Não foi possível importar', errMsg(e));
    }
  }

  async function restaurar(key: string) {
    const ok = await ask({ title: 'Restaurar este snapshot?', message: `${key}. Os dados atuais ficam guardados num novo snapshot.`, confirm: 'Restaurar', danger: true });
    if (!ok) return;
    try {
      await restoreSnapshot(key);
      toast('Snapshot restaurado');
    } catch (e) {
      await notify('Não foi possível restaurar', errMsg(e));
    }
  }

  const saveError = getSaveError();
  return (
    <section className="card">
      <Head icon={<IconShield />} title="Backup no aparelho" sub="Cópias locais e arquivo de backup" />
      {saveError && <p className="error">{saveError}</p>}
      {info && (
        <div className="status-row">
          <span>Armazenamento persistente</span>
          <strong>{info.persisted ? 'ativado' : 'não garantido'}</strong>
        </div>
      )}
      <div className="row gap mt8">
        <button className="btn grow" onClick={exportBackup}>
          Exportar backup
        </button>
        <button className="btn grow" onClick={() => fileRef.current?.click()}>
          Importar
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importar(e.target.files?.[0])} />
      </div>
      <div className="label mt12">Snapshots automáticos (1 por dia, 30 dias)</div>
      {snaps.length === 0 && <p className="muted small">Nenhum ainda.</p>}
      <ul className="snaps">
        {snaps.slice(0, 5).map((sn) => (
          <li key={sn.key}>
            <span className="small">
              {sn.key}
              <br />
              <span className="muted">
                {sn.refeicoes} refeições · {sn.sessoes} sessões
              </span>
            </span>
            <button className="btn small" onClick={() => void restaurar(sn.key)}>
              Restaurar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
