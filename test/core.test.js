import { test } from 'node:test';
import assert from 'node:assert/strict';

import { expandInterval, parseDuration } from '../src/index.js';

// parseDuration -----------------------------------------------------------

test('parseDuration handles the fixed-length units', () => {
  assert.equal(parseDuration('PT1H'), 60 * 60 * 1000);
  assert.equal(parseDuration('PT30M'), 30 * 60 * 1000);
  assert.equal(parseDuration('PT45S'), 45 * 1000);
  assert.equal(parseDuration('P1D'), 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('P1W'), 7 * 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('P1DT2H3M4S'), ((24 * 60 + 2 * 60 + 3) * 60 + 4) * 1000);
});

test('parseDuration rejects calendar-dependent units', () => {
  // Years and months vary in length, so we refuse them rather than guess.
  assert.throws(() => parseDuration('P1Y'), RangeError);
  assert.throws(() => parseDuration('P1M'), RangeError);
});

test('parseDuration rejects malformed input', () => {
  assert.throws(() => parseDuration(''), TypeError);
  assert.throws(() => parseDuration('1H'), RangeError);
  assert.throws(() => parseDuration('P'), RangeError);
  assert.throws(() => parseDuration('PT'), RangeError);
  assert.throws(() => parseDuration('P1H'), RangeError); // H belongs after T
  assert.throws(() => parseDuration('PT1D'), RangeError); // D belongs before T
});

// expandInterval: duration form ------------------------------------------

test('expandInterval with a duration and a repeat count', () => {
  const result = expandInterval('R3/2023-01-01T00:00:00Z/PT1H');
  assert.deepEqual(result, [
    { start: '2023-01-01T00:00:00.000Z', end: '2023-01-01T01:00:00.000Z' },
    { start: '2023-01-01T01:00:00.000Z', end: '2023-01-01T02:00:00.000Z' },
    { start: '2023-01-01T02:00:00.000Z', end: '2023-01-01T03:00:00.000Z' },
  ]);
});

test('expandInterval with a duration and no repeat count is bounded by maxIterations', () => {
  const result = expandInterval('R/2023-01-01T00:00:00Z/P1D', { maxIterations: 2 });
  assert.deepEqual(result, [
    { start: '2023-01-01T00:00:00.000Z', end: '2023-01-02T00:00:00.000Z' },
    { start: '2023-01-02T00:00:00.000Z', end: '2023-01-03T00:00:00.000Z' },
  ]);
});

test('expandInterval with a repeat count of zero yields no intervals', () => {
  assert.deepEqual(expandInterval('R0/2023-01-01T00:00:00Z/PT1H'), []);
});

// expandInterval: end form -------------------------------------------------

test('expandInterval with an explicit end repeats the same gap', () => {
  const result = expandInterval('R2/2023-01-01T00:00:00Z/2023-01-01T01:00:00Z');
  assert.deepEqual(result, [
    { start: '2023-01-01T00:00:00.000Z', end: '2023-01-01T01:00:00.000Z' },
    { start: '2023-01-01T01:00:00.000Z', end: '2023-01-01T02:00:00.000Z' },
  ]);
});

test('expandInterval with an explicit end and no repeat count is bounded by maxIterations', () => {
  const result = expandInterval('R/2023-01-01T00:00:00Z/2023-01-01T01:00:00Z', { maxIterations: 3 });
  assert.equal(result.length, 3);
  assert.deepEqual(result[2], {
    start: '2023-01-01T02:00:00.000Z',
    end: '2023-01-01T03:00:00.000Z',
  });
});

// Time zones and offsets ---------------------------------------------------

test('expandInterval normalises offsets to UTC', () => {
  const result = expandInterval('R1/2023-01-01T01:00:00+01:00/PT1H');
  assert.deepEqual(result, [
    { start: '2023-01-01T00:00:00.000Z', end: '2023-01-01T01:00:00.000Z' },
  ]);
});

test('expandInterval treats a date-time with no zone as UTC', () => {
  const result = expandInterval('R1/2023-01-01T00:00:00/PT1H');
  assert.deepEqual(result, [
    { start: '2023-01-01T00:00:00.000Z', end: '2023-01-01T01:00:00.000Z' },
  ]);
});

// Edge cases and errors ----------------------------------------------------

test('expandInterval rejects an end that precedes the start', () => {
  assert.throws(
    () => expandInterval('R1/2023-01-02T00:00:00Z/2023-01-01T00:00:00Z'),
    RangeError,
  );
});

test('expandInterval rejects invalid calendar dates', () => {
  assert.throws(() => expandInterval('R1/2023-02-29T00:00:00Z/PT1H'), RangeError);
  assert.throws(() => expandInterval('R1/2023-04-31T00:00:00Z/PT1H'), RangeError);
});

test('expandInterval rejects malformed interval strings', () => {
  assert.throws(() => expandInterval(''), TypeError);
  assert.throws(() => expandInterval('2023-01-01T00:00:00Z/PT1H'), RangeError);
  assert.throws(() => expandInterval('R1/2023-01-01T00:00:00Z'), RangeError);
  assert.throws(() => expandInterval('RX/2023-01-01T00:00:00Z/PT1H'), RangeError);
});

test('expandInterval rejects a negative maxIterations', () => {
  assert.throws(
    () => expandInterval('R1/2023-01-01T00:00:00Z/PT1H', { maxIterations: -1 }),
    RangeError,
  );
});

test('expandInterval caps an explicit count at maxIterations', () => {
  const result = expandInterval('R5/2023-01-01T00:00:00Z/PT1H', { maxIterations: 2 });
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], {
    start: '2023-01-01T01:00:00.000Z',
    end: '2023-01-01T02:00:00.000Z',
  });
});

test('expandInterval handles fractional seconds', () => {
  // Durations are integer-only, so a fractional duration is rejected.
  assert.throws(() => expandInterval('R1/2023-01-01T00:00:00.500Z/PT0.5S'), RangeError);
  const ok = expandInterval('R1/2023-01-01T00:00:00.500Z/PT1S');
  assert.deepEqual(ok, [
    { start: '2023-01-01T00:00:00.500Z', end: '2023-01-01T00:00:01.500Z' },
  ]);
});
