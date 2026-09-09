# MOVE Challenge V3

**Consistência que transforma.** Uma competição social de exercícios entre colegas, construída em React, TypeScript e Vite.

## Rodando localmente

```bash
npm install
npm run dev
```

O projeto funciona em modo DEMO/local sem configuração externa. Para preparar o backend, copie `.env.example` para `.env.local` e informe `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

## Arquitetura

- `src/main.tsx`: shell da aplicação, páginas e interações demo-first.
- `src/styles.css`: sistema visual responsivo, tokens e componentes de interface.
- `supabase/schema.sql`: modelo PostgreSQL, RLS, índices e funções base para integridade.
- `public/`: PWA, manifest, ícone e service worker.

O cálculo exibido no frontend é uma estimativa de UX. Com Supabase ativo, o valor oficial deve ser calculado em RPC ou Edge Function usando timestamp, baseline congelado, janela de edição, idempotência e auditoria server-side.

## Regras principais

Temporada de 8 semanas, com Semana 0 de onboarding e baseline. Até 6 dias pontuáveis por semana; o 7º é descanso. Meta: 30 minutos contínuos ou 8.000 passos. Consistência vale até 60 pontos, bônus semanal de 15, evolução até 25 e volume até 20, com teto de 120 pontos semanais. Cada pessoa recebe 2 coringas por temporada.

O ranking não usa peso, IMC, gordura corporal, medidas ou aparência. Dados são usados apenas para autenticação, competição e comunicação.
