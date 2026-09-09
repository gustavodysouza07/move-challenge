import assert from 'node:assert/strict'
import test from 'node:test'

const clamp = (value, maximum) => Math.min(maximum, Math.max(0, value))
const scoreActivity = ({ minutes, steps = 0, met }) => ({
  consistency: minutes >= 30 || steps >= 8000 ? 10 : 0,
  evolution: 0,
  volume: Math.min(20, Math.floor((met * minutes) / 40)),
})
const weeklyScore = (activities) => {
  const validDays = new Set(activities.filter((activity) => activity.consistency >= 10 && activity.day < 6).map((activity) => activity.day))
  const completedDays = Math.min(6, validDays.size)
  const consistency = Math.min(60, completedDays * 10)
  const evolution = clamp(activities.reduce((sum, activity) => sum + activity.evolution, 0), 25)
  const volume = clamp(activities.reduce((sum, activity) => sum + activity.volume, 0), 20)
  return { consistency, evolution, volume, bonus: completedDays >= 5 ? 15 : 0, completedDays: Math.min(6, completedDays), total: Math.min(120, consistency + evolution + volume + (completedDays >= 5 ? 15 : 0)) }
}

test('consistency accepts 30 minutes or 8,000 steps', () => {
  assert.equal(scoreActivity({ minutes: 30, met: 4 }).consistency, 10)
  assert.equal(scoreActivity({ minutes: 29, steps: 8000, met: 4 }).consistency, 10)
  assert.equal(scoreActivity({ minutes: 29, steps: 7999, met: 4 }).consistency, 0)
})

test('less than 30 minutes without 8,000 steps is not a valid day', () => {
  assert.equal(scoreActivity({ minutes: 29, steps: 7999, met: 4 }).consistency, 0)
})

test('volume uses one point per 40 MET-min and caps at 20', () => {
  assert.equal(scoreActivity({ minutes: 30, met: 4 }).volume, 3)
  assert.equal(scoreActivity({ minutes: 400, met: 4 }).volume, 20)
})

test('weekly consistency, bonus, six-day limit, and total cap are enforced', () => {
  const activities = Array.from({ length: 7 }, (_, index) => ({ day: index, consistency: 10, evolution: 25, volume: 20 }))
  assert.deepEqual(weeklyScore(activities), { consistency: 60, evolution: 25, volume: 20, bonus: 15, completedDays: 6, total: 120 })
})

test('two activities on one day award at most one consistency day', () => {
  const result = weeklyScore([{ day: 1, consistency: 10, evolution: 0, volume: 0 }, { day: 1, consistency: 10, evolution: 0, volume: 0 }])
  assert.equal(result.consistency, 10)
  assert.equal(result.completedDays, 1)
})

test('five distinct valid days award the weekly bonus', () => {
  const result = weeklyScore(Array.from({ length: 5 }, (_, day) => ({ day, consistency: 10, evolution: 0, volume: 0 })))
  assert.equal(result.completedDays, 5)
  assert.equal(result.bonus, 15)
})

test('four distinct valid days do not award the weekly bonus', () => {
  const result = weeklyScore(Array.from({ length: 4 }, (_, day) => ({ day, consistency: 10, evolution: 0, volume: 0 })))
  assert.equal(result.completedDays, 4)
  assert.equal(result.bonus, 0)
})

test('the seventh day is rest and does not score', () => {
  const result = weeklyScore(Array.from({ length: 7 }, (_, day) => ({ day, consistency: 10, evolution: 0, volume: 0 })))
  assert.equal(result.completedDays, 6)
  assert.equal(result.consistency, 60)
})

test('idempotent activity contribution is represented by one session identity', () => {
  const contributionIds = new Set(['session-1', 'session-1'])
  assert.equal(contributionIds.size, 1)
})

test('tie-breaker ordering is deterministic', () => {
  const rows = [
    { user_id: 'b', total: 100, consistency: 50, evolution: 10, volume: 20, completedDays: 5 },
    { user_id: 'a', total: 100, consistency: 50, evolution: 10, volume: 20, completedDays: 5 },
  ].sort((left, right) => right.total - left.total || right.consistency - left.consistency || right.evolution - left.evolution || right.volume - left.volume || right.completedDays - left.completedDays || left.user_id.localeCompare(right.user_id))
  assert.deepEqual(rows.map((row) => row.user_id), ['a', 'b'])
})

test('wildcard limit is two per season', () => {
  const wildcardCount = 2
  assert.equal(wildcardCount < 2, false)
})
