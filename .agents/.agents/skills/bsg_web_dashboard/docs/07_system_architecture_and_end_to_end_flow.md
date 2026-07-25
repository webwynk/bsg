# 07. SYSTEM ARCHITECTURE & END-TO-END FUNCTIONALITY FLOW

This document provides an in-depth architectural explanation detailing how the **Best Smart Game (BSG)** ecosystem operates across the **Flutter Mobile App (`bsg_app`)**, the **Next.js Web Dashboard (`bsg_web_dashboard`)**, and the **Supabase PostgreSQL Database**, followed by step-by-step practical examples for every core feature.

---

# 🏗️ High-Level System Architecture

The BSG ecosystem relies on a three-tier architecture where **the database is the single source of truth for all money movement and game state**.

```
 ┌────────────────────────┐                   ┌────────────────────────┐
 │   Flutter Mobile App   │                   │   Next.js Web Admin    │
 │       (bsg_app)        │                   │  (bsg_web_dashboard)   │
 └───────────┬────────────┘                   └───────────┬────────────┘
             │                                            │
             │ HTTP / Realtime                            │ Server Actions / Auth
             ▼                                            ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    Supabase PostgreSQL Engine                       │
 │  - auth.users & public.profiles (Super Admin -> Agent -> Player)    │
 │  - Security Definer RPCs (process_bet, transfer_points, etc.)       │
 │  - Row Level Security (RLS) & Append-Only Ledgers                   │
 └─────────────────────────────────────────────────────────────────────┘
```

### Roles & Access Boundaries
1. **Super Admin**: Owns the system. Creates Agents, sets Agent RTP (`target_win_percentage`), mints system points, and views global financial analytics in `bsg_web_dashboard`.
2. **Agent**: Operates a sub-network. Creates Players under their agent account, transfers points to/from players, and monitors player spin history in `bsg_web_dashboard`.
3. **Player**: Plays the game. Logged into `bsg_app` on mobile. Places bets across Single (9x), Double (90x), and Triple (900x) boards. Cannot directly modify any database table or balance.

---

# 🔄 Feature-by-Feature Deep Breakdown with Concrete Examples

---

## 1. Account Provisioning & Authentication Flow

### Functional Concept
Accounts follow a strict 3-tier hierarchy: **Super Admin ➔ Agent ➔ Player**.

### Component Interactions
1. **Web Dashboard (`bsg_web_dashboard`)**:
   - Super Admin logs into the Admin panel and creates an Agent account (e.g., `AgentAlpha`).
   - Agent `AgentAlpha` logs into the Agent panel and creates a Player account `Player88`.
   - The web dashboard calls Supabase Auth to create the credential in `auth.users` and initializes a row in `public.profiles` linked to `AgentAlpha`'s UUID.

2. **Database (`Supabase PostgreSQL`)**:
   - `auth.users`: Stores salted/hashed passwords and user metadata (`username`, `full_name`, `status`).
   - `public.profiles`: Stores application profile linked 1:1 to `auth.users(id)`.
     ```sql
     create table public.profiles (
       id         uuid primary key references auth.users(id),
       role       user_role not null, -- 'super_admin' | 'agent' | 'player'
       username   varchar(32) not null,
       agent_id   uuid references public.profiles(id), -- Null for Super Admin/Agents
       balance    numeric(15,2) not null default 0.00 check (balance >= 0),
       is_active  boolean not null default true
     );
     ```

3. **Flutter App (`bsg_app`)**:
   - Player opens `bsg_app`, entering username `Player88` and password `Secret123`.
   - `LoginScreen` sends request to Supabase Auth:
     `POST /auth/v1/token?grant_type=password` with synthetic email `player88@bsg.com`.
   - The app verifies user metadata `status != 'Blocked'`. If blocked, login is rejected.
   - On success, `bsg_app` receives JWT access token, saves `sessionStartAt` UTC timestamp locally in `SharedPreferences`, locks screen to **Landscape**, enables immersive sticky UI, and navigates to the Lobby.

---

## 2. Points Movement & Money Ledger (Agent ➔ Player Transfer)

### Functional Concept
Money/Points **only move through `SECURITY DEFINER` RPC functions with atomic row locks (`FOR UPDATE`)**. Neither the Web Dashboard nor the Mobile App can directly execute `UPDATE profiles SET balance = ...`.

### Detailed Step-by-Step Example

#### Scenario
Agent `AgentAlpha` has a balance of **10,000 points**. Player `Player88` has **100 points**. `AgentAlpha` transfers **500 points** to `Player88`.

#### 1. Web Dashboard Action
- Agent selects `Player88` in the Player Management table (`01_frontend_development.md`) and inputs `+500` points.
- Server Action calls PostgreSQL RPC:
  ```ts
  await supabase.rpc('transfer_points', {
    p_agent_id: agentId,
    p_player_id: playerId,
    p_amount: 500
  });
  ```

#### 2. Database Execution (`transfer_points` RPC)
```sql
-- Step A: Lock Agent row and verify sufficient agent balance
SELECT balance INTO v_agent_balance FROM public.profiles WHERE id = p_agent_id FOR UPDATE;
IF v_agent_balance < 500 THEN RAISE EXCEPTION 'Insufficient agent balance'; END IF;

-- Step B: Debit Agent balance (10,000 - 500 = 9,500)
UPDATE public.profiles SET balance = balance - 500 WHERE id = p_agent_id;

-- Step C: Credit Player balance (100 + 500 = 600)
UPDATE public.profiles SET balance = balance + 500 WHERE id = p_player_id;

-- Step D: Insert immutable audit row into transactions ledger
INSERT INTO public.transactions (user_id, agent_id, type, amount, balance_after)
VALUES (p_player_id, p_agent_id, 'agent_credit', 500, 600);
```

#### 3. Real-Time Result
- **Database Ledger**: A permanent row is created in `public.transactions` recording `type = 'agent_credit'`, `amount = +500`, `balance_after = 600`.
- **Flutter App (`bsg_app`)**: Player's balance UI in `LobbyScreen` or `GameScreen` updates to **600 points**.

---

## 3. Global 60-Second Synchronized Gameplay & Wheel Resolution

### Functional Concept
All connected players share a synchronized **60-second global round loop**. A round consists of a 55s betting window, a 5s lock phase ("No Bets"), an 8s 3-ring wheel animation phase, and a result reveal phase.

### Detailed Step-by-Step Example

#### Scenario
Player `Player88` opens the game screen (`GameScreen`) with **600 points**.
`Player88` selects chip denomination **`10`** and places:
- **Single Board**: 1 chip (10 points) on cell **`2`** (9x payout).
- **Double Board**: 2 chips (20 points) on cell **`42`** (90x payout).
- **Triple Board**: 5 chips (50 points) on cell **`342`** (900x payout).

Total Stake = **10 + 20 + 50 = 80 points**.

```
    TIMELINE OF A SYNCHRONIZED ROUND (60 SECONDS)
    
 0s                          55s         60s                  68s        74s
 ├────────────────────────────┼───────────┼────────────────────┼──────────┤
 │      BETTING PHASE         │ NO BETS   │   SPIN ANIMATION   │ WIN/LOSS │
 │ (Cell taps, chip stacks)   │ (Locked)  │(Red->Green->Black) │ REVEAL   │
 └────────────────────────────┴───────────┴────────────────────┴──────────┘
```

#### Timeline Execution & Component Interactions

#### 1. Betting Phase (`0s – 55s`) — Flutter App (`bsg_app`)
- Player taps grid cells. `GameProvider` validates balance (`600 >= 80`) and per-cell play limits (Caps: Single 10k, Double 1k, Triple 100).
- Local balance indicator dynamically updates: `600 - 80 = 520 points`.

#### 2. No Bets Lock Phase (`55s Mark`) — Flutter App (`bsg_app`)
- Timer reaches **5s remaining**.
- `SoundService().playNoBets()` plays voice prompt: *"No more bets"*.
- Left tab accordion drawer auto-closes. Betting controls are locked (`_countdown <= 5`).

#### 3. Bet Submission (`60s Mark`) — Flutter App ➔ Database
- `RoundSyncService` sends bets to backend via RPC `submit_round_bet`:
  ```json
  {
    "p_round_id": "rnd_982341",
    "p_single_bets": { "2": 10 },
    "p_double_bets": { "42": 20 },
    "p_triple_bets": { "342": 50 },
    "p_total_stake": 80
  }
  ```
- **Database**: RPC locks player row, debits 80 points, and updates transaction ledger. Balance after stake = **520 points**.

#### 4. Spin Animation Phase (`60s – 68s`) — 3-Ring Wheel Engine (`WheelWidget`)
- The 3 concentric wheel rings spin simultaneously:
  - **Outer Ring (RED)**: Controls Hundreds digit. Decelerates and stops first at **`3`**.
  - **Middle Ring (GREEN)**: Controls Tens digit. Decelerates and stops second at **`4`**.
  - **Inner Ring (BLACK)**: Controls Units digit. Decelerates and stops last at t = 7.0s (+ 1.0s settle) at **`2`**.
- **Final Outcome**: **RED = 3**, **GREEN = 4**, **BLACK = 2** ➔ Winning 3-digit combination: **`342`**.

#### 5. Win Evaluation & Calculation
The database/server checks the outcome (`342`) against `Player88`'s multi-board bets:

| Board | Key Placed | Winning Key | Match? | Bet Amount | Multiplier | Win Amount |
|---|---|---|---|---|---|---|
| **Single** | `"2"` | `"2"` (Black digit) | ✅ WIN | 10 pts | 9x | **90 pts** |
| **Double** | `"42"` | `"42"` (Green+Black) | ✅ WIN | 20 pts | 90x | **1,800 pts** |
| **Triple** | `"342"` | `"342"` (Red+Green+Black) | ✅ WIN | 50 pts | 900x | **45,000 pts** |

- **Total Win Amount**: **90 + 1,800 + 45,000 = 46,890 points**.
- **Net Balance Change**: `+46,890 - 80 = +46,810 points`.

#### 6. Result Reveal & Payout (`68s Mark`) — Flutter App (`bsg_app`)
- Database credits **46,890 points** to `Player88`'s profile. New balance = **520 + 46,890 = 47,410 points**.
- `ResultOverlay` triggers on mobile screen:
  - Victory sound `playWin()` plays.
  - Golden coin explosion graphics and large text `"WIN: 46,890"` display for 3 seconds.
- Balance counter on top right smoothly animates to **47,410 points**.
- Result recorded in local spin history (`_spinHistory`) and database `public.game_history`.

---

## 4. House RTP Control & Agent Economics (`agent_configs`)

### Functional Concept
Each Agent has an assigned **Return To Player (RTP)** target percentage (`target_win_percentage`), defaulting to 20%. This controls the house edge and limits risk across player networks.

### Component Interactions

1. **Web Dashboard (`bsg_web_dashboard`)**:
   - Super Admin views `AgentAlpha` in the Admin Dashboard and edits RTP setting: `target_win_percentage = 20%`.
   - Web Dashboard writes to `public.agent_configs`:
     ```sql
     UPDATE public.agent_configs
     SET target_win_percentage = 20
     WHERE agent_id = 'agent_alpha_uuid';
     ```
   - An entry is created in `public.audit_log` recording `action = 'update_rtp'`, `metadata = { "old_rtp": 25, "new_rtp": 20 }`.

2. **Database Engine (`process_bet` RPC)**:
   - When a bet is evaluated server-side:
     ```sql
     SELECT target_win_percentage INTO v_target_win_pct
     FROM public.agent_configs WHERE agent_id = p_agent_id;

     -- Forced loss check based on agent RTP configuration
     v_forced_loss := (random() * 100) > COALESCE(v_target_win_pct, 20);

     IF v_forced_loss THEN
       -- Outcome is constrained so player does not hit winning combinations
       v_total_win := 0;
     END IF;
     ```
   - This ensures house mathematical guarantees are enforced **at the database RPC layer**, completely tamper-proof from client-side inspection or mobile network interception.

---

## 5. Reporting, Auditing & History Synchronization

### Functional Concept
Financial records and spin histories are fully auditable and protected by **Row Level Security (RLS)**.

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      ROW LEVEL SECURITY (RLS) POLICIES                 │
 ├───────────────────┬─────────────────────────────┬──────────────────────┤
 │ Role              │ Transactions Read Access    │ Game History Access  │
 ├───────────────────┼─────────────────────────────┼──────────────────────┤
 │ Player            │ Own transactions only       │ Own spins only       │
 │ Agent             │ Own players' transactions   │ Own players' spins   │
 │ Super Admin       │ ALL global transactions     │ ALL global spins     │
 └───────────────────┴─────────────────────────────┴──────────────────────┘
```

### Component Interactions
1. **Flutter App (`bsg_app`) — Info Modal (`InfoDialog`)**:
   - Player taps Info icon ➔ `HISTORY` tab.
   - App queries spin results filtered by session start time (`createdAt >= sessionStartAt`).
   - Displays paginated table of Round ID, Mode, Stake, Outcome (`3-4-2`), Win Amount, and Net Change.

2. **Web Dashboard (`bsg_web_dashboard`) — Analytics & Auditing**:
   - Agent logs into dashboard ➔ views **Player Spin History** and **Net Profit/Loss Charts**.
   - Next.js executes server query:
     ```ts
     const { data } = await supabase
       .from('game_history')
       .select('*')
       .eq('agent_id', session.user.id)
       .order('created_at', { ascending: false });
     ```
   - RLS automatically scopes the results so the Agent can only see their assigned players, presenting aggregated metrics (Total Play, Total Payout, Net Agent Revenue).

---

# 📊 Summary Matrix: Functional Flow Across All Layers

| Functionality | Mobile App (`bsg_app`) | Web Dashboard (`bsg_web_dashboard`) | Database (`Supabase PostgreSQL`) |
|---|---|---|---|
| **User Login** | `LoginScreen` (Portrait) maps username, checks `status != 'Blocked'` | Agent/Admin login via SSR HttpOnly Cookies | `auth.users` authentication & `profiles` role lookup |
| **Point Transfer** | Real-time balance counter updates | Agent enters `+Amount` in Player Table | `transfer_points` RPC (Row locking, balance check, transaction insertion) |
| **Bet Placement** | Grid taps, row/col arrows, random bets, `DOUBLE`, `REBET`, `REMOVE`, `CLEAR` | View live active player stats | Client state validated against per-board caps |
| **Round Sync** | 60s countdown timer, 5s "No Bets" warning, connection fallback banner | Monitor active round status | Global round state table & scheduled round worker |
| **Wheel Spin** | 3 concentric rings (Red Hundreds, Green Tens, Black Units) 8s animation | N/A (Client animation only) | `process_bet` / `submit_round_bet` outcome generation |
| **Payout Calculation**| `ResultOverlay` victory popup & audio fanfare | Real-time agent profit/loss tracking | Multipliers applied (Single 9x, Double 90x, Triple 900x) atomically |
| **RTP Enforcement** | N/A (Hidden from client payload) | Super Admin updates `target_win_percentage` | `agent_configs` table & `v_forced_loss` math inside RPC |
| **Game History** | Session-scoped `HISTORY` tab in `InfoDialog` | Global / Agent financial & spin history tables | `game_history` & `transactions` append-only tables with RLS |
