import { canRead, canReadTrips } from '../../mcp/scopes';
import { noAccess } from '../../mcp/tools/_shared';
import { errorResult, McpController, ok, Tool, TOOL_ANNOTATIONS_READONLY, type McpContext } from '../../nest-mcp';
import { DayPlanService } from './day-plan.service';
import {
  findBookingRequestSchema,
  getDayPlanRequestSchema,
  type FindBookingRequest,
  type GetDayPlanRequest,
} from '@trek/shared';

/** Both reads tell a guide about bookings and the days of a trip, so a client needs both read scopes. */
const readsDaysAndBookings = (ctx: { scopes: string[] | null }) =>
  canReadTrips(ctx.scopes) && canRead(ctx.scopes, 'reservations');

/**
 * The reads a voice guide makes of a trip in place of get_trip_summary, which
 * answers the whole trip at once (hundreds of thousands of characters for a
 * long one) and every booking with its reference and price. These answer one
 * day, or the bookings a few words name, in a few hundred characters, and
 * leave out what a guide must not say aloud: references, prices, travellers,
 * `other` bookings (insurance and the like), and every sentence of a note
 * that names money, a refund, a reference, a cabin or a long number.
 */
@McpController()
export class DayPlanMcp {
  constructor(private readonly dayPlan: DayPlanService) {}

  @Tool({
    name: 'get_day_plan',
    description:
      'One day of a trip, small enough to read aloud: the planned places in order with their times and the notes on each visit; the bookings that start or end that day with their times, length in minutes, where they are (or, for a ride, where it runs from and to) and their notes (entry and meeting-point details, what a tour includes); the hotel for that night with its address and check-in and check-out days and times (checking_out_of when another stay ends that morning); for a cruise, the port of that date with the times set for it; and the day notes. Booking references, prices, travellers, insurance and sentences about money are never included. Leave tripId out to use the trip whose days include the date.',
    inputSchema: getDayPlanRequestSchema.shape,
    annotations: TOOL_ANNOTATIONS_READONLY,
    access: readsDaysAndBookings,
  })
  async getDayPlan({ date, tripId }: GetDayPlanRequest, ctx: McpContext) {
    const trip = await this.dayPlan.resolveTrip(ctx.userId, date, tripId);
    if (!trip) return tripId === undefined ? errorResult(`No trip of yours has a day on ${date}.`) : noAccess();
    const plan = await this.dayPlan.dayPlan(trip, date);
    if (!plan) return errorResult(`The trip has no day on ${date}.`);
    return ok(plan);
  }

  @Tool({
    name: 'find_booking',
    description:
      'Find bookings by a few words of their title or kind ("Windsor", "Rhine cruise", "Eurostar"), soonest first: the ones still to come, then past ones, at most five. Each has its date, start and end times, where it is (or, for a ride, where it runs from and to) and its notes. Booking references, prices, travellers, insurance and sentences about money are never included. Leave tripId out to search every trip that is not archived.',
    inputSchema: findBookingRequestSchema.shape,
    annotations: TOOL_ANNOTATIONS_READONLY,
    access: readsDaysAndBookings,
  })
  async findBooking({ query, tripId }: FindBookingRequest, ctx: McpContext) {
    const today = new Date().toISOString().slice(0, 10);
    const bookings = await this.dayPlan.findBookings(ctx.userId, query, today, tripId);
    if (bookings === null) return noAccess();
    return ok({ bookings });
  }
}
