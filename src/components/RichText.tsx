/** Texto da IA com **negrito** e listas com "-", sem HTML cru. */
import { Fragment, type ReactNode } from 'react';

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  // Asteriscos soltos que sobraram (ex.: *itálico*) saem do texto.
  return out.map((x) => (typeof x === 'string' ? x.replace(/\*+/g, '') : x));
}

export default function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (k: number) => {
    if (list.length) blocks.push(<ul key={`ul${k}`}>{list}</ul>);
    list = [];
  };
  lines.forEach((raw, k) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      list.push(<li key={k}>{inline(bullet[1], `l${k}`)}</li>);
      return;
    }
    flush(k);
    if (!line.trim()) return;
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={k} className="rt-h">
          <strong>{heading[1].replace(/\*\*/g, '')}</strong>
        </p>,
      );
      return;
    }
    blocks.push(<p key={k}>{inline(line, `p${k}`)}</p>);
  });
  flush(lines.length);
  return <Fragment>{blocks}</Fragment>;
}

/** Uma linha só (ex.: item de lista das dicas). */
export function RichInline({ text }: { text: string }) {
  return <>{inline(text, 'i')}</>;
}
