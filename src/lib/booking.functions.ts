/**
 * Transport layer: typed RPC over the application services.
 * Thin by design — validation, identity, and error shaping only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const isoDate = z.string().min(10).refine((v) => !Number.isNaN(Date.parse(v)), "invalid timestamp");

const createSchema = z.object({
  expertId: z.string().uuid(),
  startTime: isoDate,
  endTime: isoDate,
  sessionType: z.enum(["EMERGENCY", "PRIORITY", "ROUTINE"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  source: z.enum(["WEB", "MOBILE", "PARTNER_API", "IMPORT", "ADMIN"]).default("WEB"),
  clientTimezone: z.string().min(1).max(64).default("UTC"),
  notes: z.string().max(2000).default(""),
  occurredAt: isoDate.optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

function toApiError(error: unknown) {
  const e = error as { code?: string; message?: string; details?: unknown };
  if (e && typeof e.code === "string") {
    return { error: { code: e.code, message: e.message ?? "Request failed", details: e.details ?? {} } };
  }
  console.error("[booking] unhandled", error);
  return { error: { code: "INTERNAL_ERROR", message: "Unexpected server error", details: {} } };
}

export const createBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createBooking, withIdempotency } = await import("./booking.server");
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const { idempotencyKey, ...input } = data;
    try {
      const result = await withIdempotency(
        idempotencyKey ?? null,
        "booking.create",
        context.userId,
        { ...input, actor: context.userId },
        () => createBooking(input, { actorId: context.userId, requestId, correlationId }),
      );
      return { data: result, requestId, correlationId };
    } catch (error) {
      return { ...toApiError(error), requestId, correlationId };
    }
  });

export const cancelBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bookingId: z.string().uuid(), expectedVersion: z.number().int().positive().nullable().default(null) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { cancelBooking } = await import("./booking.server");
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    try {
      const booking = await cancelBooking(data.bookingId, data.expectedVersion, {
        actorId: context.userId,
        requestId,
        correlationId,
        isStaff: !!isStaff,
      });
      return { data: booking, requestId };
    } catch (error) {
      return { ...toApiError(error), requestId };
    }
  });

export const resolveConflictFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conflictId: z.string().uuid(), dryRun: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveConflictById } = await import("./booking.server");
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    try {
      const result = await resolveConflictById(data.conflictId, {
        actorId: context.userId,
        requestId,
        correlationId,
        dryRun: data.dryRun,
      });
      return { data: { applied: result.applied, result: result.result }, requestId };
    } catch (error) {
      return { ...toApiError(error), requestId };
    }
  });

export const listExpertsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("experts")
      .select("id, display_name, domain, title, timezone, success_rate")
      .eq("active", true)
      .order("display_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const dashboardFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [bookings, conflicts, decisions, config] = await Promise.all([
      sb
        .from("bookings")
        .select("id, state, start_time, end_time, priority, session_type, version, expert_id, experts(display_name, domain)")
        .order("created_at", { ascending: false })
        .limit(50),
      sb
        .from("conflicts")
        .select("id, status, window_start, window_end, detected_at, expert_id, experts(display_name)")
        .order("detected_at", { ascending: false })
        .limit(25),
      sb
        .from("resolution_decisions")
        .select("id, booking_id, conflict_id, outcome, final_score, confidence, configuration_version, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      sb.from("resolution_configs").select("version, tie_breakers").eq("active", true).maybeSingle(),
    ]);

    const rows = bookings.data ?? [];
    const counts = rows.reduce<Record<string, number>>((acc, b) => {
      acc[b.state] = (acc[b.state] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totals: {
        total: rows.length,
        confirmed: counts["CONFIRMED"] ?? 0,
        rejected: counts["REJECTED"] ?? 0,
        pending: counts["PENDING"] ?? 0,
        cancelled: counts["CANCELLED"] ?? 0,
        openConflicts: (conflicts.data ?? []).filter((c) => c.status === "OPEN").length,
      },
      bookings: rows,
      conflicts: conflicts.data ?? [],
      decisions: decisions.data ?? [],
      configVersion: config.data?.version ?? null,
      tieBreakers: (config.data?.tie_breakers as string[] | undefined) ?? [],
    };
  });

export const getBookingFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [booking, events, versions, decisions, audit, members] = await Promise.all([
      sb
        .from("bookings")
        .select("*, experts(display_name, domain, timezone, success_rate)")
        .eq("id", data.id)
        .maybeSingle(),
      sb
        .from("events")
        .select("*")
        .eq("aggregate_id", data.id)
        .order("logical_sequence", { ascending: true }),
      sb
        .from("booking_versions")
        .select("version, state, created_at, event_id")
        .eq("booking_id", data.id)
        .order("version", { ascending: true }),
      sb
        .from("resolution_decisions")
        .select("*")
        .eq("booking_id", data.id)
        .order("created_at", { ascending: false }),
      sb
        .from("audit_records")
        .select("*")
        .eq("booking_id", data.id)
        .order("sequence", { ascending: true }),
      sb.from("conflict_members").select("conflict_id, overlap_kind").eq("booking_id", data.id),
    ]);

    if (!booking.data) throw new Error("NOT_FOUND");
    return {
      booking: booking.data,
      events: events.data ?? [],
      versions: versions.data ?? [],
      decisions: decisions.data ?? [],
      audit: audit.data ?? [],
      conflicts: members.data ?? [],
    };
  });

export const listConflictsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conflicts")
      .select(
        "id, status, window_start, window_end, detected_at, resolved_at, expert_id, experts(display_name, domain), conflict_members(booking_id, overlap_kind)",
      )
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getConflictFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const conflict = await sb
      .from("conflicts")
      .select("*, experts(display_name, domain, timezone)")
      .eq("id", data.id)
      .maybeSingle();
    if (!conflict.data) throw new Error("NOT_FOUND");

    const members = await sb
      .from("conflict_members")
      .select("booking_id, overlap_kind")
      .eq("conflict_id", data.id);
    const ids = (members.data ?? []).map((m) => m.booking_id);

    const [bookings, decisions, events, audit] = await Promise.all([
      ids.length
        ? sb
            .from("bookings")
            .select("id, state, start_time, end_time, priority, session_type, source, version, requester_id, user_completion_rate, logical_sequence, created_at")
            .in("id", ids)
        : Promise.resolve({ data: [] as never[] }),
      sb.from("resolution_decisions").select("*").eq("conflict_id", data.id).order("rank"),
      sb
        .from("events")
        .select("*")
        .eq("aggregate_id", data.id)
        .order("logical_sequence", { ascending: true }),
      sb.from("audit_records").select("*").eq("conflict_id", data.id).order("sequence"),
    ]);

    return {
      conflict: conflict.data,
      members: members.data ?? [],
      bookings: bookings.data ?? [],
      decisions: decisions.data ?? [],
      events: events.data ?? [],
      audit: audit.data ?? [],
    };
  });

export const verifyAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) return { error: { code: "FORBIDDEN", message: "Auditor or admin role required", details: {} } };
    const { verifyAuditChain } = await import("./booking.server");
    return { data: await verifyAuditChain() };
  });
