// Core logic for expanding ISO 8601 repeating intervals into concrete intervals.
//
// The syntax we support is the ISO 8601 repeating interval form:
//
//   R[n]/<start>/<duration>
//   R[n]/<start>/<end>
//
// where <start> and <end> are ISO 8601 date-times (with or without a time zone),
// and <duration> is an ISO 8601 duration such as P1D or PT1H30M.
//
// We deliberately do NOT support the "R/" form with an implicit start, nor the
// "R[n]/<duration>/<end>" form. Supporting those would require either a clock or
// a rule for back-counting, and both introduce ambiguity that we would rather
// leave out. Callers who need them can compute the start themselves.
//
// Time zones: we accept a trailing 'Z' and offsets of the form +HH:MM and -HH:MM.
// Everything is normalised to UTC milliseconds internally. A date-time with no
// zone is treated as UTC. This is a single, stated interpretation; it is not
// locale-aware and does not consult the host time zone.

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// ISO 8601 durations use these designators. Years and months are deliberately
// rejected: they are calendar-dependent and would make the expansion
// non-deterministic without a calendar library. Days and below are fixed-length.
const DURATION_UNITS = {
  W: 7 * MS_PER_DAY,
  D: MS_PER_DAY,
  H: MS_PER_HOUR,
  M: MS_PER_MINUTE,
  S: MS_PER_SECOND,
};

/**
 * Parse an ISO 8601 duration into milliseconds.
 *
 * Only the fixed-length units are accepted: weeks, days, hours, minutes,
 * seconds. Years and months are rejected because their length depends on the
 * calendar, and this library has no calendar. Throwing here is better than
 * silently guessing.
 *
 * @param {string} text
 * @returns {number} duration in milliseconds
 */
export function parseDuration(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('duration must be a non-empty string');
  }

  const match = /^P(?:([0-9]+)W)?(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?)?$/.exec(text);
  if (!match) {
    throw new RangeError(`unsupported duration: ${text}`);
  }

  const [, weeks, days, hours, minutes, seconds] = match;
  if (weeks === undefined && days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    throw new RangeError(`duration has no components: ${text}`);
  }

  let total = 0;
  if (weeks !== undefined) total += Number(weeks) * DURATION_UNITS.W;
  if (days !== undefined) total += Number(days) * DURATION_UNITS.D;
  if (hours !== undefined) total += Number(hours) * DURATION_UNITS.H;
  if (minutes !== undefined) total += Number(minutes) * DURATION_UNITS.M;
  if (seconds !== undefined) total += Number(seconds) * DURATION_UNITS.S;

  if (!Number.isFinite(total) || total < 0) {
    throw new RangeError(`duration out of range: ${text}`);
  }
  return total;
}

/**
 * Parse an ISO 8601 date-time into milliseconds since the Unix epoch (UTC).
 *
 * Accepted forms:
 *   YYYY-MM-DD
 *   YYYY-MM-DDTHH:MM
 *   YYYY-MM-DDTHH:MM:SS
 *   YYYY-MM-DDTHH:MM:SS.sss
 * each optionally followed by 'Z' or +HH:MM / -HH:MM.
 *
 * A date-time with no zone is treated as UTC. This is a documented choice,
 * not an accident: it keeps expansion deterministic across hosts.
 *
 * @param {string} text
 * @returns {number} milliseconds since the Unix epoch
 */
function parseDateTime(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('date-time must be a non-empty string');
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match) {
    throw new RangeError(`unsupported date-time: ${text}`);
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, fracStr, zoneStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = hourStr === undefined ? 0 : Number(hourStr);
  const minute = minuteStr === undefined ? 0 : Number(minuteStr);
  const second = secondStr === undefined ? 0 : Number(secondStr);
  // Fractional seconds are truncated to milliseconds. The regex allows up to
  // nine digits so callers can pass nanosecond timestamps and still get a
  // sensible, deterministic answer.
  const millisecond = fracStr === undefined ? 0 : Number(fracStr.padEnd(3, '0').slice(0, 3));

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`invalid calendar date: ${text}`);
  }
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`invalid time of day: ${text}`);
  }

  // Date.UTC rolls over out-of-range days (e.g. Feb 30 becomes Mar 2). We want
  // to reject those, so we build the timestamp and then check that the
  // components round-trip. This catches 2023-02-29 and 2023-04-31.
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`invalid calendar date: ${text}`);
  }

  let offsetMinutes = 0;
  if (zoneStr !== undefined && zoneStr !== 'Z') {
    const sign = zoneStr[0] === '-' ? -1 : 1;
    const zoneHour = Number(zoneStr.slice(1, 3));
    const zoneMinute = Number(zoneStr.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) {
      throw new RangeError(`invalid zone offset: ${text}`);
    }
    offsetMinutes = sign * (zoneHour * 60 + zoneMinute);
  }

  return utcMs - offsetMinutes * MS_PER_MINUTE;
}

/**
 * Format milliseconds since the Unix epoch as an ISO 8601 UTC string.
 *
 * Always emits the 'Z' suffix and always includes milliseconds, so the output
 * is unambiguous and round-trippable by parseDateTime.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDateTime(ms) {
  const date = new Date(ms);
  const pad = (n, width) => String(n).padStart(width, '0');
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.` +
    `${pad(date.getUTCMilliseconds(), 3)}Z`
  );
}

/**
 * Expand an ISO 8601 repeating interval into a bounded list of concrete
 * intervals.
 *
 * Supported input forms:
 *   R[n]/<start>/<duration>
 *   R[n]/<start>/<end>
 *   R/<start>/<duration>   (unbounded repeat count; requires maxIterations)
 *   R/<start>/<end>        (unbounded repeat count; requires maxIterations)
 *
 * For the duration form, each interval starts where the previous one ended and
 * lasts for the parsed duration. For the end form, the start is repeated with
 * the same gap between start and end. In both forms the expansion stops after
 * `count` intervals, or after `maxIterations` if `count` is omitted. The
 * `maxIterations` guard exists so an unbounded 'R/' cannot loop forever.
 *
 * Each returned interval is an object of the form:
 *   { start: string, end: string }
 * with both fields formatted as ISO 8601 UTC strings.
 *
 * @param {string} text
 * @param {{ maxIterations?: number }} [options]
 * @returns {Array<{start: string, end: string}>}
 */
export function expandInterval(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new TypeError('interval must be a non-empty string');
  }

  const maxIterations = options.maxIterations === undefined ? 1000 : options.maxIterations;
  if (!Number.isInteger(maxIterations) || maxIterations < 0) {
    throw new RangeError('maxIterations must be a non-negative integer');
  }

  const parts = text.split('/');
  if (parts.length !== 3 || !parts[0].startsWith('R')) {
    throw new RangeError(`unsupported interval: ${text}`);
  }

  const repeatPart = parts[0].slice(1);
  let count;
  if (repeatPart === '') {
    count = null; // unbounded; bounded by maxIterations
  } else if (/^\d+$/.test(repeatPart)) {
    count = Number(repeatPart);
  } else {
    throw new RangeError(`invalid repeat count: ${parts[0]}`);
  }

  const startMs = parseDateTime(parts[1]);
  const third = parts[2];

  // Decide whether the third component is a duration or an end date-time.
  // Durations always start with 'P'; date-times never do. This is the one
  // unambiguous discriminator in the grammar.
  let durationMs;
  let endMs;
  if (third.startsWith('P')) {
    durationMs = parseDuration(third);
    endMs = startMs + durationMs;
  } else {
    endMs = parseDateTime(third);
    durationMs = endMs - startMs;
    if (durationMs < 0) {
      throw new RangeError(`end precedes start: ${text}`);
    }
  }

  const limit = count === null ? maxIterations : Math.min(count, maxIterations);
  const intervals = [];
  for (let i = 0; i < limit; i += 1) {
    const start = startMs + i * durationMs;
    const end = start + durationMs;
    intervals.push({ start: formatDateTime(start), end: formatDateTime(end) });
  }
  return intervals;
}
