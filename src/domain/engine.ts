/**
 * Deterministic resolution engine.
 *
 * Rules of the house:
 *  - No randomness, no Date.now(), no I/O, no external services.
 *  - Every input is passed in explicitly, including "now" when needed.
 *  - Identical (candidates + configuration) always produces identical output,
 *    which is what makes replay verifiable.
 *
 * Scoring is weighted-normalised rather than additive-magic: each factor
 * produces a 0-100 raw score, the configuration assigns a weight, and the
 * final score is sum(weight * raw). Weights are declared in the DB config row
 * and versioned, so a historical decision can be recomputed exactly.
 */

import {
  PRIORITY_RANK,
  SESSION_TYPE_RANK,
  type Priority,
  type SessionType,
} from "./types";

export interface EngineConfig {
  version: number;
  weights: {
    priority: { weight: number; values: Record<Priority, number> };
    session_type: { weight: number; values: Record<SessionType, number> };
    expert: { weight: number };
    user: { weight: number };
    time_of_day: { weight: number; buckets: Record<TimeBucket, number> };
    availability: { weight: number; values: { within: number; outside: number } };
    confidence: { min_margin: number; max_margin: number; floor: number };
  };
  tieBreakers: readonly TieBreaker[];
}

export type TimeBucket = "business" | "shoulder" | "off_hours";

export type TieBreaker =
  | "final_score_desc"
  | "priority_rank_desc"
  | "session_type_rank_desc"
  | "logical_sequence_asc"
  | "occurred_at_asc"
  | "booking_id_asc";

/** Everything the engine is allowed to look at for one booking. */
export interface Candidate {
  bookingId: string;
  priority: Priority;
  sessionType: SessionType;
  expertSuccessRate: number; // 0..1
  userCompletionRate: number; // 0..1
  /** Hour-of-day (0-23) in the expert's own timezone, resolved by the caller. */
  localStartHour: number;
  /** Whether the slot sits inside a declared availability window. */
  withinAvailability: boolean;
  /** Logical ordering position from the event log — never arrival order. */
  logicalSequence: number;
  /** Logical occurrence time, persisted with the creating event. */
  occurredAt: string;
}

export interface FactorTrace {
  factor: string;
  input: string | number | boolean;
  raw: number; // 0..100 normalised factor score
  weight: number;
  contribution: number; // weight * raw, rounded to 3dp
}

export interface CandidateScore {
  bookingId: string;
  finalScore: number;
  reasoning: FactorTrace[];
  inputs: Candidate;
}

export interface TieBreakerTrace {
  applied: TieBreaker;
  comparedWith: string;
  explanation: string;
}

export interface DecisionRecord {
  bookingId: string;
  rank: number;
  outcome: "CONFIRMED" | "REJECTED";
  finalScore: number;
  confidence: number;
  reasoning: FactorTrace[];
  tieBreaker: TieBreakerTrace | null;
}

export interface ResolutionResult {
  configurationVersion: number;
  engineVersion: string;
  decisions: DecisionRecord[];
  /** Sorted candidate ids, useful for assertions in tests and replay diffing. */
  ordering: string[];
}

export const ENGINE_VERSION = "engine-1.0.0";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function timeBucket(localHour: number): TimeBucket {
  if (localHour >= 9 && localHour < 17) return "business";
  if ((localHour >= 7 && localHour < 9) || (localHour >= 17 && localHour < 20))
    return "shoulder";
  return "off_hours";
}

/** Hour-of-day in an IANA timezone. Deterministic: derived only from inputs. */
export function localHourIn(iso: string, timeZone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    });
    return Number.parseInt(fmt.format(new Date(iso)), 10) % 24;
  } catch {
    return new Date(iso).getUTCHours();
  }
}

export function scoreCandidate(candidate: Candidate, config: EngineConfig): CandidateScore {
  const w = config.weights;
  const bucket = timeBucket(candidate.localStartHour);

  const factors: Array<Omit<FactorTrace, "contribution">> = [
    {
      factor: "priority",
      input: candidate.priority,
      raw: w.priority.values[candidate.priority] ?? 0,
      weight: w.priority.weight,
    },
    {
      factor: "session_type",
      input: candidate.sessionType,
      raw: w.session_type.values[candidate.sessionType] ?? 0,
      weight: w.session_type.weight,
    },
    {
      factor: "expert_success_rate",
      input: candidate.expertSuccessRate,
      raw: clamp01(candidate.expertSuccessRate) * 100,
      weight: w.expert.weight,
    },
    {
      factor: "user_completion_rate",
      input: candidate.userCompletionRate,
      raw: clamp01(candidate.userCompletionRate) * 100,
      weight: w.user.weight,
    },
    {
      factor: "time_of_day",
      input: `${String(candidate.localStartHour).padStart(2, "0")}:00 (${bucket})`,
      raw: w.time_of_day.buckets[bucket] ?? 0,
      weight: w.time_of_day.weight,
    },
    {
      factor: "availability",
      input: candidate.withinAvailability ? "within" : "outside",
      raw: candidate.withinAvailability
        ? w.availability.values.within
        : w.availability.values.outside,
      weight: w.availability.weight,
    },
  ];

  const reasoning: FactorTrace[] = factors.map((f) => ({
    ...f,
    raw: round3(f.raw),
    contribution: round3(f.weight * f.raw),
  }));

  const finalScore = round3(reasoning.reduce((sum, f) => sum + f.contribution, 0));
  return { bookingId: candidate.bookingId, finalScore, reasoning, inputs: candidate };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

interface Comparison {
  cmp: number;
  breaker: TieBreaker;
  explanation: string;
}

function compareBy(
  breaker: TieBreaker,
  a: CandidateScore,
  b: CandidateScore,
): Comparison {
  switch (breaker) {
    case "final_score_desc":
      return {
        cmp: b.finalScore - a.finalScore,
        breaker,
        explanation: `score ${a.finalScore} vs ${b.finalScore}`,
      };
    case "priority_rank_desc":
      return {
        cmp: PRIORITY_RANK[b.inputs.priority] - PRIORITY_RANK[a.inputs.priority],
        breaker,
        explanation: `priority ${a.inputs.priority} vs ${b.inputs.priority}`,
      };
    case "session_type_rank_desc":
      return {
        cmp:
          SESSION_TYPE_RANK[b.inputs.sessionType] -
          SESSION_TYPE_RANK[a.inputs.sessionType],
        breaker,
        explanation: `session type ${a.inputs.sessionType} vs ${b.inputs.sessionType}`,
      };
    case "logical_sequence_asc":
      return {
        cmp: a.inputs.logicalSequence - b.inputs.logicalSequence,
        breaker,
        explanation: `logical sequence ${a.inputs.logicalSequence} vs ${b.inputs.logicalSequence}`,
      };
    case "occurred_at_asc":
      return {
        cmp: a.inputs.occurredAt < b.inputs.occurredAt ? -1 : a.inputs.occurredAt > b.inputs.occurredAt ? 1 : 0,
        breaker,
        explanation: `logical timestamp ${a.inputs.occurredAt} vs ${b.inputs.occurredAt}`,
      };
    case "booking_id_asc":
      return {
        cmp: a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0,
        breaker,
        explanation: `booking id ordering ${a.bookingId} vs ${b.bookingId}`,
      };
  }
}

/**
 * Total order over candidates. `booking_id_asc` is always applied last so the
 * comparator can never return 0 for two distinct bookings — no reliance on
 * database row order or arrival order anywhere.
 */
export function rankCandidates(
  scores: CandidateScore[],
  config: EngineConfig,
): { ordered: CandidateScore[]; breakers: Map<string, TieBreakerTrace> } {
  const chain: TieBreaker[] = [...config.tieBreakers];
  if (!chain.includes("booking_id_asc")) chain.push("booking_id_asc");

  const breakers = new Map<string, TieBreakerTrace>();

  const ordered = [...scores].sort((a, b) => {
    for (const breaker of chain) {
      const { cmp, explanation } = compareBy(breaker, a, b);
      if (cmp !== 0) {
        // Record only when the primary factor failed to separate them.
        if (breaker !== chain[0]) {
          const loser = cmp < 0 ? b : a;
          breakers.set(loser.bookingId, {
            applied: breaker,
            comparedWith: (cmp < 0 ? a : b).bookingId,
            explanation: `separated on ${breaker}: ${explanation}`,
          });
        }
        return cmp;
      }
    }
    return 0;
  });

  return { ordered, breakers };
}

/**
 * Confidence is the normalised margin between the winner and the runner-up:
 * a landslide is high confidence, a photo finish is near the floor. A single
 * candidate is maximal confidence. This is a derived statistic, never an input.
 */
export function confidenceFor(
  ordered: CandidateScore[],
  config: EngineConfig,
): number {
  const { min_margin, max_margin, floor } = config.weights.confidence;
  if (ordered.length < 2) return 1;
  const margin = Math.abs(ordered[0]!.finalScore - ordered[1]!.finalScore);
  if (margin <= min_margin) return round3(floor);
  const span = Math.max(max_margin - min_margin, 0.001);
  const scaled = floor + ((1 - floor) * Math.min(margin - min_margin, span)) / span;
  return round3(Math.min(1, scaled));
}

/**
 * Resolve one conflict group: exactly one winner is CONFIRMED, every other
 * active candidate is REJECTED. Pure function — the caller persists the result.
 */
export function resolveConflict(
  candidates: Candidate[],
  config: EngineConfig,
): ResolutionResult {
  const scores = candidates.map((c) => scoreCandidate(c, config));
  const { ordered, breakers } = rankCandidates(scores, config);
  const confidence = confidenceFor(ordered, config);

  const decisions: DecisionRecord[] = ordered.map((score, index) => ({
    bookingId: score.bookingId,
    rank: index + 1,
    outcome: index === 0 ? "CONFIRMED" : "REJECTED",
    finalScore: score.finalScore,
    confidence: index === 0 ? confidence : round3(confidence),
    reasoning: score.reasoning,
    tieBreaker: breakers.get(score.bookingId) ?? null,
  }));

  return {
    configurationVersion: config.version,
    engineVersion: ENGINE_VERSION,
    decisions,
    ordering: ordered.map((o) => o.bookingId),
  };
}

/** Parse a persisted config row into the engine's typed shape. */
export function parseConfig(row: {
  version: number;
  weights: unknown;
  tie_breakers: string[];
}): EngineConfig {
  return {
    version: row.version,
    weights: row.weights as EngineConfig["weights"],
    tieBreakers: row.tie_breakers as TieBreaker[],
  };
}
