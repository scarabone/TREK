import { AccommodationsService } from '../accommodations/accommodations.service';
import { DaysService } from '../days/days.service';
import { ReservationsService } from '../reservations/reservations.service';
import {
  cruiseStops,
  dateOf,
  isReadable,
  matchScore,
  queryWords,
  soonestFirst,
  spokenAssignment,
  spokenBooking,
  spokenNote,
  spokenStay,
  type PlanAssignment,
  type PlanBooking,
  type PlanDay,
  type PlanEndpoint,
  type PlanNote,
  type PlanStay,
} from './day-plan.helpers';
import { TripReadModelService } from './trip-read-model.service';
import { Injectable } from '@nestjs/common';

/** How many bookings a search answers with at most. */
const FIND_LIMIT = 5;

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function id(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+(\.0+)?$/.test(value)) return Math.trunc(Number(value));
  return null;
}

function endpointOf(raw: unknown): PlanEndpoint {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    role: text(row.role) ?? 'stop',
    sequence: typeof row.sequence === 'number' ? row.sequence : 0,
    name: text(row.name) ?? '',
    local_time: text(row.local_time),
    local_date: text(row.local_date),
  };
}

/** The fields of a stored booking both tools read; the reference, the price, the metadata and the travellers are not among them. */
function bookingOf(row: Record<string, unknown>): PlanBooking {
  return {
    title: text(row.title) ?? '',
    type: text(row.type) ?? 'other',
    status: text(row.status),
    day_id: id(row.day_id),
    end_day_id: id(row.end_day_id),
    reservation_time: text(row.reservation_time),
    reservation_end_time: text(row.reservation_end_time),
    location: text(row.location),
    notes: text(row.notes),
    place_name: text(row.place_name),
    accommodation_id: id(row.accommodation_id),
    endpoints: Array.isArray(row.endpoints) ? row.endpoints.map(endpointOf) : [],
  };
}

/** The date a booking starts on: its own start time, else the date of its first day. */
function startDate(booking: PlanBooking, dates: ReadonlyMap<number, string>): string | null {
  return dateOf(booking.reservation_time) ?? (booking.day_id != null ? (dates.get(booking.day_id) ?? null) : null);
}

function endDate(booking: PlanBooking, dates: ReadonlyMap<number, string>): string | null {
  const endDay = booking.end_day_id != null ? dates.get(booking.end_day_id) : undefined;
  return dateOf(booking.reservation_end_time) ?? endDay ?? startDate(booking, dates);
}

interface TripDays {
  days: (PlanDay & { assignments: PlanAssignment[]; notes_items: PlanNote[] })[];
  dates: Map<number, string>;
}

/**
 * The two reads a voice guide makes of a trip: one day, and the bookings a
 * few words name. Each reads only what can be spoken: the day's places, its
 * bookings with their times and places, the night's hotel, the port of a
 * cruise and the notes, never a reference, a price or who travels.
 */
@Injectable()
export class DayPlanService {
  constructor(
    private readonly readModel: TripReadModelService,
    private readonly days: DaysService,
    private readonly accommodations: AccommodationsService,
    private readonly reservations: ReservationsService,
  ) {}

  private async tripDays(tripId: number): Promise<TripDays> {
    const { days } = await this.days.list(tripId);
    const dates = new Map<number, string>();
    for (const day of days) if (day.date) dates.set(day.id, day.date);
    return { days: days as unknown as TripDays['days'], dates };
  }

  /** The trip the user can see whose days include the date: a current one before an archived one. */
  private async tripOfDate(userId: number, date: string): Promise<{ id: number; title: string } | null> {
    const trips = (await this.readModel.tripsOf(userId))
      .filter((t) => !t.start_date || !t.end_date || (t.start_date <= date && date <= t.end_date))
      .sort((a, b) => Number(a.is_archived ?? 0) - Number(b.is_archived ?? 0));
    const daysOf = await Promise.all(trips.map(async (trip) => (await this.days.list(trip.id)).days));
    const index = daysOf.findIndex((days) => days.some((d) => d.date === date));
    return index < 0 ? null : { id: trips[index].id, title: trips[index].title };
  }

  /** The trip asked for if the user may see it, else the one covering the date; null when there is none. */
  async resolveTrip(userId: number, date: string, tripId?: number): Promise<{ id: number; title: string } | null> {
    if (tripId === undefined) return await this.tripOfDate(userId, date);
    return await this.visibleTrip(userId, tripId);
  }

  /** The trip if the user owns it or is a member of it; the trip list is the access check. */
  private async visibleTrip(userId: number, tripId: number): Promise<{ id: number; title: string } | null> {
    const trip = (await this.readModel.tripsOf(userId)).find((t) => t.id === tripId);
    return trip ? { id: trip.id, title: trip.title } : null;
  }

  /** One day of a trip as a guide reads it aloud; null when the trip has no day on that date. */
  async dayPlan(trip: { id: number; title: string }, date: string) {
    const { days, dates } = await this.tripDays(trip.id);
    const day = days.find((d) => d.date === date);
    if (!day) return null;

    const plan = [...day.assignments]
      .filter((a) => a.accommodation_id == null)
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
      .map(spokenAssignment);

    const all = (await this.reservations.list(trip.id)).map((row) => bookingOf(row)).filter(isReadable);
    const bookings = [];
    const cruises = [];
    for (const booking of all) {
      const starts = startDate(booking, dates);
      const ends = endDate(booking, dates);
      if (!starts || !ends || date < starts || date > ends) continue;
      // A hotel booking tied to a stay is said once, as the night's hotel.
      if (booking.type === 'hotel' && booking.accommodation_id != null) continue;
      if (booking.type === 'cruise') {
        cruises.push({ ship: booking.title, stops: cruiseStops(booking, date) });
      }
      if (starts === date || ends === date) {
        bookings.push({
          at: booking.reservation_time ?? '',
          spoken: spokenBooking(booking, { starts: starts === date, ends: ends === date }),
        });
      }
    }
    bookings.sort((a, b) => a.at.localeCompare(b.at));

    const stays = (await this.accommodations.list(trip.id)) as unknown as PlanStay[];
    const night = stays.find((s) => {
      const checkIn = s.start_day_id != null ? dates.get(s.start_day_id) : undefined;
      const checkOut = s.end_day_id != null ? dates.get(s.end_day_id) : undefined;
      return checkIn !== undefined && checkOut !== undefined && checkIn <= date && date < checkOut;
    });
    const leaving = stays.find((s) => s !== night && s.end_day_id === day.id);

    const notes = [{ text: day.notes ?? null, time: null }, ...day.notes_items]
      .map(spokenNote)
      .filter((n): n is string => n !== null);

    return {
      trip: trip.title,
      date,
      day: day.day_number,
      ...(day.title ? { title: day.title } : {}),
      plan,
      bookings: bookings.map((b) => b.spoken),
      ...(cruises.length > 0 ? { cruise: cruises } : {}),
      hotel: night ? spokenStay(night, dates) : null,
      ...(leaving ? { checking_out_of: spokenStay(leaving, dates) } : {}),
      notes,
    };
  }

  /** The bookings whose title or kind holds the words, soonest first, across one trip or every current one. */
  async findBookings(userId: number, query: string, today: string, tripId?: number) {
    const words = queryWords(query);
    if (words.length === 0) return [];
    let trips: { id: number; title: string }[];
    if (tripId !== undefined) {
      const trip = await this.visibleTrip(userId, tripId);
      if (!trip) return null;
      trips = [trip];
    } else {
      trips = (await this.readModel.tripsOf(userId))
        .filter((t) => !t.is_archived)
        .map((t) => ({ id: t.id, title: t.title }));
    }
    const read = await Promise.all(
      trips.map(async (trip) => ({
        trip,
        dates: (await this.tripDays(trip.id)).dates,
        rows: await this.reservations.list(trip.id),
      })),
    );
    const found = [];
    for (const { trip, dates, rows } of read) {
      for (const row of rows) {
        const booking = bookingOf(row);
        if (!isReadable(booking)) continue;
        const score = matchScore(words, booking);
        if (score === 0) continue;
        const date = startDate(booking, dates);
        const multiDay = endDate(booking, dates) !== date;
        found.push({
          score,
          date,
          answer: {
            ...(trips.length > 1 ? { trip: trip.title } : {}),
            date,
            ...(multiDay ? { until: endDate(booking, dates) } : {}),
            ...spokenBooking(booking, { starts: true, ends: !multiDay }),
          },
        });
      }
    }
    const best = Math.max(0, ...found.map((f) => f.score));
    return soonestFirst(
      found.filter((f) => f.score === best),
      today,
    )
      .slice(0, FIND_LIMIT)
      .map((f) => f.answer);
  }
}
