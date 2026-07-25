# BSG — Triple Chance: Complete Functionality Reference

> Deep-dive documentation of every feature, button, sound, state, flow, and backend architecture in the app.
> Derived from actual source code analysis of the Flutter app and Supabase backend. Last updated: 2026-07-23.

---

## Global Shared Game Round — Core Architecture

```
SERVER (Supabase Backend)
├── Global 60-Second Loop: `round-scheduler` Edge Function + pg_cron (`bsg-round-scheduler`)
├── Generates ONE authoritative result (Red, Green, Black) per round globally
└── Pushes result to ALL connected players

CLIENT (Flutter App)
├── RoundSyncService: Syncs countdown timer to server clock (`get_current_round` RPC)
├── Places bets locally during 60-second window
├── At 0s: calls `submit_round_bet` RPC (deducts balance server-side)
├── Receives shared global result → triggers wheel animation (8000ms)
└── Evaluates local bets against global result → displays win/lose outcome
```

---

## 1. App Boot — Splash Screen & Login Navigation

### What Happens at Launch
1. `SplashScreen` appears showing the BSG logo and 3D metallic loading bar.
2. After 2400ms animation, the app **always navigates directly to `/login`**.
3. **No Auto-Login**: Auto-login is disabled. Every user must type their username and password to log in.

---

## 2. Login Screen

### Orientation
- **Portrait only** (`portraitUp`, `portraitDown`).

### UI Elements
- Username text field
- Password text field (with show/hide toggle eye icon)
- LOGIN button
- 18+ warning disclaimer image at bottom

### Login & Authentication Flow
1. User enters Username and Password.
2. Tap **LOGIN**:
   - If fields are empty OR authentication fails → card **shakes** for 500ms and displays:
     **"Wrong username or password"**
3. `AuthProvider.login(username, password)` sends request to `POST /api/auth/login`.
4. **No Demo Mode / No Stubs**:
   - Demo mode and offline coin stub fallbacks have been completely removed.
   - Real-time login with valid server credentials is mandatory.
5. On successful login:
   - Server returns JWT token, user balance, role, and agent info.
   - App navigates to `/lobby`.

---

## 3. Lobby & Profile

- **Lobby Screen**: Shows player username, agent name, live balance, and game selection cards.
- **Profile Screen**: Access account details and tap red **LOGOUT** button to end session.

---

## 4. Game Screen & Control Panel

### Countdown Timer Display
- Serves **strictly as a timer display** showing the synced global seconds remaining.
- **No Manual Spin on Tap**: Tapping the countdown timer box does NOT trigger a spin. Spins occur automatically when the timer reaches 0s.

### Balance Display
- Serves **strictly as an official balance indicator**.
- **No Test Tap Modifications**: Testing shortcuts (such as tapping balance to add 1,000 coins) have been completely removed. Balance changes occur exclusively via legitimate server bets, wins, and web dashboard top-ups.

---

## 5. Summary of Removed Testing & Stub Features

| Feature | Old Behavior | Current Clean Behavior |
|---|---|---|
| **Auto-Login** | Skipped login if session stored | **Disabled** — Always requires username & password |
| **Demo Login Fallback** | Signed in with stub token + 1,250 demo balance | **Removed** — Rejects invalid logins with `"Wrong username or password"` |
| **Coin Tap Cheat** | Tapping balance added +1,000 coins | **Removed** — Balance column is read-only |
| **Timer Tap Spin** | Tapping timer started wheel spin | **Removed** — Timer box is non-tappable |
