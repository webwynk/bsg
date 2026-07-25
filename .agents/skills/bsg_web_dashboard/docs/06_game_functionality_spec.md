# 06. FLUTTER APP (`bsg_app`) COMPLETE FUNCTIONALITY SPECIFICATION

This document provides the complete, authoritative specification of all features, UI flows, wheel math, betting logic, round synchronization, chip interactions, audio system, and error states for the **Best Smart Game (BSG)** Flutter mobile application (`bsg_app`).

---

## 1. App Architecture, Environment & Session Lifecycle

### 1.1 Orientation & Screen Settings
- **Splash & Login Screens**: Enforced **Portrait** mode (`DeviceOrientation.portraitUp`, `DeviceOrientation.portraitDown`).
- **Lobby & Game Screens**: Enforced **Landscape** mode (`DeviceOrientation.landscapeLeft`, `DeviceOrientation.landscapeRight`).
- **Immersive Mode**: Fullscreen sticky immersive mode (`SystemUiMode.immersiveSticky`) with device status/navigation bars hidden.
- **Wake Lock**: `WakelockPlus.enable()` keeps the screen awake during gameplay.

### 1.2 Session Management & Security
- **Authentication Endpoint**: `POST /auth/v1/token?grant_type=password` using Supabase Auth.
- **Synthetic Email Mapping**: Username input `user1` automatically maps to `user1@bsg.com` (or keeps input if `@` present).
- **Account Block Protection**: Checks `user_metadata.status`. If `'Blocked'`, login is rejected with `"Account is blocked. Please contact your Agent."`.
- **Session Scoping (`sessionStartAt`)**:
  - Captures UTC timestamp at login.
  - History queries in the app are strictly filtered by `createdAt >= sessionStartAt` so users see stats relevant only to their current active session.
- **Local History Reset**: On app startup and logout, `bsg_local_game_history` is purged from `SharedPreferences`.

---

## 2. Lobby & Game Slot Architecture

### 2.1 10-Slot Grid System
- Grid layout: 5 columns × 2 rows in landscape view.
- **Slot 1 (Active)**: "Triple Chance" (`card_triple_chance.webp`). Tapping navigates to `/game`.
- **Slots 2–10 (Locked)**: "Coming Soon" (`card_coming_soon.webp`). Tapping any locked slot plays a notification sound and displays the **Game Locked Modal**.

### 2.2 Game Locked Modal
- **Visual Style**: Dark crimson 3D glassmorphic card with a glowing gold lock icon badge.
- **Message**: `"This game is currently locked. Contact your agent to activate this slot."`
- **Behavior**: Auto-dismisses after 5 seconds of inactivity or upon pressing the green 3D `"OK"` button.

### 2.3 Lobby Header
- **Left**: User profile avatar + `"Welcome, <username>"`.
- **Center**: Prominent disclaimer `"✦ FOR AMUSEMENT ONLY ✦"`.
- **Right**: Coin balance indicator (coin icon + integer points) and Lock/Logout button.
- **Logout Dialog**: Tapping the lock button opens a 3D confirmation dialog with `"CANCEL"` (green 3D button) and `"YES, LOGOUT"` (red 3D button). Automatically closes after 5 seconds if unhandled.

---

## 3. 3-Ring Wheel Engine & Game Modes

### 3.1 3 Concentric Animated Wheels
The game wheel consists of three independent concentric rings:
1. **Outer Ring (RED Wheel)**: Displays numbers 0–9. Determines the **Hundreds** digit (`result.red`).
2. **Middle Ring (GREEN Wheel)**: Displays numbers 0–9. Determines the **Tens** digit (`result.green`).
3. **Inner Ring (BLACK Wheel)**: Displays numbers 0–9. Determines the **Units** digit (`result.black`).
4. **Center Hub**: Features a smoke particle effect (`hub_smoke.dart`) and the Result Lens overlay (`result_lens.dart`).

### 3.2 Multi-Board Betting Modes & Payout Multipliers
Players can place bets on three boards **simultaneously in the same round**:

| Board Mode | Key Range | Total Cells | Winning Condition | Payout Multiplier |
|---|---|---|---|---|
| **Single (1-Digit)** | `0` – `9` | 10 cells | Matches Black ring digit (`result.black`) | **9x** (e.g. 10 stake → 90 payout) |
| **Double (2-Digit)** | `00` – `99` | 100 cells | Matches Green + Black digits (`result.green*10 + result.black`) | **90x** (e.g. 10 stake → 900 payout) |
| **Triple (3-Digit)** | `000` – `999` | 1,000 cells (10 pages × 100 cells) | Matches Red + Green + Black digits (`result.red*100 + result.green*10 + result.black`) | **900x** (e.g. 10 stake → 9,000 payout) |

- **Triple Board Pagination**:
  - Split into 10 sub-pages of 100 cells each: Page 0 (000–099), Page 1 (100–199), ..., Page 9 (900–999).
  - Bets placed on one page persist when switching to another page.

---

## 4. Betting Controls, Chip Stacks & Action Rules

### 4.1 Chip Denominations
Available chips: `2`, `5`, `10`, `50`, `100`, `500`, `1000`. Default active chip is `2`.

### 4.2 Placement Mechanics
1. **Direct Cell Tap**: Adds active chip value to target cell. Immediately debits player balance.
2. **Row / Column Arrow Tap**: Places active chip value on every cell in that row or column.
3. **Random Selection**: Shuffles current board pool and places active chip on N random cells (e.g. 5, 10, 20 cells).
4. **Deselect Mode (No Chip Selected)**: Tapping a cell or row/col arrow removes the most recent chip placed on that cell/row.

### 4.3 Action Buttons
- **`DOUBLE`**: Doubles current stake on every occupied cell across all boards. Validates play limits (caps) and balance. If doubling a cell exceeds its cap, it doubles up to the cap and shows an alert.
- **`REBET`**: Restores the complete bet layout from the previous round (`_lastBetSnapshot`). Appears when board is currently empty and previous snapshot exists.
- **`REMOVE`**: LIFO stack undo for chip placements. Removes last placed chip and refunds amount to balance.
- **`CLEAR`**: Clears all placed bets across all boards and refunds total stake to player balance.

### 4.4 Play Limits & Validation Feedback
- **Default Play Limits**:
  - **Single**: Min = 2, Max = 10,000 per cell.
  - **Double**: Min = 2, Max = 1,000 per cell.
  - **Triple**: Min = 2, Max = 100 per cell.
- **Limit Exceeded Alert**: Displays a red top snackbar banner: `"<BOARD> PLAY LIMIT REACHED - Max <cap> / number"`.
- **Insufficient Coins Alert**: Displays a 3D modal dialog with coin graphic, gold title `"INSUFFICIENT COINS"`, and a green `"OK"` button.

---

## 5. Global 60-Second Round Synchronization & Spin Timeline

### 5.1 60-Second Round Lifecycle
All players share a synchronized 60-second global round loop managed by `RoundSyncService`:

```
 0s                          55s         60s                  68s        74s
 ├────────────────────────────┼───────────┼────────────────────┼──────────┤
 │      BETTING PHASE         │ NO BETS   │   SPIN ANIMATION   │  WIN/LOSS │
 │  (Players place bets)      │  (Locked) │ (Red->Green->Black)│ REVEAL   │
 └────────────────────────────┴───────────┴────────────────────┴──────────┘
```

1. **0s – 55s (Betting Phase)**: Players select chips and place bets across Single/Double/Triple boards.
2. **55s Mark (No Bets Warning)**:
   - Countdown timer turns red.
   - Voice audio warning `no_bets.mp3` plays ("No more bets").
   - Left betting drawer automatically closes.
   - Betting controls are disabled (`_countdown <= 5`).
3. **60s Mark (Round Lock & Submission)**:
   - Placed bets are automatically submitted to backend via `submit_round_bet` RPC.
   - 8-second wheel spin animation begins.
4. **Spin Animation Timeline (8.0 Seconds)**:
   - **Outer Red Wheel**: Decelerates and stops first.
   - **Middle Green Wheel**: Decelerates and stops second.
   - **Inner Black Wheel**: Decelerates and stops last at t = 7.0s (+ 1.0s settle buffer).
5. **68s Mark (Result Reveal & Payout)**:
   - If total win > 0: `ResultOverlay` displays glowing victory graphics, plays win fanfare, credits winnings to balance, shows for 3s, closes, waits 3s before resetting board for next round.
   - If loss: Screen holds outcome for 3s before resetting board.

### 5.2 Disconnection Fallback
If network connectivity drops:
- Displays top sticky banner `_NoConnectionBanner`: `"NO INTERNET CONNECTION — Game paused"`.
- Features an instant `"RETRY"` action button to reconnect `RoundSyncService`.

---

## 6. Audio System Specification (`SoundService`)

Audio feedback is handled via `audioplayers` with support for global mute toggle:

| Event | Audio File / Effect | Description |
|---|---|---|
| UI Button Click | `click.mp3` / Synthesized | Mode tabs, deselect, lobby cards |
| Chip Selected | `chip_select.mp3` | Selecting chip denomination |
| Number / Cell Select | `number_select.mp3` | Placing chip on grid cell |
| No Bets Warning | `no_bets.mp3` | Played at 5s remaining mark |
| Win Fanfare | `win.mp3` | Played when round produces a win |
| Notification Alert | `notification.mp3` | Played when modal dialog opens |

- **Emergency Audio Stop (`stopAll()`)**: Called when exiting game screen or aborting spin to instantly terminate all playing audio clips.

---

## 7. Info & History Modal (`InfoDialog`)

Opened via the info icon on the game screen. Contains 3 tabs:
1. **`HISTORY` Tab**:
   - Paginated list of game results for the active session (`createdAt >= sessionStartAt`).
   - Columns: Round ID, Mode, Bets, Outcome (Red-Green-Black), Stake, Win Amount, Net Change.
   - Summary statistics header: Session Total Play and Session Total Win.
2. **`PAYOUT` Tab**:
   - Displays payout multiplier table (Single: 9x, Double: 90x, Triple: 900x) and min/max limits per mode.
3. **`RULES` Tab**:
   - Detailed game instructions, chip rules, and round cycle explanation.
