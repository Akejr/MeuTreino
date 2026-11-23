import { useEffect, useState, type ComponentType } from 'react';
import AccessGate from './components/AccessGate';
import { AIFab } from './components/AIChat';
import { DialogHost } from './components/Dialog';
import { IconBack, IconCloudOff, IconCloudOk, IconConfig, IconDieta, IconResumo, IconSync, IconTreino } from './components/Icons';
import { showSession, useViewingSession } from './lib/sessionUI';
import { pendingCount, useData } from './lib/storage';
import { useSyncStatus } from './lib/sync';
import Config from './pages/Config';
import Dieta from './pages/Dieta';
import Resumo from './pages/Resumo';
import Treino from './pages/Treino';
import SessionView from './pages/treino/SessionView';
import { activeSession } from './training/schedule';

type Tab = 'treino' | 'dieta' | 'resumo' | 'config';

const TABS: { id: Exclude<Tab, 'config'>; label: string; Icon: ComponentType }[] = [
  { id: 'treino', label: 'Treino', Icon: IconTreino },
  { id: 'dieta', label: 'Dieta', Icon: IconDieta },
  { id: 'resumo', label: 'Resumo', Icon: IconResumo },
];

const TITLES: Record<Tab, string> = { treino: 'Treino', dieta: 'Dieta', resumo: 'Resumo', config: 'Ajustes' };

const readHash = (): Tab => {
  const h = location.hash.slice(1);
  return (['treino', 'dieta', 'resumo', 'config'] as Tab[]).includes(h as Tab) ? (h as Tab) : 'treino';
};

function SyncBadge({ onClick }: { onClick: () => void }) {
  const st = useSyncStatus();
  const data = useData();
  const pend = pendingCount(data);
  if (st.state === 'off') return null;
  const ok = st.state === 'idle' && pend === 0;
  const Icon = st.state === 'syncing' ? IconSync : ok ? IconCloudOk : IconCloudOff;
  const label =
    st.state === 'syncing'
      ? 'Sincronizando'
      : ok
        ? 'Tudo copiado no servidor'
        : st.state === 'denied'
          ? 'Código de acesso incorreto'
          : st.state === 'error'
            ? 'Erro ao sincronizar'
            : `${pend} alterações salvas no aparelho`;
  return (
    <button className={`sync-badge ${st.state}`} aria-label={label} title={label} onClick={onClick}>
      <Icon className={st.state === 'syncing' ? 'spin' : ''} />
      {pend > 0 && st.state !== 'syncing' && <span>{pend}</span>}
    </button>
  );
}

export default function App() {
  const data = useData();
  const [tab, setTab] = useState<Tab>(readHash);
  const [prev, setPrev] = useState<Tab>('treino');
  const [scrolled, setScrolled] = useState(false);
  const viewing = useViewingSession();
  const ativo = activeSession(data);
  // Durante o treino a tela é só do treino: sem menu até pausar, encerrar ou concluir.
  const sessaoNaTela = ativo?.id ?? (viewing && data.sessions[viewing] ? viewing : null);
  const emTreino = !!ativo;
  const nome = data.settings.profile.nome.trim().split(' ')[0];

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [sessaoNaTela]);

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const go = (t: Tab) => {
    showSession(null);
    if (t === 'config') setPrev(tab === 'config' ? prev : tab);
    setTab(t);
  };

  return (
    <div className={`app ${emTreino ? 'in-session' : ''}`}>
      {!sessaoNaTela && (
        <header className={`header ${scrolled ? 'scrolled' : ''}`}>
          {tab === 'config' && (
            <button className="round-btn" aria-label="Voltar" onClick={() => setTab(prev)}>
              <IconBack />
            </button>
          )}
          <div className="grow">
            <div className="eyebrow">{tab !== 'config' && nome ? `Olá, ${nome}` : 'Meu Treino'}</div>
            <h1>{TITLES[tab]}</h1>
          </div>
          <SyncBadge onClick={() => go('config')} />
          {tab !== 'config' && (
            <button className="round-btn" aria-label="Ajustes" onClick={() => go('config')}>
              <IconConfig />
            </button>
          )}
        </header>
      )}

      <main className={`main ${sessaoNaTela ? 'session-main' : ''}`} key={sessaoNaTela ?? tab}>
        {sessaoNaTela ? (
          <SessionView id={sessaoNaTela} onExit={() => showSession(null)} />
        ) : (
          <>
            {tab === 'treino' && <Treino />}
            {tab === 'dieta' && <Dieta />}
            {tab === 'resumo' && <Resumo />}
            {tab === 'config' && <Config />}
          </>
        )}
      </main>

      <nav className={`nav ${emTreino ? 'solo' : ''}`}>
        {!emTreino && (
          <div className="nav-pill">
            {TABS.map(({ id, label, Icon }) => {
              const on = !sessaoNaTela ? tab === id : id === 'treino';
              return (
                <button key={id} className={on ? 'active' : ''} onClick={() => go(id)} aria-current={on ? 'page' : undefined}>
                  <Icon />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
        <AIFab />
      </nav>

      <AccessGate />
      <DialogHost />
    </div>
  );
}
