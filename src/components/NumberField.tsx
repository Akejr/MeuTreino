import { useEffect, useState } from 'react';

/** Campo numérico que aceita vírgula e não "pula" enquanto o usuário digita. */
export default function NumberField({
  value,
  onChange,
  label,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  className?: string;
}) {
  const [text, setText] = useState(String(value ?? 0));
  useEffect(() => {
    if (Number(text.replace(',', '.')) !== value) setText(String(value ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const input = (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(',', '.'));
        if (!Number.isNaN(n)) onChange(n);
      }}
      onFocus={(e) => e.target.select()}
    />
  );
  if (!label) return input;
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  );
}

/** Igual ao NumberField, mas vazio = desconhecido (undefined). */
export function OptNumberField({ value, onChange, label }: { value: number | undefined; onChange: (n: number | undefined) => void; label: string }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    const cur = text.trim() === '' ? undefined : Number(text.replace(',', '.'));
    if (cur !== value) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={text}
        placeholder="—"
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.trim();
          if (raw === '') return onChange(undefined);
          const n = Number(raw.replace(',', '.'));
          if (!Number.isNaN(n)) onChange(n);
        }}
        onFocus={(e) => e.target.select()}
      />
    </label>
  );
}
