/** Código de acesso do servidor: digitado uma vez por aparelho (não é conta). */
import { useState } from 'react';
import { accessCodeOf } from '../lib/openrouter';
import { setData, useData } from '../lib/storage';
import { checkAccessCode, requestSync } from '../lib/sync';
import Sheet from './Sheet';

export function AccessCodeForm({ onDone }: { onDone?: () => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function salvar() {
    const c = code.trim().toLowerCase();
    if (!c) return;
    setBusy(true);
    setMsg('');
    let ok: boolean | null = null;
    try {
      ok = await checkAccessCode(c);
    } catch {
      ok = null; // sem internet ou servidor fora: salva e confere na próxima sincronização
    }
    setBusy(false);
    if (ok === false) {
      setMsg('Código incorreto.');
      return;
    }
    setData((d) => ({ ...d, local: { ...d.local, accessCode: c } }));
    requestSync(100);
    if (ok === null) setMsg('Salvo. Não deu para conferir agora; confiro quando a internet voltar.');
    onDone?.();
  }

  return (
    <>
      <label className="field">
        <span>Código de acesso</span>
        <input autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code} placeholder="xxxx-xxxx-xxxx" onChange={(e) => setCode(e.target.value)} />
      </label>
      <button className="btn primary block" disabled={busy || !code.trim()} onClick={salvar}>
        {busy ? 'Conferindo…' : 'Salvar'}
      </button>
      {msg && <p className="notice">{msg}</p>}
    </>
  );
}

export default function AccessGate() {
  const data = useData();
  const [fechado, setFechado] = useState(false);
  if (accessCodeOf(data) || fechado) return null;
  return (
    <Sheet open onClose={() => setFechado(true)} title="Código de acesso">
      <p className="muted small">
        Digite uma vez neste aparelho. Ele libera a IA e a cópia dos seus dados no servidor. Sem o código o app funciona normalmente, só que sem IA e sem cópia.
      </p>
      <AccessCodeForm onDone={() => setFechado(true)} />
      <button className="btn ghost block" onClick={() => setFechado(true)}>
        Agora não
      </button>
    </Sheet>
  );
}
