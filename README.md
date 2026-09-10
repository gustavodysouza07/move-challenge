# MOVE Challenge V3

**Consistência que transforma.** Uma competição social de exercícios entre colegas, construída em React, TypeScript e Vite.

## Rodando localmente

```bash
npm install
npm run dev
```

O projeto funciona com apresentação pública quando o Supabase não está configurado. Para ativar cadastro, login, recuperação de senha e áreas privadas, copie `.env.example` para `.env.local` e informe `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. A chave usada no navegador deve ser apenas a publishable key; nunca use `service_role` no frontend.

## Arquitetura

- `src/main.tsx`: shell da aplicação, páginas e interações demo-first.
- `src/styles.css`: sistema visual responsivo, tokens e componentes de interface.
- `supabase/schema.sql`: modelo PostgreSQL, RLS, índices e funções base para integridade.
- `public/`: PWA, manifest, ícone e service worker.

O cálculo exibido no frontend é uma estimativa de UX. Com Supabase ativo, o valor oficial deve ser calculado em RPC ou Edge Function usando timestamp, baseline congelado, janela de edição, idempotência e auditoria server-side.

## Configuração do Supabase

1. Crie um projeto no Supabase e configure Authentication > URL Configuration com a URL local e a URL de produção da Vercel.
2. Execute todo o conteúdo de `supabase/schema.sql` no SQL Editor.
3. Em Authentication > Providers > Email, escolha se a confirmação de e-mail será obrigatória. Com confirmação ativa, o cadastro mostra uma mensagem e o usuário entra após confirmar o e-mail.
4. Copie `.env.example` para `.env.local` no desenvolvimento e cadastre as mesmas variáveis no projeto Vercel.
5. O primeiro administrador precisa ser promovido manualmente por um operador confiável no SQL Editor, após o cadastro: `update public.profiles set role = 'admin', status = 'active' where email = 'admin@exemplo.com';`.

A rota `/admin` exige `role = 'admin'` e `status = 'active'`. O schema habilita RLS e não permite que participantes alterem sua própria role ou status. O pagamento bancário/gateway e integrações externas de atividade permanecem fora desta etapa; o PIX manual e a validação do check-in já estão preparados.

## Check-in e validação

O check-in real usa `activity_sessions`: o início e o fim são gravados por RPC no banco, há no máximo uma sessão ativa por usuário e o cronômetro é apenas uma visualização derivada do `started_at` server-side. Ao finalizar, a sessão fica `pending_validation`; somente um admin pode validar, disparando o motor de pontuação server-side e os registros em `daily_scores` e `weekly_scores`.

O bucket privado `payment-proofs` é criado pelo schema para comprovantes PIX. Em produção, configure também as URLs do Storage conforme o ambiente e revise limites de tamanho/tipo de arquivo no painel do Supabase.

## Regras principais

Temporada de 8 semanas, com Semana 0 de onboarding e baseline. Até 6 dias pontuáveis por semana; o 7º é descanso. Meta: 30 minutos contínuos ou 8.000 passos. Consistência vale até 60 pontos, bônus semanal de 15, evolução até 25 e volume até 20, com teto de 120 pontos semanais. Cada pessoa recebe 2 coringas por temporada.

O ranking não usa peso, IMC, gordura corporal, medidas ou aparência. Dados são usados apenas para autenticação, competição e comunicação.
