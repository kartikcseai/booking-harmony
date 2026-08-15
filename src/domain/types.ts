/**
 * Domain vocabulary and the booking state machine.
 * Pure: no HTTP, no database, no clock. Everything here is deterministic.
 */

export type BookingState =
  | "PENDING"
  | "CONFIRMED"
  | "REJECTED"
  | "RESCHEDULED"
  | "CANCELLED";

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type SessionType = "EMERGENCY" | "PRIORITY" | "ROUTINE";
export type BookingSource = "WEB" | "MOBILE" | "PARTNER_API" | "IMPORT" | "ADMIN";
export type ExpertDomain = "HEALTHCARE" | "FINANCE" | "TECHNOLOGY";

/** Allowed transitions. Anything absent here is rejected by both app and DB trigger. */
export const TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED", "RESCHEDULED"],
  CONFIRMED: ["CANCELLED", "RESCHEDULED"],
  RESCHEDULED: ["CONFIRMED", "REJECTED", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: BookingState, to: BookingState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingState, to: BookingState): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Cannot move booking from ${from} to ${to}`,
      { from, to },
    );
  }
}

/** States that still occupy the expert's calendar and can therefore conflict. */
export const ACTIVE_STATES: readonly BookingState[] = ["PENDING", "CONFIRMED"];

export const PRIORITY_RANK: Record<Priority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
export const SESSION_TYPE_RANK: Record<SessionType, number> = {
  EMERGENCY: 3,
  PRIORITY: 2,
  ROUTINE: 1,
};

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_EXPERT"
  | "EXPERT_UNAVAILABLE"
  | "INVALID_BOOKING_WINDOW"
  | "CONFLICT_DETECTED"
  | "INVALID_STATE_TRANSITION"
  | "VERSION_MISMATCH"
  | "DUPLICATE_REQUEST"
  | "IDEMPOTENCY_MISMATCH"
  | "CONFLICT_ALREADY_RESOLVED"
  | "CONFIGURATION_MISSING"
  | "EVENT_OUT_OF_ORDER"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "DATABASE_ERROR"
  | "INTERNAL_ERROR";

/** Single machine-readable error shape crossing every boundary. */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DomainError";
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export type EventType =
  | "BookingCreated"
  | "BookingUpdated"
  | "BookingCancelled"
  | "ConflictDetected"
  | "ResolutionRequested"
  | "ResolutionCalculated"
  | "BookingConfirmed"
  | "BookingRejected"
  | "BookingRescheduled";

/** Overlap taxonomy, recorded per conflict member for explainability. */
export type OverlapKind = "EXACT" | "PARTIAL" | "NESTED" | "CONTAINS" | "ADJACENT";

export function classifyOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): OverlapKind | null {
  if (a.start === b.start && a.end === b.end) return "EXACT";
  if (a.end === b.start || b.end === a.start) return "ADJACENT"; // touching, not a conflict
  if (a.end <= b.start || b.end <= a.start) return null;
  if (a.start >= b.start && a.end <= b.end) return "NESTED";
  if (b.start >= a.start && b.end <= a.end) return "CONTAINS";
  return "PARTIAL";
}
