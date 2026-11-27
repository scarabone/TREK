import {
  clockOf,
  cruiseStops,
  isAdminNote,
  isReadable,
  matchScore,
  minutesBetween,
  queryWords,
  soonestFirst,
  speakable,
  spokenAssignment,
  spokenBooking,
  spokenNote,
  spokenStay,
  type PlanBooking,
} from '../../../../src/nest/trip-read-model/day-plan.helpers';

import { describe, expect, it } from 'vitest';

function booking(overrides: Partial<PlanBooking> = {}): PlanBooking {
  return {
    title: 'Windsor Castle — timed admission',
    type: 'tour',
    status: 'confirmed',
    day_id: 1,
    end_day_id: 1,
    reservation_time: '2026-12-27T10:00',
    reservation_end_time: '2026-12-27T10:30',
    location: 'Windsor Castle, Windsor SL4 1NJ',
    notes: null,
    place_name: null,
    accommodation_id: null,
    endpoints: [],
    ...overrides,
  };
}

describe('speakable', () => {
  it('DAYPLAN-001: drops every sentence that names money, a refund, a payment or a reference', () => {
    const notes =
      '2 adults, entry 10:00–10:30, £64 via Royal Collection Trust, non-refundable. Arrive no more than 10 min early.\n\n' +
      '🎟️ Entry: Phone OK (Wallet pass has the real barcode). Prepaid at booking. Booking number 8384423.';
    expect(speakable(notes)).toBe(
      'Arrive no more than 10 min early. Entry: Phone OK (Wallet pass has the real barcode).',
    );
  });

  it('DAYPLAN-002: drops currency codes, a cabin, a run of six digits and a PNR, and keeps the rest', () => {
    expect(speakable('CHF 72 for two. Then taxi to the terminal.')).toBe('Then taxi to the terminal.');
    expect(speakable('Fare 32.99 USD. Driver details in the app.')).toBe('Driver details in the app.');
    expect(speakable('B-Veranda stateroom 233. Embark from 15:00, sails 21:00 (all-aboard ~20:30).')).toBe(
      'Embark from 15:00, sails 21:00 (all-aboard ~20:30).',
    );
    expect(speakable('Tickets: Brett 117-2543938272-73. Terminal I.')).toBe('Terminal I.');
    expect(speakable('Phone 01753 855426. Lunch after the castle.')).toBe('Lunch after the castle.');
    expect(speakable('Both on one PNR. Paid in full. Gate closes 10:10.')).toBe('Gate closes 10:10.');
    expect(speakable('€40 deposit. $10 tip. Meet at the fountain.')).toBe('Meet at the fountain.');
    expect(
      speakable(
        'Uber reservation, Comfort, 4 seats. On Apple Pay Mastercard ••3715. Free cancel up to 1 hour before. Gmail: https://mail.google.com/mail/u/0/#all/1a1e4cb9',
      ),
    ).toBe('Uber reservation, Comfort, 4 seats. Free cancel up to 1 hour before.');
  });

  it('DAYPLAN-003: removes links and answers null when nothing is left to say', () => {
    expect(speakable('See https://www.rct.uk/visit for the rules. Bring passports.')).toBe(
      'See for the rules. Bring passports.',
    );
    expect(speakable('£64, non-refundable.')).toBeNull();
    expect(speakable('🎟️ Entry: Paid online.')).toBeNull();
    expect(speakable('')).toBeNull();
    expect(speakable(null)).toBeNull();
  });
});

describe('the parts of a day', () => {
  it('DAYPLAN-004: reads clock times and minutes from stored times', () => {
    expect(clockOf('2026-12-14T16:44:00-05:00')).toBe('16:44');
    expect(clockOf('15:00')).toBe('15:00');
    expect(clockOf(null)).toBeNull();
    expect(minutesBetween('2026-12-27T14:15', '2026-12-27T15:45')).toBe(90);
    expect(minutesBetween('2026-12-17T21:00', '2026-12-24T08:00')).toBeNull();
    expect(minutesBetween('2026-12-27T10:00', null)).toBeNull();
  });

  it('DAYPLAN-005: refuses an `other` or cancelled booking and keeps the rest', () => {
    expect(isReadable({ type: 'other', status: 'confirmed' })).toBe(false);
    expect(isReadable({ type: 'tour', status: 'cancelled' })).toBe(false);
    expect(isReadable({ type: 'tour', status: 'pending' })).toBe(true);
  });

  it('DAYPLAN-006: speaks a booking with its place and length and a ride with its ends, never a reference', () => {
    const tour = spokenBooking(booking({ notes: 'Arrive 09:55. Booking number 8384423.' }), {
      starts: true,
      ends: true,
    });
    expect(tour).toEqual({
      title: 'Windsor Castle — timed admission',
      kind: 'tour',
      starts: '10:00',
      ends: '10:30',
      minutes: 30,
      where: 'Windsor Castle, Windsor SL4 1NJ',
      notes: 'Arrive 09:55.',
    });
    const train = spokenBooking(
      booking({
        title: 'Eurostar',
        type: 'train',
        location: null,
        reservation_time: '2026-12-24T10:40',
        reservation_end_time: '2026-12-24T13:57',
        endpoints: [
          { role: 'to', sequence: 1, name: 'London St Pancras', local_time: '13:57', local_date: '2026-12-24' },
          { role: 'from', sequence: 0, name: 'Amsterdam Centraal', local_time: '10:40', local_date: '2026-12-24' },
        ],
      }),
      { starts: true, ends: true },
    );
    expect(train).toEqual({
      title: 'Eurostar',
      kind: 'train',
      starts: '10:40',
      ends: '13:57',
      from: 'Amsterdam Centraal',
      to: 'London St Pancras',
    });
  });

  it('DAYPLAN-007: names the ports of a cruise on one date with the times set for them', () => {
    const endpoints = [
      { role: 'from', sequence: 0, name: 'Basel', local_time: '21:00', local_date: '2026-12-17' },
      { role: 'stop', sequence: 1, name: 'Mannheim', local_time: null, local_date: '2026-12-20' },
      { role: 'stop', sequence: 2, name: 'Rüdesheim', local_time: '13:00', local_date: '2026-12-20' },
      { role: 'to', sequence: 3, name: 'Amsterdam', local_time: '08:00', local_date: '2026-12-24' },
    ];
    const cruise = booking({ type: 'cruise', endpoints });
    expect(cruiseStops(cruise, '2026-12-17')).toEqual([{ port: 'Basel', embark: true, departs: '21:00' }]);
    expect(cruiseStops(cruise, '2026-12-20')).toEqual([{ port: 'Mannheim' }, { port: 'Rüdesheim', time: '13:00' }]);
    expect(cruiseStops(cruise, '2026-12-24')).toEqual([{ port: 'Amsterdam', disembark: true, arrives: '08:00' }]);
    expect(cruiseStops(cruise, '2026-12-21')).toEqual([]);
  });

  it('DAYPLAN-008: speaks a stay, a planned place and a day note, and keeps admin notes out', () => {
    const dates = new Map([
      [1, '2026-12-24'],
      [2, '2026-12-28'],
    ]);
    expect(
      spokenStay(
        {
          start_day_id: 1,
          end_day_id: 2,
          check_in: '15:00',
          check_out: '11:00',
          place_name: 'Hotel',
          place_address: '1 Street',
        },
        dates,
      ),
    ).toEqual({
      name: 'Hotel',
      address: '1 Street',
      check_in_date: '2026-12-24',
      check_in: '15:00',
      check_out_date: '2026-12-28',
      check_out: '11:00',
    });
    expect(
      spokenAssignment({
        order_index: 0,
        notes: 'Paid £20. Go early.',
        assignment_time: '09:00',
        assignment_end_time: null,
        place: { name: 'Market', address: null, place_time: '08:00', end_time: '10:00' },
      }),
    ).toEqual({ time: '09:00', until: '10:00', place: 'Market', notes: 'Go early.' });
    expect(isAdminNote('Last checked 20 Nov against the emails')).toBe(true);
    expect(spokenNote({ text: 'Last checked 20 Nov', time: null })).toBeNull();
    expect(spokenNote({ text: 'Dinner near the hotel', time: '19:00' })).toBe('19:00 Dinner near the hotel');
    expect(spokenNote({ text: 'Refundable until Friday.', time: null })).toBeNull();
  });
});

describe('finding a booking', () => {
  it('DAYPLAN-009: matches the words of a question against the title and kind, accents ignored', () => {
    const words = queryWords('When is the Rhine cruise?');
    expect(words).toEqual(['rhine', 'cruise']);
    expect(matchScore(words, { title: 'Viking Christmas on the Rhine', type: 'cruise' })).toBe(2);
    expect(matchScore(words, { title: 'Rhine river walk', type: 'tour' })).toBe(1);
    expect(matchScore(queryWords('zurich'), { title: 'Zürich Airport → Zürich HB', type: 'train' })).toBe(1);
    expect(queryWords('the of a')).toEqual([]);
  });

  it('DAYPLAN-010: answers what is still to come first, soonest first, then the past, most recent first', () => {
    const items = [
      { date: '2026-12-01', id: 'past-old' },
      { date: null, id: 'undated' },
      { date: '2026-12-30', id: 'later' },
      { date: '2026-12-10', id: 'past-recent' },
      { date: '2026-12-20', id: 'soon' },
    ];
    expect(soonestFirst(items, '2026-12-15').map((i) => i.id)).toEqual([
      'soon',
      'later',
      'past-recent',
      'past-old',
      'undated',
    ]);
  });
});
