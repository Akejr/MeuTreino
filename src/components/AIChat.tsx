/**
 * Botão flutuante da IA. Cada tela registra o seu contexto (texto com os dados da tela);
 * o chat abre já com uma leitura de pontos bons e a melhorar, e aceita perguntas.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOnline } from '../lib/hooks';
import { chat } from '../lib/openrouter';
import { OPENING_PROMPT, screenMessages } from '../lib/prompts';
import { getData, setData, useData } from '../lib/storage';
import { errMsg } from '../lib/utils';
import type { ChatMsg } from '../types';
import { ChatInput, ChatMessages } from './Chat';
import { IconSparkle, IconSync } from './Icons';
import Sheet from './Sheet';

interface Ctx {
  key: string;
  title: string;
  build: () => string;
  priority: number;
  id: number;
}

const registry = new Map<number, Ctx>();
const listeners = new Set<() => void>();
let current: Ctx | null = null;
let seq = 0;

function recompute() {
  let best: Ctx | null = null;
  for (const c of registry.values()) if (!best || c.priority > best.priority || (c.priority === best.priority && c.id > best.id)) best = c;
  current = best;
  listeners.forEach((l) => l());
}

/** Registra o contexto da tela atual para o chat. Telas internas usam prioridade maior. */
export function useAIContext(key: string, title: string, build: () => string, priority = 0) {
  const ref = useRef(build);
  ref.current = build;
  useEffect(() => {
    const id = ++seq;
    registry.set(id, { key, title, build: () => ref.current(), priority, id });
    recompute();
    return () => {
      registry.delete(id);
      recompute();
    };
  }, [key, title, priority]);
}

function useCurrent() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
};

const MAX_THREADS = 25;

function setThread(key: string, fn: (m: ChatMsg[]) => ChatMsg[]) {
  setData((d) => {
    const aiChats = { ...d.aiChats, [key]: fn(d.aiChats[key] ?? []) };
    const keys = Object.keys(aiChats);
    if (keys.length > MAX_THREADS) {
      const last = (k: string) => aiChats[k][aiChats[k].length - 1]?.ts ?? 0;
      keys.sort((a, b) => last(a) - last(b)).slice(0, keys.length - MAX_THREADS).forEach((k) => delete aiChats[k]);
    }
    return { ...d, aiChats };
  });
}

export function AIFab() {
  const ctx = useCurrent();
  const data = useData();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const key = ctx?.key ?? '';
  const msgs = key ? data.aiChats[key] ?? [] : [];

  async function ask(k: string, build: () => string, history: ChatMsg[]) {
    setLoading(k);
    setErro('');
    try {
      const r = await chat(getData(), screenMessages(build(), history), 0.5);
      setThread(k, (m) => [...m, { role: 'assistant', content: r, ts: Date.now() }]);
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLoading(null);
    }
  }

  function opening() {
    if (!ctx) return;
    const first: ChatMsg = { role: 'user', content: OPENING_PROMPT, ts: Date.now(), hidden: true, ctxHash: hash(ctx.build()) };
    setThread(ctx.key, () => [first]);
    void ask(ctx.key, ctx.build, [first]);
  }

  useEffect(() => {
    if (open && ctx && online && !loading && !(getData().aiChats[ctx.key]?.length)) opening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, online]);

  function send(text: string) {
    if (!ctx) return;
    const history = [...msgs, { role: 'user' as const, content: text, ts: Date.now() }];
    setThread(ctx.key, () => history);
    void ask(ctx.key, ctx.build, history);
  }

  const stale = open && ctx && msgs[0]?.ctxHash && msgs[0].ctxHash !== hash(ctx.build());
  const lastFailed = msgs.length > 0 && msgs[msgs.length - 1].role === 'user' && loading !== key;

  if (!ctx) return null;
  return (
    <>
      {!open && (
        <button className="fab" aria-label="Abrir coach IA" onClick={() => setOpen(true)}>
          <IconSparkle />
        </button>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        full
        title={
          <div>
            <div className="eyebrow">Coach IA</div>
            <div>{ctx.title}</div>
          </div>
        }
      >
        <div className="ai-sheet">
          {!online && <p className="notice">Sem internet. O treino e a dieta continuam funcionando; a IA volta quando a conexão voltar.</p>}
          {stale && (
            <button className="notice action" onClick={opening} disabled={!!loading || !online}>
              <IconSync /> Os dados desta tela mudaram. Toque para uma nova análise.
            </button>
          )}
          <div className="ai-scroll">
            <ChatMessages messages={msgs} loading={loading === key} />
            {erro && <p className="error">{erro}</p>}
            {lastFailed && !erro && online && (
              <button className="btn small" onClick={() => void ask(key, ctx.build, msgs)}>
                Tentar de novo
              </button>
            )}
          </div>
          <div className="ai-foot">
            {msgs.length > 0 && (
              <button className="link small" disabled={!!loading || !online} onClick={opening}>
                Nova análise
              </button>
            )}
            <ChatInput onSend={send} disabled={!!loading || !online} placeholder="Pergunte sobre esta tela…" />
          </div>
        </div>
      </Sheet>
    </>
  );
}
