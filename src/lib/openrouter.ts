/** IA via /api/ai: a chave da OpenRouter fica só no servidor. */
import type { AppData } from '../types';

export type AIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string | AIPart[] };

export class AccessError extends Error {}

export const accessCodeOf = (d: AppData) => d.local.accessCode || __DEV_ACCESS_CODE__;

export async function chat(d: AppData, messages: AIMessage[], temperature = 0.4): Promise<string> {
  const code = accessCodeOf(d);
  if (!code) throw new AccessError('Digite o código de acesso em Ajustes para usar a IA.');
  if (!navigator.onLine) throw new Error('Sem internet. A IA volta quando a conexão voltar.');
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-code': code },
      body: JSON.stringify({ messages, temperature }),
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  const body = (await res.json().catch(() => ({}))) as { content?: string; error?: string };
  if (res.status === 401) throw new AccessError('Código de acesso incorreto. Confira em Ajustes.');
  if (!res.ok || !body.content) throw new Error(body.error || `Erro do servidor (${res.status}).`);
  return body.content;
}

export async function chatJSON<T>(d: AppData, messages: AIMessage[], temperature = 0.3): Promise<T> {
  return extractJSON<T>(await chat(d, messages, temperature));
}

function extractJSON<T>(text: string): T {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('A IA não retornou JSON válido. Tente novamente.');
  try {
    return JSON.parse(clean.slice(start, end + 1)) as T;
  } catch {
    throw new Error('A IA retornou JSON malformado. Tente novamente.');
  }
}
