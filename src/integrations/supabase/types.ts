export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_records: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          booking_id: string | null
          configuration_version: number | null
          conflict_id: string | null
          correlation_id: string | null
          created_at: string
          decision_data: Json | null
          decision_id: string | null
          event_id: string | null
          expert_id: string | null
          id: string
          input_data: Json
          new_state: Database["public"]["Enums"]["booking_state"] | null
          previous_hash: string | null
          previous_state: Database["public"]["Enums"]["booking_state"] | null
          record_hash: string
          request_id: string | null
          score: number | null
          sequence: number
          system_version: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          booking_id?: string | null
          configuration_version?: number | null
          conflict_id?: string | null
          correlation_id?: string | null
          created_at?: string
          decision_data?: Json | null
          decision_id?: string | null
          event_id?: string | null
          expert_id?: string | null
          id?: string
          input_data?: Json
          new_state?: Database["public"]["Enums"]["booking_state"] | null
          previous_hash?: string | null
          previous_state?: Database["public"]["Enums"]["booking_state"] | null
          record_hash: string
          request_id?: string | null
          score?: number | null
          sequence?: number
          system_version?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          booking_id?: string | null
          configuration_version?: number | null
          conflict_id?: string | null
          correlation_id?: string | null
          created_at?: string
          decision_data?: Json | null
          decision_id?: string | null
          event_id?: string | null
          expert_id?: string | null
          id?: string
          input_data?: Json
          new_state?: Database["public"]["Enums"]["booking_state"] | null
          previous_hash?: string | null
          previous_state?: Database["public"]["Enums"]["booking_state"] | null
          record_hash?: string
          request_id?: string | null
          score?: number | null
          sequence?: number
          system_version?: string
        }
        Relationships: []
      }
      booking_versions: {
        Row: {
          booking_id: string
          changed_by: string | null
          created_at: string
          event_id: string | null
          id: string
          snapshot: Json
          state: Database["public"]["Enums"]["booking_state"]
          version: number
        }
        Insert: {
          booking_id: string
          changed_by?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          snapshot: Json
          state: Database["public"]["Enums"]["booking_state"]
          version: number
        }
        Update: {
          booking_id?: string
          changed_by?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          snapshot?: Json
          state?: Database["public"]["Enums"]["booking_state"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_versions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          client_timezone: string
          correlation_id: string
          created_at: string
          end_time: string
          expert_id: string
          id: string
          logical_sequence: number
          notes: string
          priority: Database["public"]["Enums"]["booking_priority"]
          requester_id: string
          rescheduled_from: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          source: Database["public"]["Enums"]["booking_source"]
          start_time: string
          state: Database["public"]["Enums"]["booking_state"]
          time_range: unknown
          updated_at: string
          user_completion_rate: number
          version: number
        }
        Insert: {
          client_timezone?: string
          correlation_id?: string
          created_at?: string
          end_time: string
          expert_id: string
          id?: string
          logical_sequence?: number
          notes?: string
          priority?: Database["public"]["Enums"]["booking_priority"]
          requester_id: string
          rescheduled_from?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          source?: Database["public"]["Enums"]["booking_source"]
          start_time: string
          state?: Database["public"]["Enums"]["booking_state"]
          time_range?: unknown
          updated_at?: string
          user_completion_rate?: number
          version?: number
        }
        Update: {
          client_timezone?: string
          correlation_id?: string
          created_at?: string
          end_time?: string
          expert_id?: string
          id?: string
          logical_sequence?: number
          notes?: string
          priority?: Database["public"]["Enums"]["booking_priority"]
          requester_id?: string
          rescheduled_from?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          source?: Database["public"]["Enums"]["booking_source"]
          start_time?: string
          state?: Database["public"]["Enums"]["booking_state"]
          time_range?: unknown
          updated_at?: string
          user_completion_rate?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bookings_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_rescheduled_from_fkey"
            columns: ["rescheduled_from"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      conflict_members: {
        Row: {
          booking_id: string
          conflict_id: string
          created_at: string
          id: string
          overlap_kind: string
        }
        Insert: {
          booking_id: string
          conflict_id: string
          created_at?: string
          id?: string
          overlap_kind?: string
        }
        Update: {
          booking_id?: string
          conflict_id?: string
          created_at?: string
          id?: string
          overlap_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflict_members_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflict_members_conflict_id_fkey"
            columns: ["conflict_id"]
            isOneToOne: false
            referencedRelation: "conflicts"
            referencedColumns: ["id"]
          },
        ]
      }
      conflicts: {
        Row: {
          correlation_id: string | null
          created_at: string
          detected_at: string
          expert_id: string
          fingerprint: string
          id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["conflict_status"]
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          detected_at?: string
          expert_id: string
          fingerprint: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["conflict_status"]
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          detected_at?: string
          expert_id?: string
          fingerprint?: string
          id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["conflict_status"]
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflicts_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_id: string | null
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number
          applied: boolean
          causation_id: string | null
          configuration_version: number | null
          correlation_id: string
          dedupe_key: string
          event_id: string
          event_type: string
          logical_sequence: number
          occurred_at: string
          payload: Json
          quarantine_reason: string | null
          recorded_at: string
          source: Database["public"]["Enums"]["booking_source"]
        }
        Insert: {
          actor_id?: string | null
          aggregate_id: string
          aggregate_type?: string
          aggregate_version: number
          applied?: boolean
          causation_id?: string | null
          configuration_version?: number | null
          correlation_id: string
          dedupe_key: string
          event_id?: string
          event_type: string
          logical_sequence: number
          occurred_at: string
          payload?: Json
          quarantine_reason?: string | null
          recorded_at?: string
          source?: Database["public"]["Enums"]["booking_source"]
        }
        Update: {
          actor_id?: string | null
          aggregate_id?: string
          aggregate_type?: string
          aggregate_version?: number
          applied?: boolean
          causation_id?: string | null
          configuration_version?: number | null
          correlation_id?: string
          dedupe_key?: string
          event_id?: string
          event_type?: string
          logical_sequence?: number
          occurred_at?: string
          payload?: Json
          quarantine_reason?: string | null
          recorded_at?: string
          source?: Database["public"]["Enums"]["booking_source"]
        }
        Relationships: [
          {
            foreignKeyName: "events_configuration_version_fkey"
            columns: ["configuration_version"]
            isOneToOne: false
            referencedRelation: "resolution_configs"
            referencedColumns: ["version"]
          },
        ]
      }
      expert_availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_minute: number
          expert_id: string
          id: string
          start_minute: number
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_minute: number
          expert_id: string
          id?: string
          start_minute: number
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_minute?: number
          expert_id?: string
          id?: string
          start_minute?: number
        }
        Relationships: [
          {
            foreignKeyName: "expert_availability_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          active: boolean
          bio: string
          created_at: string
          display_name: string
          domain: Database["public"]["Enums"]["expert_domain"]
          id: string
          success_rate: number
          timezone: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          bio?: string
          created_at?: string
          display_name: string
          domain: Database["public"]["Enums"]["expert_domain"]
          id?: string
          success_rate?: number
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          bio?: string
          created_at?: string
          display_name?: string
          domain?: Database["public"]["Enums"]["expert_domain"]
          id?: string
          success_rate?: number
          timezone?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          actor_id: string | null
          completed_at: string | null
          created_at: string
          key: string
          request_digest: string
          response: Json | null
          scope: string
          status: string
        }
        Insert: {
          actor_id?: string | null
          completed_at?: string | null
          created_at?: string
          key: string
          request_digest: string
          response?: Json | null
          scope: string
          status?: string
        }
        Update: {
          actor_id?: string | null
          completed_at?: string | null
          created_at?: string
          key?: string
          request_digest?: string
          response?: Json | null
          scope?: string
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      replay_runs: {
        Row: {
          bookings_checked: number
          correlation_id: string | null
          created_at: string
          dry_run: boolean
          duration_ms: number | null
          events_deduplicated: number
          events_loaded: number
          events_quarantined: number
          id: string
          mismatches: Json
          mode: string
          requested_by: string | null
          scope: Json
          status: string
        }
        Insert: {
          bookings_checked?: number
          correlation_id?: string | null
          created_at?: string
          dry_run?: boolean
          duration_ms?: number | null
          events_deduplicated?: number
          events_loaded?: number
          events_quarantined?: number
          id?: string
          mismatches?: Json
          mode: string
          requested_by?: string | null
          scope?: Json
          status?: string
        }
        Update: {
          bookings_checked?: number
          correlation_id?: string | null
          created_at?: string
          dry_run?: boolean
          duration_ms?: number | null
          events_deduplicated?: number
          events_loaded?: number
          events_quarantined?: number
          id?: string
          mismatches?: Json
          mode?: string
          requested_by?: string | null
          scope?: Json
          status?: string
        }
        Relationships: []
      }
      resolution_configs: {
        Row: {
          active: boolean
          created_at: string
          notes: string
          tie_breakers: string[]
          version: number
          weights: Json
        }
        Insert: {
          active?: boolean
          created_at?: string
          notes?: string
          tie_breakers: string[]
          version: number
          weights: Json
        }
        Update: {
          active?: boolean
          created_at?: string
          notes?: string
          tie_breakers?: string[]
          version?: number
          weights?: Json
        }
        Relationships: []
      }
      resolution_decisions: {
        Row: {
          booking_id: string
          confidence: number
          configuration_version: number
          conflict_id: string
          correlation_id: string | null
          created_at: string
          engine_version: string
          final_score: number
          id: string
          input_digest: string
          is_replay: boolean
          outcome: Database["public"]["Enums"]["booking_state"]
          rank: number
          reasoning: Json
          tie_breaker: Json | null
        }
        Insert: {
          booking_id: string
          confidence: number
          configuration_version: number
          conflict_id: string
          correlation_id?: string | null
          created_at?: string
          engine_version?: string
          final_score: number
          id?: string
          input_digest: string
          is_replay?: boolean
          outcome: Database["public"]["Enums"]["booking_state"]
          rank?: number
          reasoning?: Json
          tie_breaker?: Json | null
        }
        Update: {
          booking_id?: string
          confidence?: number
          configuration_version?: number
          conflict_id?: string
          correlation_id?: string | null
          created_at?: string
          engine_version?: string
          final_score?: number
          id?: string
          input_digest?: string
          is_replay?: boolean
          outcome?: Database["public"]["Enums"]["booking_state"]
          rank?: number
          reasoning?: Json
          tie_breaker?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "resolution_decisions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resolution_decisions_configuration_version_fkey"
            columns: ["configuration_version"]
            isOneToOne: false
            referencedRelation: "resolution_configs"
            referencedColumns: ["version"]
          },
          {
            foreignKeyName: "resolution_decisions_conflict_id_fkey"
            columns: ["conflict_id"]
            isOneToOne: false
            referencedRelation: "conflicts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_booking: { Args: { _booking_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "user" | "expert" | "auditor" | "admin"
      booking_priority: "HIGH" | "MEDIUM" | "LOW"
      booking_source: "WEB" | "MOBILE" | "PARTNER_API" | "IMPORT" | "ADMIN"
      booking_state:
        | "PENDING"
        | "CONFIRMED"
        | "REJECTED"
        | "RESCHEDULED"
        | "CANCELLED"
      conflict_status: "OPEN" | "RESOLVED" | "STALE"
      expert_domain: "HEALTHCARE" | "FINANCE" | "TECHNOLOGY"
      session_type: "EMERGENCY" | "PRIORITY" | "ROUTINE"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "expert", "auditor", "admin"],
      booking_priority: ["HIGH", "MEDIUM", "LOW"],
      booking_source: ["WEB", "MOBILE", "PARTNER_API", "IMPORT", "ADMIN"],
      booking_state: [
        "PENDING",
        "CONFIRMED",
        "REJECTED",
        "RESCHEDULED",
        "CANCELLED",
      ],
      conflict_status: ["OPEN", "RESOLVED", "STALE"],
      expert_domain: ["HEALTHCARE", "FINANCE", "TECHNOLOGY"],
      session_type: ["EMERGENCY", "PRIORITY", "ROUTINE"],
    },
  },
} as const
