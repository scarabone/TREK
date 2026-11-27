import {
  findBookingRequestSchema,
  getDayPlanRequestSchema,
  listAccommodationsRequestSchema,
  listReservationsRequestSchema,
} from './reservation-read.schema';

import { describe, expect, it } from 'vitest';

describe('listReservationsRequestSchema', () => {
  it('RESREAD-001: takes a trip alone, a kind filter and a day', () => {
    expect(listReservationsRequestSchema.safeParse({ tripId: 3 }).success).toBe(true);
    expect(listReservationsRequestSchema.safeParse({ tripId: 3, kinds: ['transport'], dayId: 9 }).success).toBe(true);
    expect(listReservationsRequestSchema.safeParse({ tripId: 3, kinds: ['booking', 'transport'] }).success).toBe(true);
  });

  it('RESREAD-002: refuses an unknown kind, an empty kind list, a bad id and a missing trip', () => {
    expect(listReservationsRequestSchema.safeParse({ tripId: 3, kinds: ['hotel'] }).success).toBe(false);
    expect(listReservationsRequestSchema.safeParse({ tripId: 3, kinds: [] }).success).toBe(false);
    expect(listReservationsRequestSchema.safeParse({ tripId: 3, dayId: 0 }).success).toBe(false);
    expect(listReservationsRequestSchema.safeParse({ kinds: ['booking'] }).success).toBe(false);
  });
});

describe('listAccommodationsRequestSchema', () => {
  it('RESREAD-003: takes the trip and nothing else is required', () => {
    expect(listAccommodationsRequestSchema.safeParse({ tripId: 3 }).success).toBe(true);
    expect(listAccommodationsRequestSchema.safeParse({ tripId: -1 }).success).toBe(false);
  });
});

describe('getDayPlanRequestSchema', () => {
  it('RESREAD-004: takes a date with or without a trip and refuses another spelling of the date', () => {
    expect(getDayPlanRequestSchema.safeParse({ date: '2026-12-19' }).success).toBe(true);
    expect(getDayPlanRequestSchema.safeParse({ date: '2026-12-19', tripId: 15 }).success).toBe(true);
    expect(getDayPlanRequestSchema.safeParse({ date: '19/12/2026' }).success).toBe(false);
    expect(getDayPlanRequestSchema.safeParse({ date: '2026-12-19', tripId: 0 }).success).toBe(false);
    expect(getDayPlanRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('findBookingRequestSchema', () => {
  it('RESREAD-005: takes a few words with or without a trip and refuses an empty query', () => {
    expect(findBookingRequestSchema.safeParse({ query: 'Windsor' }).success).toBe(true);
    expect(findBookingRequestSchema.safeParse({ query: 'Rhine cruise', tripId: 15 }).success).toBe(true);
    expect(findBookingRequestSchema.safeParse({ query: '   ' }).success).toBe(false);
    expect(findBookingRequestSchema.safeParse({ query: 'x'.repeat(101) }).success).toBe(false);
  });
});
