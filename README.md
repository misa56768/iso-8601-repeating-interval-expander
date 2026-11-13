# iso-8601-repeating-interval-expander

Expands the repeating-interval syntax of ISO 8601 into a bounded list of concrete datetime intervals.

## Usage

```js
import { expandInterval, parseDuration } from 'iso-8601-repeating-interval-expander';

const intervals = expandInterval('R3/2023-01-01T00:00:00Z/PT1H');
// [
//   { start: '2023-01-01T00:00:00.000Z', end: '2023-01-01T01:00:00.000Z' },
//   { start: '2023-01-01T01:00:00.000Z', end: '2023-01-01T02:00:00.000Z' },
//   { start: '2023-01-01T02:00:00.000Z', end: '2023-01-01T03:00:00.000Z' },
// ]

parseDuration('P1DT2H'); // 93600000
```

The two exported names are `expandInterval` and `parseDuration`. `expandInterval` takes an interval string and an optional `{ maxIterations }` option, and returns an array of `{ start, end }` objects whose fields are ISO 8601 UTC strings. `parseDuration` takes an ISO 8601 duration string and returns milliseconds.

## Why this exists

ISO 8601 repeating intervals are compact and expressive, but most consumers need a concrete list of start/end pairs before they can do anything with them. The trade-off this library makes is to reject the calendar-dependent duration units (years and months) instead of guessing at their length. A year is not always 365 days and a month is not always 30, so expanding `P1M` would either need a calendar or a lie. We choose the lie-free option: `P1Y` and `P1M` throw, and callers who need them can expand those themselves with a rule they control.

A second deliberate choice: a date-time with no time-zone suffix is treated as UTC. This keeps expansion deterministic regardless of the host's local zone.

## The awkward edge

An unbounded repeat (`R/...`) has no natural end. We require a `maxIterations` option to bound it, defaulting to 1000. If you pass a finite count that exceeds `maxIterations`, the count is capped at `maxIterations` rather than silently ignored. This is the one place where the library will give you fewer intervals than you asked for, and it does so loudly enough to notice in the return value.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

