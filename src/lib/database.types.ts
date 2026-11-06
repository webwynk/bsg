/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced from the live schema of project ezcmxxfhjtzqolbtmshr.
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
      account_code_counters: {
        Row: {
          letter: string
          last_number: number
        }
        Insert: {
          letter: string
          last_number: number
        }
        Update: {
          letter?: string
          last_number?: number
        }
        Relationships: []
      }
      account_codes: {
        Row: {
          user_id: string
          code: string
          letter: string
          number: number
          assigned_at: string
        }
        Insert: {
          user_id: string
          code: string
          letter: string
          number: number
          assigned_at?: string
        }
        Update: {
          user_id?: string
          code?: string
          letter?: string
          number?: number
          assigned_at?: string
        }
        Relationships: []
      }
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
          lucky_card_round_id: string | null
          spin2win_round_id: string | null
          lucky16_round_id: string | null
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
          lucky_card_round_id?: string | null
          spin2win_round_id?: string | null
          lucky16_round_id?: string | null
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
          lucky_card_round_id?: string | null
          spin2win_round_id?: string | null
          lucky16_round_id?: string | null
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
          bonus_multiplier: number
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
          bonus_multiplier?: number
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
          bonus_multiplier?: number
        }
        Relationships: []
      }
      lucky16_bets: {
        Row: {
          id: string
          round_id: string
          user_id: string
          a_hearts: number
          a_spades: number
          a_diamonds: number
          a_clubs: number
          j_hearts: number
          j_spades: number
          j_diamonds: number
          j_clubs: number
          q_hearts: number
          q_spades: number
          q_diamonds: number
          q_clubs: number
          k_hearts: number
          k_spades: number
          k_diamonds: number
          k_clubs: number
          total_stake: number
          total_payout: number
          is_settled: boolean
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          round_id: string
          user_id: string
          a_hearts?: number
          a_spades?: number
          a_diamonds?: number
          a_clubs?: number
          j_hearts?: number
          j_spades?: number
          j_diamonds?: number
          j_clubs?: number
          q_hearts?: number
          q_spades?: number
          q_diamonds?: number
          q_clubs?: number
          k_hearts?: number
          k_spades?: number
          k_diamonds?: number
          k_clubs?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          round_id?: string
          user_id?: string
          a_hearts?: number
          a_spades?: number
          a_diamonds?: number
          a_clubs?: number
          j_hearts?: number
          j_spades?: number
          j_diamonds?: number
          j_clubs?: number
          q_hearts?: number
          q_spades?: number
          q_diamonds?: number
          q_clubs?: number
          k_hearts?: number
          k_spades?: number
          k_diamonds?: number
          k_clubs?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Relationships: []
      }
      lucky16_config: {
        Row: {
          id: string
          rtp_percentage: number
          bonus_multiplier: number
          bet_cutoff_second: number
          draw_at_second: number
          settle_batch_size: number
          updated_at: string
        }
        Insert: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Update: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      lucky16_rounds: {
        Row: {
          id: string
          round_number: number
          phase: string
          winning_rank: string | null
          winning_suit: string | null
          total_stake: number
          total_payout: number
          rtp_percentage: number
          bonus_multiplier: number
          scheduled_at: string
          drawn_at: string | null
          settled_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          round_number: number
          phase?: string
          winning_rank?: string | null
          winning_suit?: string | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          round_number?: number
          phase?: string
          winning_rank?: string | null
          winning_suit?: string | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at?: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      lucky_card_bets: {
        Row: {
          id: string
          round_id: string
          user_id: string
          j_hearts: number
          j_spades: number
          j_diamonds: number
          j_clubs: number
          q_hearts: number
          q_spades: number
          q_diamonds: number
          q_clubs: number
          k_hearts: number
          k_spades: number
          k_diamonds: number
          k_clubs: number
          total_stake: number
          total_payout: number
          is_settled: boolean
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          round_id: string
          user_id: string
          j_hearts?: number
          j_spades?: number
          j_diamonds?: number
          j_clubs?: number
          q_hearts?: number
          q_spades?: number
          q_diamonds?: number
          q_clubs?: number
          k_hearts?: number
          k_spades?: number
          k_diamonds?: number
          k_clubs?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          round_id?: string
          user_id?: string
          j_hearts?: number
          j_spades?: number
          j_diamonds?: number
          j_clubs?: number
          q_hearts?: number
          q_spades?: number
          q_diamonds?: number
          q_clubs?: number
          k_hearts?: number
          k_spades?: number
          k_diamonds?: number
          k_clubs?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Relationships: []
      }
      lucky_card_config: {
        Row: {
          id: string
          rtp_percentage: number
          bonus_multiplier: number
          bet_cutoff_second: number
          draw_at_second: number
          settle_batch_size: number
          updated_at: string
        }
        Insert: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Update: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      lucky_card_rounds: {
        Row: {
          id: string
          round_number: number
          phase: string
          winning_rank: string | null
          winning_suit: string | null
          total_stake: number
          total_payout: number
          rtp_percentage: number
          bonus_multiplier: number
          scheduled_at: string
          drawn_at: string | null
          settled_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          round_number: number
          phase?: string
          winning_rank?: string | null
          winning_suit?: string | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          round_number?: number
          phase?: string
          winning_rank?: string | null
          winning_suit?: string | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at?: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
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
      print_counters: {
        Row: {
          user_id: string
          game: string
          last_number: number
        }
        Insert: {
          user_id: string
          game: string
          last_number: number
        }
        Update: {
          user_id?: string
          game?: string
          last_number?: number
        }
        Relationships: []
      }
      print_players: {
        Row: {
          user_id: string
          enabled: boolean
          active_before: boolean
          enabled_at: string | null
          enabled_by: string | null
          updated_at: string
          effective_at: string
        }
        Insert: {
          user_id: string
          enabled?: boolean
          active_before?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          updated_at?: string
          effective_at: string
        }
        Update: {
          user_id?: string
          enabled?: boolean
          active_before?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          updated_at?: string
          effective_at?: string
        }
        Relationships: []
      }
      print_settings: {
        Row: {
          id: string
          enabled: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          enabled?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          enabled?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      print_tickets: {
        Row: {
          id: string
          game: string
          ticket_no: number
          ticket_code: string
          user_id: string
          round_id: string | null
          lucky_card_round_id: string | null
          spin2win_round_id: string | null
          lucky16_round_id: string | null
          round_number: number
          items: Json
          total_stake: number
          client_request_id: string
          print_status: string
          reprint_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          game: string
          ticket_no: number
          ticket_code: string
          user_id: string
          round_id?: string | null
          lucky_card_round_id?: string | null
          spin2win_round_id?: string | null
          lucky16_round_id?: string | null
          round_number: number
          items: Json
          total_stake: number
          client_request_id: string
          print_status?: string
          reprint_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          game?: string
          ticket_no?: number
          ticket_code?: string
          user_id?: string
          round_id?: string | null
          lucky_card_round_id?: string | null
          spin2win_round_id?: string | null
          lucky16_round_id?: string | null
          round_number?: number
          items?: Json
          total_stake?: number
          client_request_id?: string
          print_status?: string
          reprint_count?: number
          created_at?: string
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
          bonus_multiplier: number
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
          bonus_multiplier?: number
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
          bonus_multiplier?: number
        }
        Relationships: []
      }
      spin2win_bets: {
        Row: {
          id: string
          round_id: string
          user_id: string
          n0: number
          n1: number
          n2: number
          n3: number
          n4: number
          n5: number
          n6: number
          n7: number
          n8: number
          n9: number
          total_stake: number
          total_payout: number
          is_settled: boolean
          created_at: string
          settled_at: string | null
        }
        Insert: {
          id?: string
          round_id: string
          user_id: string
          n0?: number
          n1?: number
          n2?: number
          n3?: number
          n4?: number
          n5?: number
          n6?: number
          n7?: number
          n8?: number
          n9?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Update: {
          id?: string
          round_id?: string
          user_id?: string
          n0?: number
          n1?: number
          n2?: number
          n3?: number
          n4?: number
          n5?: number
          n6?: number
          n7?: number
          n8?: number
          n9?: number
          total_stake?: number
          total_payout?: number
          is_settled?: boolean
          created_at?: string
          settled_at?: string | null
        }
        Relationships: []
      }
      spin2win_config: {
        Row: {
          id: string
          rtp_percentage: number
          bonus_multiplier: number
          bet_cutoff_second: number
          draw_at_second: number
          settle_batch_size: number
          updated_at: string
        }
        Insert: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Update: {
          id?: string
          rtp_percentage?: number
          bonus_multiplier?: number
          bet_cutoff_second?: number
          draw_at_second?: number
          settle_batch_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      spin2win_rounds: {
        Row: {
          id: string
          round_number: number
          phase: string
          winning_number: number | null
          total_stake: number
          total_payout: number
          rtp_percentage: number
          bonus_multiplier: number
          scheduled_at: string
          drawn_at: string | null
          settled_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          round_number: number
          phase?: string
          winning_number?: number | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          round_number?: number
          phase?: string
          winning_number?: number | null
          total_stake?: number
          total_payout?: number
          rtp_percentage?: number
          bonus_multiplier?: number
          scheduled_at?: string
          drawn_at?: string | null
          settled_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      account_code_on_profile_insert: {
        Args: Record<string, unknown>
        Returns: Json
      }
      admin_issue_coins: {
        Args: Record<string, unknown>
        Returns: Json
      }
      agent_transfer_coins: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_bonus_to_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      apply_coin_movement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      assign_account_code: {
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
      lucky16_apply_bonus_to_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_apply_coin_movement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_draw_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_get_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_get_my_round_result: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_get_recent_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_my_tickets: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_place_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_print_state: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_print_ticket: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_random_int: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_settle_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_tick_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky16_ticket_win: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_apply_bonus_to_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_apply_coin_movement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_draw_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_get_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_get_my_round_result: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_get_recent_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_my_tickets: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_place_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_print_state: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_print_ticket: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_random_int: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_settle_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_tick_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      lucky_card_ticket_win: {
        Args: Record<string, unknown>
        Returns: Json
      }
      place_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      print_active_for_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      print_allocate_ticket: {
        Args: Record<string, unknown>
        Returns: Json
      }
      print_blocks_normal_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      print_mark_ticket: {
        Args: Record<string, unknown>
        Returns: Json
      }
      print_staff_tickets: {
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
      set_print_enabled: {
        Args: Record<string, unknown>
        Returns: Json
      }
      set_print_kill_switch: {
        Args: Record<string, unknown>
        Returns: Json
      }
      settle_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_apply_bonus_to_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_apply_coin_movement: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_draw_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_get_current_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_get_my_round_result: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_get_recent_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_my_tickets: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_place_bet: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_print_state: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_print_ticket: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_random_int: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_settle_round: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_tick_rounds: {
        Args: Record<string, unknown>
        Returns: Json
      }
      spin2win_ticket_win: {
        Args: Record<string, unknown>
        Returns: Json
      }
      staff_auth_check: {
        Args: Record<string, unknown>
        Returns: Json
      }
      staff_money_summary: {
        Args: Record<string, unknown>
        Returns: Json
      }
      staff_player_money_rows: {
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
      tc_add_boards: {
        Args: Record<string, unknown>
        Returns: Json
      }
      tc_board_win: {
        Args: Record<string, unknown>
        Returns: Json
      }
      tc_my_tickets: {
        Args: Record<string, unknown>
        Returns: Json
      }
      tc_print_state: {
        Args: Record<string, unknown>
        Returns: Json
      }
      tc_print_ticket: {
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
