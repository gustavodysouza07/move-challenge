import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const auth = await readFile(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8')
const browserClient = await readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const productionMigration = await readFile(new URL('../supabase/migrations/002_production_completion.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/004_seed_initial_season_and_avatar.sql', import.meta.url), 'utf8')
const activityMigration = await readFile(new URL('../supabase/migrations/005_allow_activity_during_registration_season.sql', import.meta.url), 'utf8')
const validationMigration = await readFile(new URL('../supabase/migrations/006_ensure_activity_type_validation.sql', import.meta.url), 'utf8')
const timestampMigration = await readFile(new URL('../supabase/migrations/007_fix_activity_start_timestamp.sql', import.meta.url), 'utf8')
const activityWorkflowMigration = await readFile(new URL('../supabase/migrations/008_complete_activity_workflow.sql', import.meta.url), 'utf8')

test('authenticated and unauthenticated states are guarded by the auth context', () => {
  assert.match(source, /if \(loading\) return <LoadingScreen \/>/)
  assert.match(source, /if \(!user\) return <AuthScreen/)
  assert.match(auth, /supabase\.auth\.signOut\(\)/)
})

test('activity registration is server-validated for active season and participation', () => {
  assert.match(validationMigration, /create or replace function public\.validate_activity_type\(p_activity_type text\)/)
  assert.match(validationMigration, /Caminhada leve.*Corrida/s)
  assert.match(activityMigration, /public\.validate_activity_type\(p_activity_type\)/)
  assert.match(migration, /'registration'/)
  assert.match(activityMigration, /status in \('registration', 'active'\)/)
  assert.match(activityMigration, /current_date between start_date and end_date/)
  assert.match(activityMigration, /status = 'active'/)
  assert.match(schema, /season_participants where season_id = current_season\.id and user_id = auth\.uid\(\) and status = 'active'/)
  assert.match(source, /no active season/)
  assert.match(source, /active participation required/)
})

test('participation follows registration, pending payment, and administrative activation', () => {
  assert.match(source, /\.eq\('status', 'registration'\)/)
  assert.match(source, /request_season_participation/)
  assert.match(schema, /values \(target_season\.id, auth\.uid\(\), 'pending_payment'\)/)
  assert.match(schema, /if not public\.is_admin\(\) then raise exception 'admin access required'/)
  assert.match(schema, /set status = 'active', approved_at = now\(\)/)
  assert.match(source, /payment_status: 'submitted'/)
  assert.match(source, /Pagamento enviado\. Aguardando aprovação\./)
  assert.match(productionMigration, /create or replace function public\.submit_payment_proof/)
})

test('PIX enrollment exposes the configured season payment details', () => {
  assert.match(source, /season\.name/)
  assert.match(source, /season\.start_date.*season\.end_date/s)
  assert.match(source, /Copiar chave PIX/)
  assert.match(source, /Já fiz o PIX/)
  assert.match(source, /submit_payment_proof/)
  assert.match(source, /Nenhuma temporada disponível no momento\./)
})

test('header uses the real season and the register action has no demo season', () => {
  assert.doesNotMatch(source, /Temporada (03|3)/)
  assert.match(source, /setCurrentSeason\(/)
  assert.match(source, /season\.start_date <= today && season\.end_date >= today/)
  assert.match(source, /season\.status === 'registration' && season\.start_date > today/)
  assert.match(source, /season\.start_date > today/)
})

test('avatar update stays scoped to the authenticated profile', () => {
  assert.match(migration, /add column if not exists avatar_emoji text default/)
  assert.match(auth, /avatarEmoji !== undefined/)
  assert.match(auth, /\.eq\('id', session\.user\.id\)/)
  assert.match(schema, /participants edit allowed profile fields.*on public\.profiles for update/s)
  assert.match(source, /avatar-button.*profile\?\.avatar_emoji/s)
  assert.match(source, /profile-avatar.*profile\?\.avatar_emoji/s)
})

test('profile actions include menu, emoji choices, logout, and outside-click close', () => {
  assert.match(auth, /role="menu"/)
  assert.match(auth, /Editar perfil/)
  assert.match(auth, /Trocar emoji/)
  assert.match(auth, />Sair<\/button>/)
  assert.match(auth, /document\.addEventListener\('mousedown'/)
  assert.match(auth, /profileEmojis = \[/)
  assert.match(auth, /selectedEmoji === emoji/)
  assert.match(auth, /Salvar/)
  assert.match(auth, /updateProfile\(\{ avatarEmoji: selectedEmoji \}\)/)
})

test('activity start uses a server timestamp accepted by the check constraint', () => {
  assert.match(timestampMigration, /values \(auth\.uid\(\), current_season\.id, trim\(p_activity_type\), now\(\), 'active'/)
  assert.match(timestampMigration, /public\.validate_activity_type\(p_activity_type\)/)
  assert.match(timestampMigration, /an active activity session already exists/)
  assert.match(timestampMigration, /'started'/)
  assert.doesNotMatch(timestampMigration, /clock_timestamp\(\).*'active'/)
})

test('activity workflow requires secure pause, resume, finish, and proof submission RPCs', () => {
  assert.match(activityWorkflowMigration, /create or replace function public\.pause_activity_session\(p_session_id uuid\)/)
  assert.match(activityWorkflowMigration, /create or replace function public\.resume_activity_session\(p_session_id uuid\)/)
  assert.match(activityWorkflowMigration, /create or replace function public\.finish_activity_session\(p_session_id uuid\)/)
  assert.match(activityWorkflowMigration, /submit_activity_session_with_proof/)
  assert.match(activityWorkflowMigration, /activity-proofs/)
  assert.match(activityWorkflowMigration, /activity proof is required/)
  assert.match(activityWorkflowMigration, /an active activity session already exists/)
  assert.match(activityWorkflowMigration, /status = 'pending_validation'/)
})

test('history and activity proof UI are present', () => {
  assert.match(source, /Minhas atividades/)
  assert.match(source, /activity_proofs\(storage_path\)/)
  assert.match(source, /Comprovante da atividade/)
  assert.match(source, /Pré-visualização do comprovante/)
  assert.match(source, /submit_activity_session_with_proof/)
})

test('browser configuration never accepts a service role key', () => {
  assert.doesNotMatch(browserClient, /VITE_[A-Z0-9_]*SERVICE_ROLE|serviceRoleKey/i)
  assert.match(browserClient, /VITE_SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_ANON_KEY/)
})