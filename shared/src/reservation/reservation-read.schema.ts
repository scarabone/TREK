import { idSchema } from '../common/primitives.schema';

import { z } from 'zod';

/**
 * The trip reads of the bookings an assistant makes over MCP. `get_trip_summary`
 * carries every booking with its metadata, which the provider never sees (a
 * flight number or a seat lives there); these two answer the bookings and the
 * stays alone, with the readable details pulled out of the metadata.
 */

/** What a booking is, as a filter: getting there (a flight, a train, a hire car) or anything booked on the way. */
export const RESERVATION_READ_KINDS = ['transport', 'booking'] as const;
export type ReservationReadKind = (typeof RESERVATION_READ_KINDS)[number];

/** `list_reservations`: the trip's bookings, of one kind or both, on one day or all of them. */
export const listReservationsRequestSchema = z.object({
  tripId: idSchema,
  kinds: z
    .array(z.enum(RESERVATION_READ_KINDS))
    .min(1)
    .max(RESERVATION_READ_KINDS.length)
    .optional()
    .describe(
      'Only these kinds: "transport" (flights, trains, hire cars and other rides) or "booking" (hotels, tables, tickets). Both when left out.',
    ),
  dayId: idSchema
    .optional()
    .describe(
      'Only the bookings on this day: those that start or end on it, a stopover leg on it, or a stay checking in on it.',
    ),
});
export type ListReservationsRequest = z.infer<typeof listReservationsRequestSchema>;

/** `list_accommodations`: where the trip sleeps, stay by stay. */
export const listAccommodationsRequestSchema = z.object({ tripId: idSchema });
export type ListAccommodationsRequest = z.infer<typeof listAccommodationsRequestSchema>;

/** A calendar date as the day plan stores it, `YYYY-MM-DD`. */
const dayDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .describe('The date, YYYY-MM-DD.');

const tripOfDateSchema = idSchema
  .optional()
  .describe('The trip. Left out, the trip the caller can see whose days include the date.');

/** `get_day_plan`: one day of a trip, read for a guide that speaks it aloud. */
export const getDayPlanRequestSchema = z.object({
  date: dayDateSchema,
  tripId: tripOfDateSchema,
});
export type GetDayPlanRequest = z.infer<typeof getDayPlanRequestSchema>;

/** `find_booking`: the bookings whose title matches a few words, soonest first. */
export const findBookingRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Words from the booking title or its kind, such as "Windsor" or "Rhine cruise".'),
  tripId: idSchema.optional().describe('The trip. Left out, every trip the caller can see that is not archived.'),
});
export type FindBookingRequest = z.infer<typeof findBookingRequestSchema>;
