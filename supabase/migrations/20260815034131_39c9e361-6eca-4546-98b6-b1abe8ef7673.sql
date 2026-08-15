-- ============================================================
-- Consultation Booking Platform — core schema
-- ============================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- enums ----------
CREATE TYPE public.app_role       AS ENUM ('user','expert','auditor','admin');
CREATE TYPE public.expert_domain  AS ENUM ('HEALTHCARE','FINANCE','TECHNOLOGY');
CREATE TYPE public.booking_state  AS ENUM ('PENDING','CONFIRMED','REJECTED','RESCHEDULED','CANCELLED');
CREATE TYPE public.booking_priority AS ENUM ('HIGH','MEDIUM','LOW');
CREATE TYPE public.session_type   AS ENUM ('EMERGENCY','PRIORITY','ROUTINE');
CREATE TYPE public.booking_source AS ENUM ('WEB','MOBILE','PARTNER_API','IMPORT','ADMIN');
CREATE TYPE public.conflict_status AS ENUM ('OPEN','RESOLVED','STALE');

-- ---------- profiles ----------
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY,
  email       text,
  full_name   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------- roles ----------
CREATE TABLE public.user_roles (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL,
  role      public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('admin','auditor'))
$$;

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- signup hook ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- experts ----------
CREATE TABLE public.experts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid,
  display_name  text NOT NULL,
  domain        public.expert_domain NOT NULL,
  title         text NOT NULL DEFAULT '',
  bio           text NOT NULL DEFAULT '',
  timezone      text NOT NULL DEFAULT 'UTC',
  success_rate  numeric(4,3) NOT NULL DEFAULT 0.800 CHECK (success_rate >= 0 AND success_rate <= 1),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_experts_domain ON public.experts (domain) WHERE active;
GRANT SELECT ON public.experts TO authenticated;
GRANT ALL ON public.experts TO service_role;
ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_experts_touch BEFORE UPDATE ON public.experts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- availability ----------
CREATE TABLE public.expert_availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id  uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute   integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_window_valid CHECK (end_minute > start_minute)
);
CREATE INDEX idx_availability_expert ON public.expert_availability (expert_id, day_of_week);
GRANT SELECT ON public.expert_availability TO authenticated;
GRANT ALL ON public.expert_availability TO service_role;
ALTER TABLE public.expert_availability ENABLE ROW LEVEL SECURITY;

-- ---------- resolution configuration (immutable, versioned) ----------
CREATE TABLE public.resolution_configs (
  version      integer PRIMARY KEY,
  weights      jsonb NOT NULL,
  tie_breakers text[] NOT NULL,
  notes        text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_config_single_active ON public.resolution_configs (active) WHERE active;
GRANT SELECT ON public.resolution_configs TO authenticated;
GRANT ALL ON public.resolution_configs TO service_role;
ALTER TABLE public.resolution_configs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.resolution_configs (version, weights, tie_breakers, notes, active) VALUES
(1, '{
  "priority":     {"weight": 0.30, "values": {"HIGH": 100, "MEDIUM": 60, "LOW": 25}},
  "session_type": {"weight": 0.25, "values": {"EMERGENCY": 100, "PRIORITY": 65, "ROUTINE": 30}},
  "expert":       {"weight": 0.15},
  "user":         {"weight": 0.15},
  "time_of_day":  {"weight": 0.10, "buckets": {"business": 100, "shoulder": 65, "off_hours": 30}},
  "availability": {"weight": 0.05, "values": {"within": 100, "outside": 0}},
  "confidence":   {"min_margin": 2.0, "max_margin": 40.0, "floor": 0.50}
}'::jsonb,
 ARRAY['final_score_desc','priority_rank_desc','session_type_rank_desc','logical_sequence_asc','booking_id_asc'],
 'Baseline MVP weight set. Weights sum to 1.0; each factor is normalised to 0-100.',
 true);

-- ---------- bookings ----------
CREATE TABLE public.bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id      uuid NOT NULL REFERENCES public.experts(id) ON DELETE RESTRICT,
  requester_id   uuid NOT NULL,
  session_type   public.session_type NOT NULL DEFAULT 'ROUTINE',
  priority       public.booking_priority NOT NULL DEFAULT 'MEDIUM',
  source         public.booking_source NOT NULL DEFAULT 'WEB',
  state          public.booking_state NOT NULL DEFAULT 'PENDING',
  start_time     timestamptz NOT NULL,
  end_time       timestamptz NOT NULL,
  client_timezone text NOT NULL DEFAULT 'UTC',
  notes          text NOT NULL DEFAULT '',
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  user_completion_rate numeric(4,3) NOT NULL DEFAULT 0.800,
  rescheduled_from uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  logical_sequence bigint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  time_range     tstzrange GENERATED ALWAYS AS (tstzrange(start_time, end_time, '[)')) STORED,
  CONSTRAINT booking_time_valid CHECK (end_time > start_time)
);
-- Hard invariant: two CONFIRMED bookings for one expert can never overlap.
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_confirmed_overlap
  EXCLUDE USING gist (expert_id WITH =, time_range WITH &&)
  WHERE (state = 'CONFIRMED');
CREATE INDEX idx_bookings_expert_range ON public.bookings USING gist (expert_id, time_range);
CREATE INDEX idx_bookings_requester ON public.bookings (requester_id, created_at DESC);
CREATE INDEX idx_bookings_state ON public.bookings (state, start_time);
CREATE INDEX idx_bookings_expert_start ON public.bookings (expert_id, start_time);
GRANT SELECT, INSERT ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_bookings_touch BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- state machine guard
CREATE OR REPLACE FUNCTION public.enforce_booking_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.state <> OLD.state THEN
    IF NOT (
      (OLD.state = 'PENDING'   AND NEW.state IN ('CONFIRMED','REJECTED','CANCELLED','RESCHEDULED')) OR
      (OLD.state = 'CONFIRMED' AND NEW.state IN ('CANCELLED','RESCHEDULED')) OR
      (OLD.state = 'RESCHEDULED' AND NEW.state IN ('CONFIRMED','REJECTED','CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION: % -> %', OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'VERSION_MISMATCH: expected %, got %', OLD.version + 1, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_bookings_transition BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_transition();

-- ---------- booking versions (immutable snapshots) ----------
CREATE TABLE public.booking_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  state       public.booking_state NOT NULL,
  snapshot    jsonb NOT NULL,
  event_id    uuid,
  changed_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, version)
);
CREATE INDEX idx_booking_versions_booking ON public.booking_versions (booking_id, version DESC);
GRANT SELECT ON public.booking_versions TO authenticated;
GRANT ALL ON public.booking_versions TO service_role;
ALTER TABLE public.booking_versions ENABLE ROW LEVEL SECURITY;

-- ---------- conflicts ----------
CREATE TABLE public.conflicts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_id    uuid NOT NULL REFERENCES public.experts(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  status       public.conflict_status NOT NULL DEFAULT 'OPEN',
  fingerprint  text NOT NULL,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  correlation_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_conflicts_open_fingerprint ON public.conflicts (fingerprint) WHERE status = 'OPEN';
CREATE INDEX idx_conflicts_expert ON public.conflicts (expert_id, status, detected_at DESC);
GRANT SELECT ON public.conflicts TO authenticated;
GRANT ALL ON public.conflicts TO service_role;
ALTER TABLE public.conflicts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_conflicts_touch BEFORE UPDATE ON public.conflicts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.conflict_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL REFERENCES public.conflicts(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  overlap_kind text NOT NULL DEFAULT 'PARTIAL',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conflict_id, booking_id)
);
CREATE INDEX idx_conflict_members_booking ON public.conflict_members (booking_id);
GRANT SELECT ON public.conflict_members TO authenticated;
GRANT ALL ON public.conflict_members TO service_role;
ALTER TABLE public.conflict_members ENABLE ROW LEVEL SECURITY;

-- ---------- resolution decisions ----------
CREATE TABLE public.resolution_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id   uuid NOT NULL REFERENCES public.conflicts(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  outcome       public.booking_state NOT NULL,
  final_score   numeric(7,3) NOT NULL,
  confidence    numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  configuration_version integer NOT NULL REFERENCES public.resolution_configs(version),
  reasoning     jsonb NOT NULL DEFAULT '[]'::jsonb,
  tie_breaker   jsonb,
  rank          integer NOT NULL DEFAULT 1,
  engine_version text NOT NULL DEFAULT 'engine-1.0.0',
  input_digest  text NOT NULL,
  is_replay     boolean NOT NULL DEFAULT false,
  correlation_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conflict_id, booking_id, is_replay)
);
CREATE INDEX idx_decisions_booking ON public.resolution_decisions (booking_id, created_at DESC);
CREATE INDEX idx_decisions_conflict ON public.resolution_decisions (conflict_id, rank);
GRANT SELECT ON public.resolution_decisions TO authenticated;
GRANT ALL ON public.resolution_decisions TO service_role;
ALTER TABLE public.resolution_decisions ENABLE ROW LEVEL SECURITY;

-- ---------- events (append-only) ----------
CREATE TABLE public.events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,
  aggregate_id   uuid NOT NULL,
  aggregate_type text NOT NULL DEFAULT 'booking',
  aggregate_version integer NOT NULL,
  logical_sequence bigint NOT NULL,
  occurred_at    timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  source         public.booking_source NOT NULL DEFAULT 'WEB',
  correlation_id uuid NOT NULL,
  causation_id   uuid,
  actor_id       uuid,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  configuration_version integer REFERENCES public.resolution_configs(version),
  dedupe_key     text NOT NULL,
  applied        boolean NOT NULL DEFAULT true,
  quarantine_reason text,
  UNIQUE (dedupe_key),
  UNIQUE (aggregate_type, aggregate_id, aggregate_version, event_type)
);
CREATE INDEX idx_events_aggregate ON public.events (aggregate_type, aggregate_id, logical_sequence, occurred_at, event_id);
CREATE INDEX idx_events_correlation ON public.events (correlation_id, logical_sequence);
CREATE INDEX idx_events_occurred ON public.events (occurred_at);
CREATE INDEX idx_events_type ON public.events (event_type, occurred_at DESC);
GRANT SELECT ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.block_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % rows cannot be modified or deleted', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END; $$;
CREATE TRIGGER trg_events_immutable BEFORE UPDATE OR DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.block_event_mutation();

-- ---------- audit records (hash-chained, immutable) ----------
CREATE TABLE public.audit_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence      bigserial NOT NULL,
  action        text NOT NULL,
  actor_id      uuid,
  actor_role    text,
  expert_id     uuid,
  booking_id    uuid,
  conflict_id   uuid,
  decision_id   uuid,
  event_id      uuid,
  previous_state public.booking_state,
  new_state     public.booking_state,
  input_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_data jsonb,
  score         numeric(7,3),
  configuration_version integer,
  request_id    uuid,
  correlation_id uuid,
  system_version text NOT NULL DEFAULT 'app-1.0.0',
  record_hash   text NOT NULL,
  previous_hash text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_booking ON public.audit_records (booking_id, sequence);
CREATE INDEX idx_audit_conflict ON public.audit_records (conflict_id, sequence);
CREATE INDEX idx_audit_correlation ON public.audit_records (correlation_id, sequence);
CREATE INDEX idx_audit_created ON public.audit_records (created_at DESC);
GRANT SELECT ON public.audit_records TO authenticated;
GRANT ALL ON public.audit_records TO service_role;
ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_records
FOR EACH ROW EXECUTE FUNCTION public.block_event_mutation();

-- ---------- idempotency ----------
CREATE TABLE public.idempotency_keys (
  key           text PRIMARY KEY,
  scope         text NOT NULL,
  actor_id      uuid,
  request_digest text NOT NULL,
  status        text NOT NULL DEFAULT 'IN_PROGRESS',
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX idx_idem_created ON public.idempotency_keys (created_at);
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- ---------- replay runs ----------
CREATE TABLE public.replay_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode         text NOT NULL,
  scope        jsonb NOT NULL DEFAULT '{}'::jsonb,
  dry_run      boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'RUNNING',
  events_loaded integer NOT NULL DEFAULT 0,
  events_deduplicated integer NOT NULL DEFAULT 0,
  events_quarantined integer NOT NULL DEFAULT 0,
  bookings_checked integer NOT NULL DEFAULT 0,
  mismatches   jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms  integer,
  requested_by uuid,
  correlation_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_replay_created ON public.replay_runs (created_at DESC);
GRANT SELECT ON public.replay_runs TO authenticated;
GRANT ALL ON public.replay_runs TO service_role;
ALTER TABLE public.replay_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Row level security policies
-- ============================================================
CREATE POLICY profiles_select_self ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY roles_select_self ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE POLICY experts_select_all ON public.experts FOR SELECT TO authenticated USING (true);
CREATE POLICY availability_select_all ON public.expert_availability FOR SELECT TO authenticated USING (true);
CREATE POLICY configs_select_all ON public.resolution_configs FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.can_view_booking(_booking_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    LEFT JOIN public.experts e ON e.id = b.expert_id
    WHERE b.id = _booking_id
      AND (b.requester_id = auth.uid() OR e.user_id = auth.uid() OR public.is_staff(auth.uid()))
  )
$$;

CREATE POLICY bookings_select ON public.bookings FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
  );
CREATE POLICY bookings_insert_self ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY booking_versions_select ON public.booking_versions FOR SELECT TO authenticated
  USING (public.can_view_booking(booking_id));

CREATE POLICY conflicts_select ON public.conflicts FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.experts e WHERE e.id = expert_id AND e.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conflict_members cm
      JOIN public.bookings b ON b.id = cm.booking_id
      WHERE cm.conflict_id = conflicts.id AND b.requester_id = auth.uid()
    )
  );

CREATE POLICY conflict_members_select ON public.conflict_members FOR SELECT TO authenticated
  USING (public.can_view_booking(booking_id) OR public.is_staff(auth.uid()));

CREATE POLICY decisions_select ON public.resolution_decisions FOR SELECT TO authenticated
  USING (public.can_view_booking(booking_id) OR public.is_staff(auth.uid()));

CREATE POLICY events_select ON public.events FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR (aggregate_type = 'booking' AND public.can_view_booking(aggregate_id))
  );

CREATE POLICY audit_select ON public.audit_records FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR (booking_id IS NOT NULL AND public.can_view_booking(booking_id))
  );

CREATE POLICY replay_select_staff ON public.replay_runs FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
