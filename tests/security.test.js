import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const schema = await readFile(new URL('../supabase/migrations/002_production_completion.sql', import.meta.url), 'utf8')

test('administrative RPCs enforce admin authorization', () => {
  for (const functionName of ['admin_upsert_season', 'admin_upsert_challenge', 'admin_upsert_season_prize', 'admin_set_profile_status']) {
    const start = schema.indexOf(`function public.${functionName}`)
    const end = schema.indexOf('$$;', start)
    assert.match(schema.slice(start, end), /not public\.is_admin\(\)/)
  }
})

test('migration keeps payment proofs private and participant progress scoped', () => {
  assert.match(schema, /participants view own challenge progress/)
  assert.match(schema, /user_id = auth\.uid\(\) or public\.is_admin\(\)/)
  assert.match(schema, /admins manage season prizes/)
})

test('activity constraints and effective duration are server-side', () => {
  assert.match(schema, /started_at > clock_timestamp\(\)/)
  assert.match(schema, /extract\(epoch from \(clock_timestamp\(\) - started_at\)\) > 86400/)
  assert.match(schema, /effective_duration_seconds integer generated always as/)
  assert.match(schema, /on conflict \(activity_session_id\) do nothing/)
})
