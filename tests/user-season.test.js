import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
const auth = await readFile(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8')
const browserClient = await readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/004_seed_initial_season_and_avatar.sql', import.meta.url), 'utf8')

test('authenticated and unauthenticated states are guarded by the auth context', () => {
  assert.match(source, /if \(loading\) return <LoadingScreen \/>/)
  assert.match(source, /if \(!user\) return <AuthScreen/)
  assert.match(auth, /supabase\.auth\.signOut\(\)/)
})

test('activity registration is server-validated for active season and participation', () => {
  assert.match(migration, /'registration'/)
  assert.match(schema, /status = 'active' and current_date between start_date and end_date/)
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
})

test('avatar update stays scoped to the authenticated profile', () => {
  assert.match(migration, /add column if not exists avatar_emoji text default/)
  assert.match(auth, /avatarEmoji !== undefined/)
  assert.match(auth, /\.eq\('id', session\.user\.id\)/)
  assert.match(schema, /participants edit allowed profile fields.*on public\.profiles for update/s)
})

test('profile actions include menu, emoji choices, logout, and outside-click close', () => {
  assert.match(auth, /role="menu"/)
  assert.match(auth, /Editar perfil/)
  assert.match(auth, /Trocar emoji/)
  assert.match(auth, />Sair<\/button>/)
  assert.match(auth, /document\.addEventListener\('mousedown'/)
  assert.match(auth, /profileEmojis = \[/)
})

test('browser configuration never accepts a service role key', () => {
  assert.doesNotMatch(browserClient, /VITE_[A-Z0-9_]*SERVICE_ROLE|serviceRoleKey/i)
  assert.match(browserClient, /VITE_SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_ANON_KEY/)
})