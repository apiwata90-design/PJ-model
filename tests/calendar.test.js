import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTimeUtc, targetMonth, hoursUntil, monthSlugName } from '../src/core/calendar.js';

test('check time is noon New York on last day (EDT)', () => {
  assert.equal(checkTimeUtc(2026, 10).toISOString(), '2026-10-31T16:00:00.000Z');
});

test('check time in EST months is 17:00Z', () => {
  assert.equal(checkTimeUtc(2026, 11).toISOString(), '2026-11-30T17:00:00.000Z');
  assert.equal(checkTimeUtc(2027, 2).toISOString(), '2027-02-28T17:00:00.000Z');
  assert.equal(checkTimeUtc(2028, 2).toISOString(), '2028-02-29T17:00:00.000Z');
});

test('DST boundaries: March 2027 ends in EDT', () => {
  assert.equal(checkTimeUtc(2027, 3).toISOString(), '2027-03-31T16:00:00.000Z');
});

test('target month rolls over after check time', () => {
  assert.deepEqual(targetMonth(new Date('2026-10-31T15:59:59Z')), { year: 2026, month: 10 });
  assert.deepEqual(targetMonth(new Date('2026-10-31T16:00:01Z')), { year: 2026, month: 11 });
  assert.deepEqual(targetMonth(new Date('2026-12-31T18:00:00Z')), { year: 2027, month: 1 });
});

test('hoursUntil and month names', () => {
  assert.equal(hoursUntil(new Date('2026-10-31T04:00:00Z'), checkTimeUtc(2026, 10)), 12);
  assert.equal(monthSlugName(10), 'october');
  assert.equal(monthSlugName(1), 'january');
});
