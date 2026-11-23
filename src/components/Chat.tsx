import { useEffect, useRef, useState } from 'react';
import type { ChatMsg } from '../types';
import { IconSend } from './Icons';
import RichText from './RichText';

export function ChatMessages({ messages, loading }: { messages: ChatMsg[]; loading?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const visible = messages.filter((m) => !m.hidden);
  // Dentro do chat da IA rola só a lista (scrollIntoView rolaria a página inteira no iOS).
  useEffect(() => {
    const el = end.current;
    const box = el?.closest('.ai-scroll');
    if (box) box.scrollTop = box.scrollHeight;
    else el?.scrollIntoView({ block: 'nearest' });
  }, [visible.length, loading]);
  // Ao abrir o teclado a área visível encolhe: mantém a última mensagem à vista.
  useEffect(() => {
    const vv = window.visualViewport;
    const box = end.current?.closest('.ai-scroll');
    if (!vv || !box) return;
    const keep = () => (box.scrollTop = box.scrollHeight);
    vv.addEventListener('resize', keep);
    return () => vv.removeEventListener('resize', keep);
  }, [visible.length > 0]);
  if (!visible.length && !loading) return null;
  return (
    <div className="chat">
      {visible.map((m, i) => (
        <div key={i} className={`msg ${m.role}`}>
          {m.role === 'assistant' ? <RichText text={m.content} /> : m.content}
        </div>
      ))}
      {loading && (
        <div className="msg assistant typing" aria-label="Pensando">
          <span className="typing-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

export function ChatInput({
  onSend,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
  };
  return (
    <div className="chat-input">
      <textarea
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="btn primary send" onClick={send} disabled={disabled || !text.trim()} aria-label="Enviar">
        <IconSend />
      </button>
    </div>
  );
}
