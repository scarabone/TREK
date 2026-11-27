/**
 * The day and booking reads a voice guide makes over MCP, against the booted
 * container: get_day_plan answers one day (its places, its bookings, the
 * night's hotel, the port of a cruise, the day notes) and find_booking the
 * bookings a few words name, and neither ever answers a booking reference, a
 * price, the travellers, an `other` booking or a sentence about money.
 */
import { buildApp } from '../../src/bootstrap';
import { createLocalMcpServer, McpRegistryService } from '../../src/nest-mcp';
import { withRequestContext } from '../../src/nest/database/request-context';
import { makeDayAccommodation, makeDayAssignment, makeDayNote } from '../helpers/factories/itinerary';
import { makePlace } from '../helpers/factories/places';
import { addReservationTraveler, makeReservation, makeReservationEndpoint } from '../helpers/factories/reservations';
import { addTripMember, makeTrip, readTripDays } from '../helpers/factories/trips';
import { makeUser } from '../helpers/factories/users';
import { MikroORM } from '@mikro-orm/core';
import { Client } from '@modelcontextprotocol/sdk/client/index';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory';
import type { INestApplication } from '@nestjs/common';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: INestApplication;
let orm: MikroORM;

beforeAll(async () => {
  app = await buildApp();
  orm = app.get(MikroORM);
}, 60_000);

afterAll(async () => {
  await app?.close();
});

/** One tool call as `userId` with the given scopes (null: every scope); the JSON it answered, its error, or `unlisted`. */
async function callTool(userId: number, name: string, args: Record<string, unknown>, scopes: string[] | null = null) {
  const server = createLocalMcpServer('TREK day plan e2e');
  const around = (_info: unknown, call: () => unknown): unknown => withRequestContext(orm, call);
  await withRequestContext(orm, () =>
    app
      .get(McpRegistryService)
      .attach(
        server,
        { userId, scopes, isStaticToken: false },
        { include: (kind, tool) => kind === 'tool' && tool === name, around },
      ),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'day-plan-e2e', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    // A session the scopes left without a single tool answers no tool list at all.
    const tools = await client.listTools().then(
      (r) => r.tools,
      () => [],
    );
    if (!tools.some((t) => t.name === name)) return { unlisted: true };
    const result = await client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? (result.content as Array<{ text?: string }>) : [];
    const text = content[0]?.text ?? '';
    return result.isError === true ? { error: text } : JSON.parse(text);
  } finally {
    await client.close();
    await server.close();
  }
}

/**
 * A trip shaped like a winter river cruise: a hotel in Zürich for two nights,
 * a train and a cruise on the 17th, the ship's ports on the days after, a
 * timed castle entry on the 27th, travel insurance, and a day with nothing booked.
 */
async function cruiseTrip() {
  const { user } = await makeUser(orm);
  const trip = await makeTrip(orm, user.id, {
    title: 'Rhine Christmas',
    start_date: '2026-12-15',
    end_date: '2026-12-28',
  });
  const days = await readTripDays(orm, trip.id);
  const day = (date: string) => {
    const found = days.find((d) => d.date === date);
    if (!found) throw new Error(`no day on ${date}`);
    return found.id;
  };

  const hotel = await makePlace(orm, trip.id, { name: 'Hotel Schweizerhof', address: 'Bahnhofplatz 7, Zürich' });
  const stay = await makeDayAccommodation(orm, trip.id, hotel.id, day('2026-12-15'), day('2026-12-17'), {
    check_in: '15:00',
    check_out: '11:00',
    confirmation: 'HOTEL-REF-1',
  });
  await makeReservation(orm, trip.id, {
    title: 'Hotel Schweizerhof',
    type: 'hotel',
    day: day('2026-12-15'),
    endDay: day('2026-12-17'),
    accommodation_id: String(stay.id),
    confirmation_number: 'HOTEL-REF-1',
  });

  const train = await makeReservation(orm, trip.id, {
    title: 'SBB IC 770 Zürich HB → Basel SBB',
    type: 'train',
    status: 'confirmed',
    day: day('2026-12-17'),
    endDay: day('2026-12-17'),
    reservation_time: '2026-12-17T11:59',
    reservation_end_time: '2026-12-17T12:52',
    confirmation_number: '151524891315',
    notes:
      '1st class Supersaver, CHF 72 for two. Then taxi ~10 min to the Viking terminal.\n\n🎟️ Entry: Keep the ticket PDF on both phones.',
    metadata: JSON.stringify({ train_number: 'IC 770', price: '72', priceCurrency: 'CHF' }),
  });
  await makeReservationEndpoint(orm, train.id, {
    role: 'from',
    sequence: 0,
    name: 'Zürich HB',
    code: null,
    local_time: '11:59',
    local_date: '2026-12-17',
  });
  await makeReservationEndpoint(orm, train.id, {
    role: 'to',
    sequence: 1,
    name: 'Basel SBB',
    code: null,
    local_time: '12:52',
    local_date: '2026-12-17',
  });
  await addReservationTraveler(orm, train.id, user.id);

  const cruise = await makeReservation(orm, trip.id, {
    title: 'Viking Christmas on the Rhine',
    type: 'cruise',
    status: 'confirmed',
    day: day('2026-12-17'),
    endDay: day('2026-12-24'),
    reservation_time: '2026-12-17T21:00',
    reservation_end_time: '2026-12-24T08:00',
    confirmation_number: '8532613',
    notes: 'B-Veranda stateroom 233. Embark from 15:00, sails 21:00 (all-aboard ~20:30).',
    metadata: JSON.stringify({ price: '8126.34', priceCurrency: 'USD' }),
  });
  const port = (role: string, sequence: number, name: string, date: string, time: string | null = null) =>
    makeReservationEndpoint(orm, cruise.id, { role, sequence, name, code: null, local_time: time, local_date: date });
  await port('from', 0, 'Basel — Viking Terminal St. Johann', '2026-12-17', '21:00');
  await port('stop', 1, 'Breisach am Rhein', '2026-12-18');
  await port('stop', 2, 'Strasbourg', '2026-12-19', '08:00');
  await port('to', 3, 'Amsterdam', '2026-12-24', '08:00');

  await makeReservation(orm, trip.id, {
    title: 'Windsor Castle — timed admission',
    type: 'tour',
    status: 'confirmed',
    day: day('2026-12-27'),
    endDay: day('2026-12-27'),
    reservation_time: '2026-12-27T10:00',
    reservation_end_time: '2026-12-27T10:30',
    location: 'Windsor Castle, Windsor SL4 1NJ',
    confirmation_number: '8384423',
    notes:
      '2 adults, entry 10:00–10:30, £64 via Royal Collection Trust, non-refundable. Arrive no more than 10 min early (~09:55).\n\n🎟️ Entry: Phone OK (Wallet pass has the real barcode).',
  });
  await makeReservation(orm, trip.id, {
    title: 'Travel insurance',
    type: 'other',
    status: 'confirmed',
    day: day('2026-12-19'),
    endDay: day('2026-12-19'),
    confirmation_number: 'POLICY-9',
  });

  const market = await makePlace(orm, trip.id, { name: 'Strasbourg Christmas market', address: 'Place Kléber' });
  const cathedral = await makePlace(orm, trip.id, { name: 'Strasbourg Cathedral', address: 'Place de la Cathédrale' });
  await makeDayAssignment(orm, day('2026-12-19'), cathedral.id, { order_index: 1, assignment_time: '14:00' });
  await makeDayAssignment(orm, day('2026-12-19'), market.id, {
    order_index: 0,
    assignment_time: '10:00',
    notes: 'Bring cash, €20 each. Mulled wine stall by the tree.',
  });
  await makeDayNote(orm, day('2026-12-19'), trip.id, {
    text: 'Last checked 20 Nov against the Viking emails',
    sort_order: 0,
  });
  await makeDayNote(orm, day('2026-12-19'), trip.id, { text: 'Back on board by 17:30.', time: '17:30', sort_order: 1 });

  return { user, trip, day };
}

/** Nothing a guide may not say: no reference, price, traveller or insurance anywhere in the answer. */
function expectNothingPrivate(answer: unknown) {
  const text = JSON.stringify(answer);
  for (const leak of [
    '151524891315',
    '8532613',
    '8384423',
    'HOTEL-REF-1',
    'POLICY-9',
    'insurance',
    'stateroom',
    '£',
    'CHF',
    '8126',
    'refundable',
    'confirmation',
    'travelers',
    'price',
  ])
    expect(text).not.toContain(leak);
}

describe('get_day_plan', () => {
  it('DAYPLAN-E2E-001: answers a cruise day with its port, places in order and notes, without admin notes or insurance', async () => {
    const { user, trip } = await cruiseTrip();
    const plan = await callTool(user.id, 'get_day_plan', { date: '2026-12-19', tripId: trip.id });
    expect(plan).toEqual({
      trip: 'Rhine Christmas',
      date: '2026-12-19',
      day: 5,
      plan: [
        {
          time: '10:00',
          place: 'Strasbourg Christmas market',
          address: 'Place Kléber',
          notes: 'Mulled wine stall by the tree.',
        },
        { time: '14:00', place: 'Strasbourg Cathedral', address: 'Place de la Cathédrale' },
      ],
      bookings: [],
      cruise: [{ ship: 'Viking Christmas on the Rhine', stops: [{ port: 'Strasbourg', time: '08:00' }] }],
      hotel: null,
      notes: ['17:30 Back on board by 17:30.'],
    });
    expectNothingPrivate(plan);
  });

  it('DAYPLAN-E2E-002: answers the embarkation day with the train, the cruise, the hotel left that morning, and picks the trip by date', async () => {
    const { user } = await cruiseTrip();
    const plan = await callTool(user.id, 'get_day_plan', { date: '2026-12-17' });
    expect(plan.trip).toBe('Rhine Christmas');
    expect(plan.bookings).toEqual([
      {
        title: 'SBB IC 770 Zürich HB → Basel SBB',
        kind: 'train',
        starts: '11:59',
        ends: '12:52',
        from: 'Zürich HB',
        to: 'Basel SBB',
        notes: 'Then taxi ~10 min to the Viking terminal. Entry: Keep the ticket PDF on both phones.',
      },
      {
        title: 'Viking Christmas on the Rhine',
        kind: 'cruise',
        starts: '21:00',
        from: 'Basel — Viking Terminal St. Johann',
        to: 'Amsterdam',
        notes: 'Embark from 15:00, sails 21:00 (all-aboard ~20:30).',
      },
    ]);
    expect(plan.cruise).toEqual([
      {
        ship: 'Viking Christmas on the Rhine',
        stops: [{ port: 'Basel — Viking Terminal St. Johann', embark: true, departs: '21:00' }],
      },
    ]);
    expect(plan.hotel).toBeNull();
    expect(plan.checking_out_of).toEqual({
      name: 'Hotel Schweizerhof',
      address: 'Bahnhofplatz 7, Zürich',
      check_in_date: '2026-12-15',
      check_in: '15:00',
      check_out_date: '2026-12-17',
      check_out: '11:00',
    });
    expectNothingPrivate(plan);
    expect(JSON.stringify(plan).length).toBeLessThan(1500);
  });

  it('DAYPLAN-E2E-003: answers the hotel for each night of a stay that spans days, and a day with no bookings', async () => {
    const { user, trip } = await cruiseTrip();
    const nights = await Promise.all(
      ['2026-12-15', '2026-12-16'].map((date) => callTool(user.id, 'get_day_plan', { date, tripId: trip.id })),
    );
    for (const plan of nights) {
      expect(plan.hotel).toMatchObject({
        name: 'Hotel Schweizerhof',
        check_in_date: '2026-12-15',
        check_out_date: '2026-12-17',
      });
      expect(plan.bookings).toEqual([]);
      expectNothingPrivate(plan);
    }
    const quiet = await callTool(user.id, 'get_day_plan', { date: '2026-12-26', tripId: trip.id });
    expect(quiet).toEqual({
      trip: 'Rhine Christmas',
      date: '2026-12-26',
      day: 12,
      plan: [],
      bookings: [],
      hotel: null,
      notes: [],
    });
  });

  it('DAYPLAN-E2E-004: answers the timed entry with its place, length and entry notes, the money sentence dropped', async () => {
    const { user, trip } = await cruiseTrip();
    const plan = await callTool(user.id, 'get_day_plan', { date: '2026-12-27', tripId: trip.id });
    expect(plan.bookings).toEqual([
      {
        title: 'Windsor Castle — timed admission',
        kind: 'tour',
        starts: '10:00',
        ends: '10:30',
        minutes: 30,
        where: 'Windsor Castle, Windsor SL4 1NJ',
        notes: 'Arrive no more than 10 min early (~09:55). Entry: Phone OK (Wallet pass has the real barcode).',
      },
    ]);
    expectNothingPrivate(plan);
  });

  it('DAYPLAN-E2E-005: refuses a trip the caller is not on, a date no trip has, and a client without both read scopes', async () => {
    const { user, trip } = await cruiseTrip();
    const { user: stranger } = await makeUser(orm);
    expect(await callTool(stranger.id, 'get_day_plan', { date: '2026-12-19', tripId: trip.id })).toHaveProperty(
      'error',
    );
    expect(await callTool(stranger.id, 'get_day_plan', { date: '2026-12-19' })).toHaveProperty('error');
    expect(await callTool(user.id, 'get_day_plan', { date: '2027-03-01', tripId: trip.id })).toHaveProperty('error');
    expect(await callTool(user.id, 'get_day_plan', { date: '2026-12-19' }, ['trips:read'])).toEqual({ unlisted: true });
    expect(await callTool(user.id, 'get_day_plan', { date: '2026-12-19' }, ['reservations:read'])).toEqual({
      unlisted: true,
    });
    expect(
      await callTool(user.id, 'get_day_plan', { date: '2026-12-19' }, ['trips:read', 'reservations:read']),
    ).toHaveProperty('plan');
  });

  it('DAYPLAN-E2E-006: answers a member of the trip as it answers the owner', async () => {
    const { trip } = await cruiseTrip();
    const { user: member } = await makeUser(orm);
    await addTripMember(orm, trip.id, member.id);
    const plan = await callTool(member.id, 'get_day_plan', { date: '2026-12-27' });
    expect(plan.trip).toBe('Rhine Christmas');
    expect(plan.bookings).toHaveLength(1);
  });
});

describe('find_booking', () => {
  it('DAYPLAN-E2E-007: finds bookings by words of their title or kind, with date, times, place and notes', async () => {
    const { user, trip } = await cruiseTrip();
    const found = await callTool(user.id, 'find_booking', { query: 'Rhine cruise', tripId: trip.id });
    expect(found.bookings).toEqual([
      {
        date: '2026-12-17',
        until: '2026-12-24',
        title: 'Viking Christmas on the Rhine',
        kind: 'cruise',
        starts: '21:00',
        from: 'Basel — Viking Terminal St. Johann',
        to: 'Amsterdam',
        notes: 'Embark from 15:00, sails 21:00 (all-aboard ~20:30).',
      },
    ]);
    const windsor = await callTool(user.id, 'find_booking', { query: 'windsor' });
    expect(windsor.bookings).toEqual([
      expect.objectContaining({ date: '2026-12-27', starts: '10:00', where: 'Windsor Castle, Windsor SL4 1NJ' }),
    ]);
    expectNothingPrivate([found, windsor]);
  });

  it('DAYPLAN-E2E-008: never finds an `other` booking, answers nothing for no match, and refuses a trip the caller is not on', async () => {
    const { user, trip } = await cruiseTrip();
    const { user: stranger } = await makeUser(orm);
    expect(await callTool(user.id, 'find_booking', { query: 'insurance', tripId: trip.id })).toEqual({ bookings: [] });
    expect(await callTool(user.id, 'find_booking', { query: 'submarine' })).toEqual({ bookings: [] });
    expect(await callTool(stranger.id, 'find_booking', { query: 'windsor', tripId: trip.id })).toHaveProperty('error');
    expect(await callTool(stranger.id, 'find_booking', { query: 'windsor' })).toEqual({ bookings: [] });
  });

  it('DAYPLAN-E2E-009: names the trip when it searched more than one, upcoming bookings first', async () => {
    const { user } = await cruiseTrip();
    const past = await makeTrip(orm, user.id, {
      title: 'Last winter',
      start_date: '2020-12-01',
      end_date: '2020-12-02',
    });
    const pastDays = await readTripDays(orm, past.id);
    await makeReservation(orm, past.id, {
      title: 'Windsor Castle visit',
      type: 'tour',
      status: 'confirmed',
      day: pastDays[0].id,
      endDay: pastDays[0].id,
      reservation_time: '2020-12-01T11:00',
    });
    const found = await callTool(user.id, 'find_booking', { query: 'Windsor castle' });
    expect(found.bookings.map((b: { trip: string; date: string }) => [b.trip, b.date])).toEqual([
      ['Rhine Christmas', '2026-12-27'],
      ['Last winter', '2020-12-01'],
    ]);
  });
});
