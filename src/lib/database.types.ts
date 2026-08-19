/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced from the live schema of project pkwifufxakvwyqjamywo.
 * Regenerate after any migration:
 *     POSTGRES_URL=... node scripts/gen-db-types.js
 *
 * WHY THIS EXISTS
 *   supabase-js returns { data: null, error } rather than throwing, so a query
 *   naming a column that does not exist fails silently and the calling code
 *   slides into whatever fallback it has. Two production defects came from
 *   exactly that: .select('role, status') and .or('...parent_agent_id...'),
 *   neither of which existed. Typing the client against this file turns both
 *   into compile errors.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      active_sessions: {
        Row: {
          user_id: string
          session_token: string
          last_seen_at: string
          created_at: string
        }
        Insert: {
          user_id: string
          session_token: string
          last_seen_at?: string
          created_at?: string
        }
        Update: {
          user_id?: string
          session_token?: string
          last_seen_at?: string
          created_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          actor_id: string | null
          kind: string
          detail: string
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          kind: string
          detail: string
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          kind?: string
          detail?: string
          created_at?: string
        }
        Relationships: []
      }
      bets: {
        Row: {
          id: string
          round_id: string
          user_id: string
          single_bets: Json
          double_bets: Json
          triple_bets: Json
          total_stake: number
          single_payout: number
          double_payout: number
          triple_payout: number
          total_payout: number
          is_settled: boolean
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          round_id: string
          user_id: string
          single_bets?: Json
          double_bets?: Json
          triple_bets?: Json
          total_stake?: number
          single_payout?: number
          double_payout?: number
          triple_payout?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          round_id?: string
          user_id?: string
          single_bets?: Json
          double_bets?: Json
          triple_bets?: Json
          total_stake?: number
          single_payout?: number
          double_payout?: number
          triple_payout?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Relationships: []
      }
      coin_ledger: {
        Row: {
          id: string
          user_id: string
          counterparty_id: string | null
          kind: string
          amount: number
          balance_after: number
          round_id: string | null
          created_at: string
          note: string | null
        }
        Insert: {
          id?: string
          user_id: string
          counterparty_id?: string | null
          kind: string
          amount: number
          balance_after: number
          round_id?: string | null
          created_at?: string
          note?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          counterparty_id?: string | null
          kind?: string
          amount?: number
          balance_after?: number
          round_id?: string | null
          created_at?: string
          note?: string | null
        }
        Relationships: []
      }
      game_config: {
        Row: {
          id: string
          rtp_percentage: number
          draw_at_second: number
          session_grace_sec: number
          updated_at: string
          bet_cutoff_second: number
          settle_batch_size: number
          staff_session_grace_sec: number
        }
        Insert: {
          id?: string
          rtp_percentage?: number
          draw_at_second?: number
          session_grace_sec?: number
          updated_at?: string
          bet_cutoff_second?: number
          settle_batch_size?: number
          staff_session_grace_sec?: number
        }
        Update: {
          id?: string
          rtp_percentage?: number
          draw_at_second?: number
          session_grace_sec?: number
          updated_at?: string
          bet_cutoff_second?: number
          settle_batch_size?: number
          staff_session_grace_sec?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          agent_id: string | null
          kind: string
          message: string
          read_at: string | null
          created_at: string
          player_id: string | null
          locked_staff_id: string | null
        }
        Insert: {
          id?: string
          agent_id?: string | null
          kind: string
          message: string
          read_at?: string | null
          created_at?: string
          player_id?: string | null
          locked_staff_id?: string | null
        }
        Update: {
          id?: string
          agent_id?: string | null
          kind?: string
          message?: string
          read_at?: string | null
          created_at?: string
          player_id?: string | null
          locked_staff_id?: string | null
        }
        Relationships: []
      }
      play_limits: {
        Row: {
          id: string
          single_min: number
          single_max: number
          double_min: number
          double_max: number
          triple_min: number
          triple_max: number
          updated_at: string
        }
        Insert: {
          id?: string
          single_min?: number
          single_max?: number
          double_min?: number
          double_max?: number
          triple_min?: number
          triple_max?: number
          updated_at?: string
        }
        Update: {
          id?: string
          single_min?: number
          single_max?: number
          double_min?: number
          double_max?: number
          triple_min?: number
          triple_max?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          username: string
          email: string
          full_name: string | null
          role: string
          agent_id: string | null
          coin_balance: number
          ledger_version: number
          is_active: boolean
          created_at: string
          updated_at: string
          failed_login_attempts: number
          auto_locked_at: string | null
        }
        Insert: {
          id: string
          username: string
          email: string
          full_name?: string | null
          role: string
          agent_id?: string | null
          coin_balance?: number
          ledger_version?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          failed_login_attempts?: number
          auto_locked_at?: string | null
        }
        Update: {
          id?: string
          username?: string
          email?: string
          full_name?: string | null
          role?: string
          agent_id?: string | null
          coin_balance?: number
          ledger_version?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          failed_login_attempts?: number
          auto_locked_at?: string | null
        }
        Relationships: []
      }
      rounds: {
        Row: {
          id: string
          round_number: number
          phase: string
          red: number | null
          green: number | null
          black: number | null
          total_stake: number
          total_payout: number
          scheduled_at: string
          drawn_at: string | null
          settled_at: string | null
          created_at: string
          rtp_percentage: number
        }
        Insert: {
          id?: string
          round_number: number
          phase?: string
          red?: number | null
          green?: number | null
          black?: number | null
          total_stake?: number
          total_payout?: number
          scheduled_at: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
          rtp_percentage?: number
        }
        Update: {
          id?: string
          round_number?: number
          phase?: string
          red?: number | null
          green?: number | null
          black?: number | null
          total_stake?: number
          total_payout?: number
          scheduled_at?: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
          rtp_percentage?: number
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      admin_issue_coins: {
        Args: Record<string, unknown>
        Returns: Json
      }
      agent_transfer_coins: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_coin_movement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      attempt_player_login: {
        Args: Record<string, unknown>
        Returns: Json
      }
      attempt_staff_login: {
        Args: Record<string, unknown>
        Returns: Json
      }
      current_is_active: {
        Args: Record<string, unknown>
        Returns: Json
      }
      current_role_name: {
        Args: Record<string, unknown>
        Returns: Json
      }
      draw_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_my_round_result: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_play_limits: {
        Args: Record<string, unknown>
        Returns: Json
      }
      get_recent_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      handle_new_user: {
        Args: Record<string, unknown>
        Returns: Json
      }
      place_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      random_digit_unbiased: {
        Args: Record<string, unknown>
        Returns: Json
      }
      random_index_unbiased: {
        Args: Record<string, unknown>
        Returns: Json
      }
      session_heartbeat: {
        Args: Record<string, unknown>
        Returns: Json
      }
      session_login: {
        Args: Record<string, unknown>
        Returns: Json
      }
      session_logout: {
        Args: Record<string, unknown>
        Returns: Json
      }
      set_agent_active: {
        Args: Record<string, unknown>
        Returns: Json
      }
      settle_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      staff_session_login: {
        Args: Record<string, unknown>
        Returns: Json
      }
      staff_session_touch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      sync_role_to_app_metadata: {
        Args: Record<string, unknown>
        Returns: Json
      }
      tick_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      verify_ledger_integrity: {
        Args: Record<string, unknown>
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
