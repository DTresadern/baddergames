import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPAIGNS, DEFAULT_DIFFICULTY, DIFFICULTIES } from '../src/data/campaigns.js';

test('campaigns: unique ids in the agreed order, Megacity first and available', () => {
  assert.deepEqual(CAMPAIGNS.map((c) => c.id), ['megacity', 'underbelly', 'caverns', 'infested-earth']);
  assert.equal(CAMPAIGNS[0].available, true);
  assert.ok(CAMPAIGNS.some((c) => c.available));
});

test('campaigns: available ones name exactly the four difficulties, unavailable ones have none', () => {
  for (const c of CAMPAIGNS) {
    if (c.available) assert.deepEqual(Object.keys(c.difficultyNames).sort(), [...DIFFICULTIES].sort(), c.id);
    else assert.equal(c.difficultyNames, null, c.id);
  }
  assert.ok(DIFFICULTIES.includes(DEFAULT_DIFFICULTY));
  assert.equal(CAMPAIGNS[0].difficultyNames[DEFAULT_DIFFICULTY], 'Inmate');
});

test('campaigns: the data is deeply frozen', () => {
  const frozen = (v) => Object.isFrozen(v) && Object.values(v).every((x) => x === null || typeof x !== 'object' || frozen(x));
  assert.ok(frozen(CAMPAIGNS));
  assert.ok(Object.isFrozen(DIFFICULTIES));
});
