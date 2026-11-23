# Meu Treino

PWA de treino e dieta para uso no celular, offline primeiro.

- **Treino:** ficha A–E, uma série por vez, progressão dupla calculada pelo app, troca de exercício, agenda com reposição.
- **Dieta:** refeições calculadas pela IA com os alimentos cadastrados (inclusive por foto da tabela nutricional).
- **Resumo:** calendário do mês e dicas da IA. O coach IA abre em todas as telas.

Tudo é salvo no aparelho e copiado para o Supabase quando há internet.

## Como funciona

- `src/`: app React + Vite (PWA).
- `api/ai.ts` e `api/sync.ts`: funções da Vercel. O código delas fica em `server/api.ts`.
  - `/api/ai` chama a OpenRouter com a chave do servidor.
  - `/api/sync` grava e lê o Supabase com a chave secreta.
  - As duas exigem o código de acesso (`APP_ACCESS_CODE`), que o app pede uma vez em cada aparelho.
- `supabase/migrations/`: tabelas do banco (já aplicadas no projeto `rqvhnsjfhfqzykhwvcks`).

O navegador nunca recebe a chave da OpenRouter nem a do Supabase.

## Deploy na Vercel

1. Importe este repositório na Vercel. O framework é detectado como **Vite**; não mude o comando de build.
2. Em **Environment Variables**, cadastre as variáveis de `.env.example`: `OPENROUTER_API_KEY`, `APP_ACCESS_CODE`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. Faça o deploy. Cada push na branch `main` publica de novo.
4. No iPhone, abra o endereço no Safari, toque em Compartilhar → **Adicionar à Tela de Início**, abra pelo ícone e digite o código de acesso.

## Rodar no computador

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha.
3. `npm run dev` sobe o app e a `/api` em http://localhost:5173.
4. `npm test` roda os testes.
