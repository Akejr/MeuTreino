/** "Encerrar treino": continuar depois, encerrar incompleto (conta como feito) ou perder o progresso. */
import { ask, toast } from '../../components/Dialog';
import Sheet from '../../components/Sheet';
import { showSession } from '../../lib/sessionUI';
import type { AppData, Session } from '../../types';
import { discardSession, finishSession, pauseSession } from '../../training/actions';
import { sessionSteps, slotActive } from '../../training/engine';
import { isPaused, planSessionOf } from '../../training/schedule';

export default function EndSheet({ data, s, open, onClose }: { data: AppData; s: Session; open: boolean; onClose: () => void }) {
  const ps = planSessionOf(data, s);
  if (!ps) return null;
  const steps = sessionSteps(ps, s, data.settings.training).filter((x) => slotActive(s, x.slotId));
  const pend = steps.filter((x) => !data.sets[x.id]).length;
  const feitas = Object.values(data.sets).filter((x) => x.sessionId === s.id && x.status === 'feita').length;
  const pausado = isPaused(s);

  function continuarDepois() {
    onClose();
    pauseSession(s.id);
    showSession(null);
  }

  function encerrar() {
    onClose();
    showSession(s.id); // mostra o resumo do treino
    finishSession(s.id);
  }

  async function perder() {
    const ok = await ask({
      title: 'Perder o progresso deste treino?',
      message: feitas
        ? `As ${feitas} séries registradas serão apagadas e o treino volta como estava antes de começar.`
        : 'O treino volta como estava antes de começar.',
      confirm: 'Perder progresso',
      cancel: 'Voltar',
      danger: true,
    });
    if (!ok) return;
    onClose();
    showSession(null);
    discardSession(s.id);
    toast('Treino descartado');
  }

  return (
    <Sheet open={open} onClose={onClose} title="Encerrar treino">
      <p className="muted small">
        {feitas} de {steps.length} séries feitas.
      </p>
      <div className="stack">
        {!pausado && (
          <button className="option strong" onClick={continuarDepois}>
            <span className="option-title">Encerrar e continuar depois</span>
            <span className="option-desc">O cronômetro para. Continue quando quiser, do ponto onde parou.</span>
          </button>
        )}
        <button className="option" onClick={encerrar}>
          <span className="option-title">{pend ? 'Encerrar treino incompleto' : 'Concluir treino'}</span>
          <span className="option-desc">
            {pend ? 'Conta como treino feito, mesmo com exercícios faltando. As séries registradas ficam salvas.' : 'Todas as séries foram feitas.'}
          </span>
        </button>
        <button className="option danger-option" onClick={() => void perder()}>
          <span className="option-title">Encerrar e perder progresso</span>
          <span className="option-desc">Apaga o que foi registrado neste treino. Tudo volta como estava antes.</span>
        </button>
      </div>
    </Sheet>
  );
}
