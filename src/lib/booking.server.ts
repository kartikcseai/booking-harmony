/**
 * Application / orchestration layer.
 *
 * Server-only. Owns command handling: idempotency, event append, state
 * transitions with optimistic concurrency, conflict detection, invocation of
 * the pure engine, and audit chaining. All domain rules live in src/domain;
 * this file is the plumbing between them and Postgres.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { digestOf } from "@/domain/digest";
import {
  ENGINE_VERSION,
  localHourIn,
  parseConfig,
  resolveConflict as runEngine,
  type Candidate,
  type EngineConfig,
  type ResolutionResult,
} from "@/domain/engine";
import {
  ACTIVE_STATES,
  assertTransition,
  classifyOverlap,
  DomainError,
  type BookingSource,
  type BookingState,
  type EventType,
  type Priority,
  type SessionType,
} from "@/domain/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
const db = (): Db => supabaseAdmin as Db;

const SYSTEM_VERSION = "app-1.0.0";

function fail(error: { code?: string; message?: string } | null, what: string): void {
  if (!error) return;
  if (error.code === "23P01")
    throw new DomainError("CONFLICT_DETECTED", "Slot was taken by a concurrent confirmation", {
      what,
    });
  if (error.code === "23505")
    throw new DomainError("DUPLICATE_REQUEST", "Duplicate record rejected", { what });
  throw new DomainError("DATABASE_ERROR", `${what}: ${error.message ?? "unknown"}`, {
    pgCode: error.code,
  });
}

/* ------------------------------------------------------------------ config */

export async function getActiveConfig(): Promise<EngineConfig> {
  const { data, error } = await db()
    .from("resolution_configs")
    .select("version, weights, tie_breakers")
    .eq("active", true)
    .maybeSingle();
  fail(error, "load configuration");
  if (!data) throw new DomainError("CONFIGURATION_MISSING", "No active resolution configuration");
  return parseConfig(data);
}

export async function getConfigVersion(version: number): Promise<EngineConfig> {
  const { data, error } = await db()
    .from("resolution_configs")
    .select("version, weights, tie_breakers")
    .eq("version", version)
    .maybeSingle();
  fail(error, "load configuration version");
  if (!data)
    throw new DomainError("CONFIGURATION_MISSING", `Configuration v${version} not found`);
  return parseConfig(data);
}

/* ------------------------------------------------------------ audit + event */

interface AuditInput {
  action: string;
  actorId: string | null;
  actorRole?: string;
  expertId?: string | null;
  bookingId?: string | null;
  conflictId?: string | null;
  decisionId?: string | null;
  eventId?: string | null;
  previousState?: BookingState | null;
  newState?: BookingState | null;
  inputData?: Record<string, unknown>;
  decisionData?: Record<string, unknown> | null;
  score?: number | null;
  configurationVersion?: number | null;
  requestId: string;
  correlationId: string;
}

/**
 * Append one audit record, chained to its predecessor by hash. Tampering with
 * any earlier row breaks every subsequent hash, so integrity is verifiable
 * without trusting the storage layer. Rows are also protected by a trigger
 * that rejects UPDATE and DELETE outright.
 */
export async function appendAudit(input: AuditInput): Promise<string> {
  const { data: prev } = await db()
    .from("audit_records")
    .select("record_hash")
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousHash: string | null = prev?.record_hash ?? null;
  const body = {
    action: input.action,
    actor_id: input.actorId,
    booking_id: input.bookingId ?? null,
    conflict_id: input.conflictId ?? null,
    decision_id: input.decisionId ?? null,
    event_id: input.eventId ?? null,
    previous_state: input.previousState ?? null,
    new_state: input.newState ?? null,
    input_data: input.inputData ?? {},
    decision_data: input.decisionData ?? null,
    score: input.score ?? null,
    configuration_version: input.configurationVersion ?? null,
    correlation_id: input.correlationId,
    request_id: input.requestId,
  };
  const recordHash = await digestOf({ previousHash, body });

  const { data, error } = await db()
    .from("audit_records")
    .insert({
      ...body,
      actor_role: input.actorRole ?? null,
      expert_id: input.expertId ?? null,
      system_version: SYSTEM_VERSION,
      record_hash: recordHash,
      previous_hash: previousHash,
    })
    .select("id")
    .single();
  fail(error, "append audit record");
  return data.id as string;
}

interface EventInput {
  type: EventType;
  aggregateId: string;
  aggregateType?: string;
  aggregateVersion: number;
  occurredAt: string;
  source: BookingSource;
  correlationId: string;
  causationId?: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  configurationVersion?: number | null;
}

/**
 * Append to the immutable log. `dedupe_key` makes retries and redelivery
 * harmless: a second attempt at the same logical event is swallowed and the
 * original event id is returned.
 */
export async function appendEvent(input: EventInput): Promise<{ eventId: string; duplicate: boolean }> {
  const aggregateType = input.aggregateType ?? "booking";
  const dedupeKey = await digestOf({
    aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    type: input.type,
    occurredAt: input.occurredAt,
  });

  const logicalSequence = Date.parse(input.occurredAt);
  const { data, error } = await db()
    .from("events")
    .insert({
      event_type: input.type,
      aggregate_id: input.aggregateId,
      aggregate_type: aggregateType,
      aggregate_version: input.aggregateVersion,
      logical_sequence: logicalSequence,
      occurred_at: input.occurredAt,
      source: input.source,
      correlation_id: input.correlationId,
      causation_id: input.causationId ?? null,
      actor_id: input.actorId,
      payload: input.payload,
      configuration_version: input.configurationVersion ?? null,
      dedupe_key: dedupeKey,
    })
    .select("event_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await db()
        .from("events")
        .select("event_id")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing) return { eventId: existing.event_id as string, duplicate: true };
    }
    fail(error, "append event");
  }
  return { eventId: data!.event_id as string, duplicate: false };
}

async function snapshotVersion(booking: Db, eventId: string, actorId: string | null) {
  const { error } = await db().from("booking_versions").insert({
    booking_id: booking.id,
    version: booking.version,
    state: booking.state,
    snapshot: booking,
    event_id: eventId,
    changed_by: actorId,
  });
  if (error && error.code !== "23505") fail(error, "write booking version");
}

/* --------------------------------------------------------- state transition */

interface TransitionInput {
  bookingId: string;
  expectedVersion: number;
  to: BookingState;
  actorId: string | null;
  requestId: string;
  correlationId: string;
  eventType: EventType;
  occurredAt: string;
  source: BookingSource;
  reason: Record<string, unknown>;
  configurationVersion?: number | null;
  decisionId?: string | null;
  conflictId?: string | null;
}

/**
 * Optimistic concurrency: the UPDATE is conditioned on the version the caller
 * read. A concurrent writer bumps the version first and this update matches
 * zero rows, surfacing VERSION_MISMATCH instead of a lost write. The DB
 * trigger independently rejects illegal transitions and version skips, so an
 * application bug cannot corrupt history.
 */
export async function applyTransition(input: TransitionInput) {
  const { data: current, error: readError } = await db()
    .from("bookings")
    .select("*")
    .eq("id", input.bookingId)
    .maybeSingle();
  fail(readError, "read booking");
  if (!current) throw new DomainError("NOT_FOUND", "Booking not found", { id: input.bookingId });
  if (current.version !== input.expectedVersion)
    throw new DomainError("VERSION_MISMATCH", "Booking changed since it was read", {
      expected: input.expectedVersion,
      actual: current.version,
    });

  assertTransition(current.state as BookingState, input.to);
  if (current.state === input.to) return current;

  const { data: updated, error } = await db()
    .from("bookings")
    .update({ state: input.to, version: current.version + 1 })
    .eq("id", input.bookingId)
    .eq("version", input.expectedVersion)
    .select("*")
    .maybeSingle();
  fail(error, "update booking state");
  if (!updated)
    throw new DomainError("VERSION_MISMATCH", "Concurrent update detected", {
      expected: input.expectedVersion,
    });

  const { eventId } = await appendEvent({
    type: input.eventType,
    aggregateId: input.bookingId,
    aggregateVersion: updated.version,
    occurredAt: input.occurredAt,
    source: input.source,
    correlationId: input.correlationId,
    actorId: input.actorId,
    payload: { from: current.state, to: input.to, ...input.reason },
    configurationVersion: input.configurationVersion ?? null,
  });
  await snapshotVersion(updated, eventId, input.actorId);
  await appendAudit({
    action: `booking.${input.to.toLowerCase()}`,
    actorId: input.actorId,
    bookingId: input.bookingId,
    expertId: updated.expert_id,
    conflictId: input.conflictId ?? null,
    decisionId: input.decisionId ?? null,
    eventId,
    previousState: current.state as BookingState,
    newState: input.to,
    inputData: input.reason,
    configurationVersion: input.configurationVersion ?? null,
    requestId: input.requestId,
    correlationId: input.correlationId,
  });
  return updated;
}

/* -------------------------------------------------------- conflict detection */

/**
 * Overlap query. `time_range` is a stored generated tstzrange with a GiST
 * index, so this is an index scan rather than a scan of the expert's history:
 *
 *   WHERE expert_id = $1 AND state IN ('PENDING','CONFIRMED')
 *     AND time_range && tstzrange($2, $3, '[)')
 *
 * The half-open '[)' bound is what makes adjacent bookings (10:00-11:00 and
 * 11:00-12:00) correctly NOT conflict, while exact, partial and nested
 * overlaps all do. Cancelled and rejected rows are excluded by the state
 * filter, so cancelling frees the slot immediately.
 */
export async function findOverlaps(
  expertId: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string,
) {
  let query = db()
    .from("bookings")
    .select("*")
    .eq("expert_id", expertId)
    .in("state", ACTIVE_STATES as unknown as string[])
    .overlaps("time_range", `[${startTime},${endTime})`);
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data, error } = await query;
  fail(error, "detect overlaps");
  return (data ?? []) as Db[];
}

async function conflictFingerprint(expertId: string, bookingIds: string[]) {
  return digestOf({ expertId, bookingIds: [...bookingIds].sort() });
}

async function upsertConflict(
  expertId: string,
  members: Db[],
  correlationId: string,
): Promise<Db> {
  const ids = members.map((m) => m.id as string);
  const fingerprint = await conflictFingerprint(expertId, ids);
  const windowStart = members.reduce(
    (min, m) => (m.start_time < min ? m.start_time : min),
    members[0]!.start_time,
  );
  const windowEnd = members.reduce(
    (max, m) => (m.end_time > max ? m.end_time : max),
    members[0]!.end_time,
  );

  const { data: existing } = await db()
    .from("conflicts")
    .select("*")
    .eq("fingerprint", fingerprint)
    .eq("status", "OPEN")
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await db()
    .from("conflicts")
    .insert({
      expert_id: expertId,
      window_start: windowStart,
      window_end: windowEnd,
      fingerprint,
      correlation_id: correlationId,
    })
    .select("*")
    .single();
  fail(error, "create conflict");

  const anchor = members[0]!;
  const rows = members.map((m) => ({
    conflict_id: data.id,
    booking_id: m.id,
    overlap_kind:
      classifyOverlap(
        { start: Date.parse(anchor.start_time), end: Date.parse(anchor.end_time) },
        { start: Date.parse(m.start_time), end: Date.parse(m.end_time) },
      ) ?? "PARTIAL",
  }));
  const { error: memberError } = await db().from("conflict_members").insert(rows);
  if (memberError && memberError.code !== "23505") fail(memberError, "record conflict members");
  return data;
}

/* ------------------------------------------------------------- engine inputs */

async function buildCandidates(bookings: Db[], expert: Db): Promise<Candidate[]> {
  const { data: availability } = await db()
    .from("expert_availability")
    .select("day_of_week, start_minute, end_minute")
    .eq("expert_id", expert.id);

  return bookings.map((b) => {
    const start = new Date(b.start_time);
    const localHour = localHourIn(b.start_time, expert.timezone ?? "UTC");
    const minuteOfDay = localHour * 60 + start.getUTCMinutes();
    const dow = start.getUTCDay();
    const within = (availability ?? []).some(
      (w: Db) =>
        w.day_of_week === dow &&
        minuteOfDay >= w.start_minute &&
        minuteOfDay < w.end_minute,
    );
    return {
      bookingId: b.id as string,
      priority: b.priority as Priority,
      sessionType: b.session_type as SessionType,
      expertSuccessRate: Number(expert.success_rate ?? 0.8),
      userCompletionRate: Number(b.user_completion_rate ?? 0.8),
      localStartHour: localHour,
      withinAvailability: within,
      logicalSequence: Number(b.logical_sequence ?? 0),
      occurredAt: new Date(b.created_at).toISOString(),
    } satisfies Candidate;
  });
}

/* ------------------------------------------------------------ resolve command */

export interface ResolveOptions {
  actorId: string | null;
  requestId: string;
  correlationId: string;
  /** dry run computes and returns the decision without touching booking state */
  dryRun?: boolean;
  /** replay uses the configuration version recorded at decision time */
  configurationVersion?: number;
}

export async function resolveConflictById(conflictId: string, options: ResolveOptions) {
  const { data: conflict, error } = await db()
    .from("conflicts")
    .select("*")
    .eq("id", conflictId)
    .maybeSingle();
  fail(error, "load conflict");
  if (!conflict) throw new DomainError("NOT_FOUND", "Conflict not found", { conflictId });
  if (conflict.status !== "OPEN" && !options.dryRun)
    throw new DomainError("CONFLICT_ALREADY_RESOLVED", "Conflict is not open", { conflictId });

  const { data: members } = await db()
    .from("conflict_members")
    .select("booking_id")
    .eq("conflict_id", conflictId);
  const ids = (members ?? []).map((m: Db) => m.booking_id as string);

  const { data: bookings } = await db()
    .from("bookings")
    .select("*")
    .in("id", ids)
    .in("state", ACTIVE_STATES as unknown as string[]);

  const active = (bookings ?? []) as Db[];
  if (active.length === 0) {
    if (!options.dryRun) await markConflictResolved(conflictId, "STALE");
    return { conflict, result: null, applied: false };
  }

  const { data: expert } = await db()
    .from("experts")
    .select("*")
    .eq("id", conflict.expert_id)
    .single();

  const config = options.configurationVersion
    ? await getConfigVersion(options.configurationVersion)
    : await getActiveConfig();
  const candidates = await buildCandidates(active, expert);
  const inputDigest = await digestOf({ candidates, config });

  await appendEvent({
    type: "ResolutionRequested",
    aggregateId: conflictId,
    aggregateType: "conflict",
    aggregateVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "WEB",
    correlationId: options.correlationId,
    actorId: options.actorId,
    payload: { conflictId, dryRun: !!options.dryRun, candidates: candidates.length },
    configurationVersion: config.version,
  }).catch(() => undefined);

  const result: ResolutionResult = runEngine(candidates, config);

  if (options.dryRun) {
    return { conflict, result, applied: false, inputDigest };
  }

  // Persist decisions, then apply outcomes. Reject losers before confirming the
  // winner so the exclusion constraint can never see two overlapping CONFIRMED.
  const decisionIds = new Map<string, string>();
  for (const decision of result.decisions) {
    const { data, error: decisionError } = await db()
      .from("resolution_decisions")
      .upsert(
        {
          conflict_id: conflictId,
          booking_id: decision.bookingId,
          outcome: decision.outcome,
          final_score: decision.finalScore,
          confidence: decision.confidence,
          configuration_version: config.version,
          reasoning: decision.reasoning,
          tie_breaker: decision.tieBreaker,
          rank: decision.rank,
          engine_version: ENGINE_VERSION,
          input_digest: inputDigest,
          is_replay: false,
          correlation_id: options.correlationId,
        },
        { onConflict: "conflict_id,booking_id,is_replay" },
      )
      .select("id")
      .single();
    fail(decisionError, "persist decision");
    decisionIds.set(decision.bookingId, data.id as string);
  }

  await appendEvent({
    type: "ResolutionCalculated",
    aggregateId: conflictId,
    aggregateType: "conflict",
    aggregateVersion: 2,
    occurredAt: new Date().toISOString(),
    source: "WEB",
    correlationId: options.correlationId,
    actorId: options.actorId,
    payload: { ordering: result.ordering, decisions: result.decisions },
    configurationVersion: config.version,
  }).catch(() => undefined);

  const losers = result.decisions.filter((d) => d.outcome === "REJECTED");
  const winner = result.decisions.find((d) => d.outcome === "CONFIRMED")!;

  for (const loser of losers) {
    const booking = active.find((b) => b.id === loser.bookingId)!;
    await applyTransition({
      bookingId: loser.bookingId,
      expectedVersion: booking.version,
      to: "REJECTED",
      actorId: options.actorId,
      requestId: options.requestId,
      correlationId: options.correlationId,
      eventType: "BookingRejected",
      occurredAt: new Date().toISOString(),
      source: booking.source,
      reason: {
        reason: "LOST_CONFLICT_RESOLUTION",
        score: loser.finalScore,
        rank: loser.rank,
        tieBreaker: loser.tieBreaker,
      },
      configurationVersion: config.version,
      decisionId: decisionIds.get(loser.bookingId) ?? null,
      conflictId,
    });
  }

  const winnerBooking = active.find((b) => b.id === winner.bookingId)!;
  if (winnerBooking.state !== "CONFIRMED") {
    await applyTransition({
      bookingId: winner.bookingId,
      expectedVersion: winnerBooking.version,
      to: "CONFIRMED",
      actorId: options.actorId,
      requestId: options.requestId,
      correlationId: options.correlationId,
      eventType: "BookingConfirmed",
      occurredAt: new Date().toISOString(),
      source: winnerBooking.source,
      reason: {
        reason: "WON_CONFLICT_RESOLUTION",
        score: winner.finalScore,
        confidence: winner.confidence,
      },
      configurationVersion: config.version,
      decisionId: decisionIds.get(winner.bookingId) ?? null,
      conflictId,
    });
  }

  await markConflictResolved(conflictId, "RESOLVED");
  await appendAudit({
    action: "conflict.resolved",
    actorId: options.actorId,
    expertId: conflict.expert_id,
    conflictId,
    bookingId: winner.bookingId,
    decisionId: decisionIds.get(winner.bookingId) ?? null,
    decisionData: { decisions: result.decisions, ordering: result.ordering, inputDigest },
    score: winner.finalScore,
    configurationVersion: config.version,
    requestId: options.requestId,
    correlationId: options.correlationId,
  });

  return { conflict, result, applied: true, inputDigest };
}

async function markConflictResolved(conflictId: string, status: "RESOLVED" | "STALE") {
  const { error } = await db()
    .from("conflicts")
    .update({ status, resolved_at: new Date().toISOString() })
    .eq("id", conflictId);
  fail(error, "close conflict");
}

/* ------------------------------------------------------- idempotency wrapper */

/**
 * Idempotency is enforced by the primary key on idempotency_keys. The first
 * request wins the insert and runs the command; a retry either replays the
 * stored response (same digest) or is rejected as a key reuse with different
 * parameters. A crashed in-flight request leaves an IN_PROGRESS row, which is
 * reported rather than silently duplicated.
 */
export async function withIdempotency<T>(
  key: string | null,
  scope: string,
  actorId: string | null,
  request: unknown,
  run: () => Promise<T>,
): Promise<T> {
  if (!key) return run();
  const requestDigest = await digestOf(request);

  const { error } = await db()
    .from("idempotency_keys")
    .insert({ key, scope, actor_id: actorId, request_digest: requestDigest });

  if (error) {
    if (error.code !== "23505") fail(error, "reserve idempotency key");
    const { data: existing } = await db()
      .from("idempotency_keys")
      .select("*")
      .eq("key", key)
      .maybeSingle();
    if (!existing) throw new DomainError("INTERNAL_ERROR", "Idempotency race");
    if (existing.request_digest !== requestDigest)
      throw new DomainError(
        "IDEMPOTENCY_MISMATCH",
        "This idempotency key was already used with different parameters",
        { key },
      );
    if (existing.status === "COMPLETED") return existing.response as T;
    throw new DomainError("DUPLICATE_REQUEST", "An identical request is still in progress", {
      key,
    });
  }

  try {
    const result = await run();
    await db()
      .from("idempotency_keys")
      .update({
        status: "COMPLETED",
        response: result as Record<string, unknown>,
        completed_at: new Date().toISOString(),
      })
      .eq("key", key);
    return result;
  } catch (e) {
    await db().from("idempotency_keys").delete().eq("key", key);
    throw e;
  }
}

/* ------------------------------------------------------------ create command */

export interface CreateBookingInput {
  expertId: string;
  startTime: string;
  endTime: string;
  sessionType: SessionType;
  priority: Priority;
  source: BookingSource;
  clientTimezone: string;
  notes: string;
  /** logical occurrence time from the source; defaults to receipt time */
  occurredAt?: string;
}

export async function createBooking(
  input: CreateBookingInput,
  ctx: { actorId: string; requestId: string; correlationId: string },
) {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (Date.parse(input.endTime) <= Date.parse(input.startTime))
    throw new DomainError("INVALID_BOOKING_WINDOW", "End time must be after start time");

  const { data: expert, error: expertError } = await db()
    .from("experts")
    .select("*")
    .eq("id", input.expertId)
    .maybeSingle();
  fail(expertError, "load expert");
  if (!expert || !expert.active)
    throw new DomainError("INVALID_EXPERT", "Expert not found or inactive", {
      expertId: input.expertId,
    });

  const { data: booking, error } = await db()
    .from("bookings")
    .insert({
      expert_id: input.expertId,
      requester_id: ctx.actorId,
      session_type: input.sessionType,
      priority: input.priority,
      source: input.source,
      start_time: input.startTime,
      end_time: input.endTime,
      client_timezone: input.clientTimezone,
      notes: input.notes,
      correlation_id: ctx.correlationId,
      logical_sequence: Date.parse(occurredAt),
    })
    .select("*")
    .single();
  fail(error, "create booking");

  const { eventId } = await appendEvent({
    type: "BookingCreated",
    aggregateId: booking.id,
    aggregateVersion: 1,
    occurredAt,
    source: input.source,
    correlationId: ctx.correlationId,
    actorId: ctx.actorId,
    payload: { ...input, requesterId: ctx.actorId },
  });
  await snapshotVersion(booking, eventId, ctx.actorId);
  await appendAudit({
    action: "booking.created",
    actorId: ctx.actorId,
    bookingId: booking.id,
    expertId: input.expertId,
    eventId,
    newState: "PENDING",
    inputData: input as unknown as Record<string, unknown>,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  });

  const overlaps = await findOverlaps(input.expertId, input.startTime, input.endTime, booking.id);

  if (overlaps.length === 0) {
    const confirmed = await applyTransition({
      bookingId: booking.id,
      expectedVersion: booking.version,
      to: "CONFIRMED",
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      correlationId: ctx.correlationId,
      eventType: "BookingConfirmed",
      occurredAt,
      source: input.source,
      reason: { reason: "NO_CONFLICT" },
    });
    return { booking: confirmed, conflictId: null, resolution: null };
  }

  const members = [booking, ...overlaps];
  const conflict = await upsertConflict(input.expertId, members, ctx.correlationId);
  const { eventId: conflictEventId } = await appendEvent({
    type: "ConflictDetected",
    aggregateId: conflict.id,
    aggregateType: "conflict",
    aggregateVersion: 0,
    occurredAt,
    source: input.source,
    correlationId: ctx.correlationId,
    actorId: ctx.actorId,
    payload: { expertId: input.expertId, bookingIds: members.map((m) => m.id) },
  });
  await appendAudit({
    action: "conflict.detected",
    actorId: ctx.actorId,
    expertId: input.expertId,
    bookingId: booking.id,
    conflictId: conflict.id,
    eventId: conflictEventId,
    inputData: { bookingIds: members.map((m) => m.id) },
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  });

  const resolution = await resolveConflictById(conflict.id, {
    actorId: ctx.actorId,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
  });

  const { data: finalBooking } = await db()
    .from("bookings")
    .select("*")
    .eq("id", booking.id)
    .single();

  return {
    booking: finalBooking,
    conflictId: conflict.id,
    resolution: resolution.result,
  };
}

/* ------------------------------------------------------------ cancel command */

export async function cancelBooking(
  bookingId: string,
  expectedVersion: number | null,
  ctx: { actorId: string; requestId: string; correlationId: string; isStaff: boolean },
) {
  const { data: booking, error } = await db()
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  fail(error, "load booking");
  if (!booking) throw new DomainError("NOT_FOUND", "Booking not found", { bookingId });
  if (booking.requester_id !== ctx.actorId && !ctx.isStaff)
    throw new DomainError("FORBIDDEN", "You cannot cancel this booking");

  const cancelled = await applyTransition({
    bookingId,
    expectedVersion: expectedVersion ?? booking.version,
    to: "CANCELLED",
    actorId: ctx.actorId,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    eventType: "BookingCancelled",
    occurredAt: new Date().toISOString(),
    source: booking.source,
    reason: { reason: "CANCELLED_BY_ACTOR" },
  });

  // Cancelling can free a slot: any open conflict this booking belonged to is
  // re-resolved so a previously rejected booking is not stranded.
  const { data: memberships } = await db()
    .from("conflict_members")
    .select("conflict_id, conflicts!inner(status)")
    .eq("booking_id", bookingId);
  for (const m of (memberships ?? []) as Db[]) {
    if (m.conflicts?.status === "OPEN") {
      await resolveConflictById(m.conflict_id, {
        actorId: ctx.actorId,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
      }).catch(() => undefined);
    }
  }

  return cancelled;
}

/* ---------------------------------------------------------------- audit read */

export async function verifyAuditChain(limit = 500) {
  const { data } = await db()
    .from("audit_records")
    .select("*")
    .order("sequence", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as Db[];
  let previousHash: string | null = null;
  const broken: string[] = [];
  for (const row of rows) {
    const expected = await digestOf({
      previousHash,
      body: {
        action: row.action,
        actor_id: row.actor_id,
        booking_id: row.booking_id,
        conflict_id: row.conflict_id,
        decision_id: row.decision_id,
        event_id: row.event_id,
        previous_state: row.previous_state,
        new_state: row.new_state,
        input_data: row.input_data,
        decision_data: row.decision_data,
        score: row.score === null ? null : Number(row.score),
        configuration_version: row.configuration_version,
        correlation_id: row.correlation_id,
        request_id: row.request_id,
      },
    });
    if (expected !== row.record_hash) broken.push(row.id as string);
    previousHash = row.record_hash;
  }
  return { checked: rows.length, broken };
}
