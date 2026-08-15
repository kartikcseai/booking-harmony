/**
 * Logical event ordering.
 *
 * Arrival order is never trusted. Every event carries a `logical_sequence`
 * (derived from the source's logical occurrence time) plus `occurred_at` and a
 * stable `event_id`. Ordering is the lexicographic tuple:
 *
 *     (logical_sequence, occurred_at, event_id)
 *
 * `event_id` is the final key so the order is total: two events can never be
 * considered equal, which means reconstruction is repeatable regardless of the
 * order rows come back from Postgres.
 *
 * Late events simply sort into their logical position and the affected
 * aggregate is recomputed. Duplicates are removed by `dedupe_key`
 * (aggregate + version + type + source hash) before ordering. An event whose
 * aggregate_version is not exactly one past the current version cannot be
 * safely applied: it is quarantined with a reason rather than applied
 * out-of-order, so a gap is visible instead of silently corrupting state.
 */

export interface OrderableEvent {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_version: number;
  logical_sequence: number;
  occurred_at: string;
  dedupe_key: string;
}

export function dedupeEvents<T extends OrderableEvent>(events: T[]): {
  unique: T[];
  removed: number;
} {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const event of events) {
    if (seen.has(event.dedupe_key)) continue;
    seen.add(event.dedupe_key);
    unique.push(event);
  }
  return { unique, removed: events.length - unique.length };
}

export function orderEvents<T extends OrderableEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.logical_sequence !== b.logical_sequence)
      return a.logical_sequence - b.logical_sequence;
    if (a.occurred_at !== b.occurred_at) return a.occurred_at < b.occurred_at ? -1 : 1;
    return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
  });
}

export type ApplyOutcome =
  | { status: "applied" }
  | { status: "duplicate" }
  | { status: "quarantined"; reason: string };

/**
 * Decide whether an event can be applied to an aggregate at `currentVersion`.
 * Replaying an already-applied version is a no-op, not an error; a jump ahead
 * means an event is missing and must not be applied.
 */
export function classifyApplication(
  event: OrderableEvent,
  currentVersion: number,
): ApplyOutcome {
  if (event.aggregate_version <= currentVersion) return { status: "duplicate" };
  if (event.aggregate_version > currentVersion + 1)
    return {
      status: "quarantined",
      reason: `MISSING_EVENT: aggregate at v${currentVersion}, event targets v${event.aggregate_version}`,
    };
  return { status: "applied" };
}
