/**
 * The pure half of `get_day_plan` and `find_booking`: what a voice guide may
 * read of a day and of a booking, and nothing it may not say aloud. Every
 * value a traveller wrote (a booking's notes, a day note, a stop's notes) goes
 * through `speakable` before it leaves, and the structured fields that carry a
 * booking reference, a price or the travellers are never read at all.
 */

/** A day of the trip as the day plan reads it. */
export interface PlanDay {
  id: number;
  date: string | null;
  day_number: number | null;
  title?: string | null;
  notes?: string | null;
}

/** A planned place on a day. */
export interface PlanAssignment {
  order_index: number | null;
  notes: string | null;
  assignment_time: string | null;
  assignment_end_time: string | null;
  accommodation_id?: number | null;
  place: { name: string | null; address: string | null; place_time?: string | null; end_time?: string | null };
}

/** A note on a day. */
export interface PlanNote {
  text: string | null;
  time: string | null;
}

/** A stay: where the trip sleeps from one day to another. */
export interface PlanStay {
  start_day_id: number | null;
  end_day_id: number | null;
  check_in: string | null;
  check_out: string | null;
  place_name: string | null;
  place_address: string | null;
}

/** A booking's endpoint: a station, an airport, a port of a cruise. */
export interface PlanEndpoint {
  role: string;
  sequence: number;
  name: string;
  local_time: string | null;
  local_date: string | null;
}

/** A booking as both tools read it, before anything is said of it. */
export interface PlanBooking {
  title: string;
  type: string;
  status: string | null;
  day_id: number | null;
  end_day_id: number | null;
  reservation_time: string | null;
  reservation_end_time: string | null;
  location: string | null;
  notes: string | null;
  place_name: string | null;
  accommodation_id: number | null;
  endpoints: PlanEndpoint[];
}

/**
 * A sentence that holds any of these is dropped whole: money (a currency
 * symbol or code, a payment or refund term), a booking reference or the words
 * that introduce one, a cabin number, and any run of six digits or more (a
 * ticket, card, reference or phone number), and a masked card number.
 */
const UNSPEAKABLE =
  /[£$€¥]|\b(?:CHF|USD|GBP|EUR)\b|refundable|prepaid|paid\b|booking number|stateroom|\d{6,}|confirmation|\bPNR\b|\bref(?:erence)?\b|[•*]{2,}\s*\d/i;

const URL_PATTERN = /\bhttps?:\/\/\S+/gi;

/** A section label led by a symbol, such as "🎟️ Entry:" or "📍 Meeting point:", kept in front of what survives of its line. */
const LINE_LABEL = /^[^\p{L}\p{N}\s]+\s*([\p{L}][\p{L} ]{0,24}):\s+/u;

function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=\S)/).filter((s) => s.trim() !== '');
}

/**
 * What of a traveller's text may be said aloud: links removed, every sentence
 * that names money, a reference, a cabin or a long number dropped, the rest
 * joined on one line. Null when nothing is left.
 */
export function speakable(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines: string[] = [];
  for (const raw of text.replace(URL_PATTERN, '').split(/\n+/)) {
    let line = raw.replace(/[ \t]{2,}/g, ' ').trim();
    if (line === '') continue;
    const label = LINE_LABEL.exec(line);
    if (label) line = line.slice(label[0].length);
    const kept = sentencesOf(line)
      .map((s) => s.trim())
      // A label left bare once its link was removed ("Gmail:") says nothing.
      .filter((s) => !UNSPEAKABLE.test(s) && /[\p{L}\p{N}]/u.test(s) && !/^[\p{L} ]{1,24}:$/u.test(s));
    if (kept.length === 0) continue;
    lines.push(label ? `${label[1].trim()}: ${kept.join(' ')}` : kept.join(' '));
  }
  return lines.length > 0 ? lines.join(' ') : null;
}

/** A day note kept only for the people who check the plan, never for the traveller. */
export function isAdminNote(text: string | null | undefined): boolean {
  return /^\s*last checked/i.test(text ?? '');
}

/** The clock time of a stored time or date-time, `HH:MM`, or null. */
export function clockOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /(?:^|T)(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** The calendar date of a stored date-time, `YYYY-MM-DD`, or null. */
export function dateOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Minutes from one wall-clock time to another on the same date; null across dates or past a day. */
export function minutesBetween(start: string | null, end: string | null): number | null {
  const startDate = dateOf(start);
  const startClock = clockOf(start);
  const endClock = clockOf(end);
  if (!startDate || !startClock || !endClock || dateOf(end) !== startDate) return null;
  const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const minutes = toMinutes(endClock) - toMinutes(startClock);
  return minutes > 0 ? minutes : null;
}

const TRANSPORT_TYPES = new Set([
  'flight',
  'train',
  'bus',
  'car',
  'taxi',
  'bicycle',
  'cruise',
  'ferry',
  'transit',
  'transport_other',
]);

/** Whether a booking may be read at all: not cancelled, and not an `other` booking (insurance and the like). */
export function isReadable(booking: Pick<PlanBooking, 'type' | 'status'>): boolean {
  return booking.type !== 'other' && booking.status !== 'cancelled';
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, v] of Object.entries(value) as [keyof T, T[keyof T]][]) {
    if (v !== null && v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

function ends(booking: PlanBooking, role: 'from' | 'to'): string | null {
  const named = booking.endpoints.filter((e) => e.role === role).sort((a, b) => a.sequence - b.sequence);
  const endpoint = role === 'from' ? named[0] : named[named.length - 1];
  return endpoint?.name ?? null;
}

/**
 * A booking as it is spoken on a day or in a search: its kind, its times,
 * where it is (or, for a ride, where it runs from and to) and its notes.
 * `on` is the date it is read for; a booking that runs over several days
 * starts on one and ends on another, and only what happens on that date is
 * given a time.
 */
export function spokenBooking(booking: PlanBooking, on: { starts: boolean; ends: boolean }) {
  const transport = TRANSPORT_TYPES.has(booking.type);
  return compact({
    title: booking.title,
    kind: booking.type,
    starts: on.starts ? clockOf(booking.reservation_time) : null,
    ends: on.ends ? clockOf(booking.reservation_end_time) : null,
    minutes: transport ? null : minutesBetween(booking.reservation_time, booking.reservation_end_time),
    where: transport ? null : (booking.location ?? booking.place_name),
    from: transport ? ends(booking, 'from') : null,
    to: transport ? ends(booking, 'to') : null,
    notes: speakable(booking.notes),
  });
}

/** The ports of a cruise on one date: where it lies, and the times set for that stop. */
export function cruiseStops(booking: PlanBooking, date: string) {
  return booking.endpoints
    .filter((e) => e.local_date === date)
    .sort((a, b) => a.sequence - b.sequence)
    .map((e) => {
      const time = clockOf(e.local_time);
      if (e.role === 'from') return compact({ port: e.name, embark: true, departs: time });
      if (e.role === 'to') return compact({ port: e.name, disembark: true, arrives: time });
      return compact({ port: e.name, time });
    });
}

/** A stay as the night's hotel: its name and address, and when it checks in and out. */
export function spokenStay(stay: PlanStay, dates: ReadonlyMap<number, string>) {
  return compact({
    name: stay.place_name,
    address: stay.place_address,
    check_in_date: stay.start_day_id != null ? (dates.get(stay.start_day_id) ?? null) : null,
    check_in: clockOf(stay.check_in) ?? stay.check_in,
    check_out_date: stay.end_day_id != null ? (dates.get(stay.end_day_id) ?? null) : null,
    check_out: clockOf(stay.check_out) ?? stay.check_out,
  });
}

/** A planned place: its time, its name and address, and the notes on its visit. */
export function spokenAssignment(assignment: PlanAssignment) {
  return compact({
    time: clockOf(assignment.assignment_time ?? assignment.place.place_time ?? null),
    until: clockOf(assignment.assignment_end_time ?? assignment.place.end_time ?? null),
    place: assignment.place.name,
    address: assignment.place.address,
    notes: speakable(assignment.notes),
  });
}

/** A day note as one line, its time in front when it has one; null for an admin note or one with nothing left. */
export function spokenNote(note: PlanNote): string | null {
  if (isAdminNote(note.text)) return null;
  const text = speakable(note.text);
  if (!text) return null;
  const time = clockOf(note.time);
  return time ? `${time} ${text}` : text;
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'of',
  'my',
  'our',
  'on',
  'at',
  'in',
  'for',
  'and',
  'booking',
  'reservation',
  'when',
  'is',
  'what',
  'time',
]);

function normalised(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a search worth matching: lower case, without accents and without the small words of a question. */
export function queryWords(query: string): string[] {
  const words = normalised(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** How many of the words a booking's title or kind holds. */
export function matchScore(words: readonly string[], booking: Pick<PlanBooking, 'title' | 'type'>): number {
  const haystack = normalised(`${booking.title} ${booking.type}`);
  return words.filter((w) => haystack.includes(w)).length;
}

/**
 * The order a search answers in: the bookings still to come, soonest first,
 * then the ones already past, most recent first, then any without a date.
 */
export function soonestFirst<T extends { date: string | null }>(items: readonly T[], today: string): T[] {
  const upcoming = items.filter((i) => i.date !== null && i.date >= today);
  const past = items.filter((i) => i.date !== null && i.date < today);
  const undated = items.filter((i) => i.date === null);
  const byDate = (a: T, b: T) => (a.date as string).localeCompare(b.date as string);
  return [...upcoming.sort(byDate), ...past.sort((a, b) => byDate(b, a)), ...undated];
}
