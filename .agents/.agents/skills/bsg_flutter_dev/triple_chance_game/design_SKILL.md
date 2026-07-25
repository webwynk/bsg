---
name: bsg-ui-design
description: >
  Complete UI/UX design specification for BSG (Best Smart Game) Flutter casino app.
  Covers every screen pixel-perfectly: Login, Game Lobby, Game Screen (wheel + grids),
  Win/Lose overlays, and Profile. Use this skill when designing or implementing any
  screen in the BSG app to ensure visual consistency with the premium casino aesthetic.
---

# BSG — UI Design Specification
## Best Smart Game | Casino Points App

---

## MASTER DESIGN SYSTEM

### Color Palette
```
BACKGROUNDS
  bgBase:       #060000   — main app background (near-black red tint)
  bgSurface:    #120000   — cards, panels background
  bgPanel:      #1E0400   — elevated panel surface
  bgPanelLight: #2A0800   — lighter panel accent

GOLD SYSTEM (use for all premium/win elements)
  goldBright:   #FFD700   — highlights, stars, active states
  goldPrimary:  #D4AF37   — borders, decorations
  goldDark:     #8B6914   — shadows on gold
  goldDarkest:  #5a3f00   — deepest gold shadows
  goldGlow:     #F5A623   — glow effects, text highlights

RED SYSTEM (casino identity color)
  casinoRed:    #C41E3A   — buttons, labels, active accents
  deepRed:      #8B0000   — wheel ring, panel backgrounds
  darkRed:      #1a0000   — near-black backgrounds

WHEEL RING COLORS
  redRing1:     #6B0000   — red ring even segments
  redRing2:     #AA2020   — red ring odd segments
  greenRing1:   #0A3D1F   — green ring even segments
  greenRing2:   #176930   — green ring odd segments
  blackRing1:   #0d0d0d   — black ring even segments
  blackRing2:   #2a2a2a   — black ring odd segments

NUMBER CELL COLORS
  cellGreenTop:  #3D9A3D  — green cell gradient top
  cellGreenBot:  #1A6A1A  — green cell gradient bottom
  cellPinkTop:   #D06070  — pink/red cell gradient top
  cellPinkBot:   #A02030  — pink/red cell gradient bottom
  cellSelected:  #9A7000→#6A4500 — selected state (gold)

UI ELEMENTS
  blueLens:     #1a3f99   — result window background
  blueLensDark: #060f3a   — result window bottom
  textCream:    #F0E8D0   — primary text
  textMuted:    #666666   — secondary/disabled text
  successGreen: #27AE60   — win states, active badges
  dangerRed:    #E74C3C   — error states, balance warnings
  rowArrow:     #4CAF50   — row/column selector arrows
```

### Typography
```
FONT: CinzelDecorative (weight 700, 900)
  USE: Game titles, logo text, "Triple Chance" header
  SIZES: 18–28px landscape

FONT: Rajdhani (weight 500, 600, 700)
  USE: All numbers — balance, countdown, results, grid digits
  SIZES: 9px (grid cells) → 68px (result overlay number)

FONT: Oswald (weight 300, 400, 600, 700)
  USE: Labels, buttons, UI text, legends
  SIZES: 8px (tiny labels) → 16px (section headers)
```

### Common Decorative Rules
```
GOLD BORDER PANELS:     1.5–2.5px solid #D4AF37
PANEL SHADOWS:          0 0 30px rgba(0,0,0,0.8) + gold glow
BUTTON GLOSS:           white gradient overlay top 35%, opacity 15-25%
CELL GLOSS:             white gradient overlay top 40%, opacity 20-30%
GRID FRAME:             golden ornate border, darker inner shadow
SELECTED CELL GLOW:     BoxShadow #FFD700 blur 12, spread 2, opacity 50%
```

---

## SCREEN 1 — LOGIN SCREEN

### Layout: Centered card on full-screen background

```
BACKGROUND STACK (bottom → top):
  1. bg_login.png — full screen, BoxFit.cover
     Deep red radial, sunburst rays, casino elements on sides:
       LEFT SIDE: fortune wheel + fanned playing cards (partial, artistic)
       RIGHT SIDE: roulette wheel + stacked chips (partial, artistic)
  2. Vignette overlay: dark gradient edges, transparent center
  3. LOGIN CARD (center)
```

### Login Card
```
SIZE: width 420px, height auto (landscape: ~380px)
POSITION: exact center of screen

DECORATION:
  background gradient: #2A0800 (top-left) → #100000 (bottom-right)
  border: 2.5px solid #D4AF37
  borderRadius: 24px
  shadows:
    - color: #66D4AF37, blur: 40, spread: 0   ← gold aura
    - color: #CC000000, blur: 60, offset: (0,20) ← depth shadow
  padding: 40px horizontal, 32px vertical
```

### Logo Badge (overlapping top of card)
```
ELEMENT: Image.asset('assets/images/logo_bsg_full.png')
SIZE: height 130px, width auto (contain)
POSITION: Centered, top edge overlaps card by ~50px (negative margin)
EFFECT: drop shadow below logo
```

### "MEMBER LOGIN" Label
```
TEXT: "MEMBER LOGIN"
STYLE: Oswald Bold, 14px, #D4AF37, letterSpacing: 4
LAYOUT: Row: [gold line 40px] — MEMBER LOGIN — [gold line 40px]
        Gold lines: Container height 1px, color #D4AF37, opacity 60%
```

### Text Fields (Username + Password)
```
CONTAINER: each field has 8px gap between them

DECORATION:
  fillColor: #1a0800
  borderRadius: 8px
  border normal:  1px #4a1500
  border focused: 1.5px #D4AF37

PREFIX ICON: 20px gold #D4AF37
  Username: Icons.person_outline
  Password: Icons.lock_outline

TEXT STYLE: Rajdhani SemiBold, 16px, white
HINT STYLE: Oswald Regular, 15px, #666666
CONTENT PADDING: horizontal 16, vertical 14

PASSWORD: obscureText toggle with eye icon suffix (gold color)
```

### LOGIN Button
```
SIZE: full width, height 54px, borderRadius 12px
GRADIENT: LinearGradient(
  colors: [#FFE066, #FFD700, #D4AF37, #8B6914]
  begin: Alignment.centerLeft, end: Alignment.centerRight
)
BORDER: 1.5px #FFEE88 (inner bevel top), 1.5px #5a3f00 (inner bevel bottom)
SHADOW: BoxShadow(color: #66FFD700, blur: 20, spread: 0)
GLOSS: white overlay top 35%, opacity 20%

TEXT: "LOGIN"
STYLE: Oswald Bold, 18px, #1A0800 (dark on gold), letterSpacing: 4

LOADING STATE: swap text for CircularProgressIndicator(color: #1A0800, size: 24)
PRESS ANIMATION: scale 0.97, brightness 0.92
```

### Error + Footer
```
ERROR: Row [❌ icon] + text, color: #E74C3C, Oswald 12px
ANIMATION: slideUp + fadeIn on appear

FOOTER: "FOR AMUSEMENT ONLY — VIRTUAL POINTS ONLY"
STYLE: Oswald Light, 9px, #444444, centered
```

### Login Screen Animations
```
ON LOAD:
  Card:   fadeIn(600ms) + slideY(from: 0.3)
  Logo:   fadeIn(delay: 200ms) + scale(from: 0.7, curve: elasticOut)
  Fields: fadeIn(delay: 400ms) + slideX(from: -0.2)
  Button: fadeIn(delay: 600ms) + slideY(from: 0.2)

ON ERROR:
  Card: horizontal shake animation — translateX oscillates ±8px × 4 times, 50ms each
```

---

## SCREEN 2 — GAME LOBBY

### Layout: Top bar + Game grid

```
BACKGROUND: Image.asset('assets/images/bg_lobby.png'), BoxFit.cover
```

### Top Bar
```
HEIGHT: 52px
BACKGROUND: LinearGradient(#3A1800 → #2A0E00 → #3A1800, horizontal)
BORDER BOTTOM: 1.5px solid #D4AF37

SECTIONS (Row MainAxisAlignment.spaceBetween):

LEFT GROUP (Row):
  - Image(icon_bsg_1024.png, height: 36)
  - Gap 8px
  - Column:
      "Welcome" — Oswald Light 9px, #D4AF37
      username  — Rajdhani Bold 16px, white

CENTER:
  "FOR AMUSEMENT ONLY"
  Oswald Bold 11px, #D4AF37, letterSpacing: 3

RIGHT GROUP (Row):
  Balance box:
    decoration: fillColor #1a0000, border 1px #D4AF37, radius 8px
    padding: 6px 12px
    Row:
      "🪙" emoji 18px
      Gap 6px
      Column:
        "Balance" — Oswald 9px, #666
        balance value — Rajdhani Bold 16px, #E74C3C (red)
  Gap 10px
  Lock IconButton — gold color — onPressed: logout confirmation
```

### Game Card Grid
```
LAYOUT: GridView.builder
  padding: 24px horizontal, 16px vertical
  crossAxisCount: 5
  childAspectRatio: 0.72   (portrait cards)
  crossAxisSpacing: 16
  mainAxisSpacing: 16

TOTAL CARDS: 10 (2 rows × 5 columns)
  Card 0: Triple Chance (ACTIVE)  — card_triple_chance.png
  Cards 1–9: Coming Soon (LOCKED) — card_coming_soon.png
```

### Each Game Card
```
DECORATION:
  borderRadius: 16px
  border: 2.5px solid #D4AF37
  boxShadow: [
    BoxShadow(color: #44D4AF37, blur: 12),  ← gold glow
    BoxShadow(color: #88000000, blur: 8, offset: (0,4))  ← depth
  ]
  clipBehavior: Clip.antiAlias

STACK LAYERS (bottom → top):
  1. Image(cardImage, fit: BoxFit.cover)  — fills card
  2. Gradient overlay bottom half:
     Container(gradient: transparent → #DD000000, height: 50%)
     Positioned at bottom
  3. Game title text (bottom positioned):
     Padding 10px
     CinzelDecorative Bold, 14px, #FFD700
     Shadow: dark, offset (1,1)

ACTIVE CARD (Triple Chance) EXTRA:
  - AnimatedScale on hover: 1.0 → 1.05 (150ms)
  - Subtle gold border pulse animation (infinite 2s, opacity 0.3→1.0)
  - Tap → navigate to game screen

LOCKED CARD:
  - "CONTACT ADMIN" green ribbon (diagonal, top-right):
    Container(color: #27AE60, angle: 45°, padding: 4px 20px)
    Text: "CONTACT ADMIN", white, Oswald Bold 9px
  - Dark overlay on image (opacity: #44000000)
  - Tap → show SnackBar "Contact your agent to unlock"
```

### Page Indicator (Bottom)
```
Row centered, 2 dots:
  Active dot:  Container(width:12, height:12, color:#FFD700, radius:6)
  Inactive dot: Container(width:10, height:10, border: 1.5px #D4AF37, radius:5)
  Gap: 8px between dots
```

### Lobby Entrance Animation
```
Cards stagger in: each card slides up + fades in
  delay = cardIndex × 80ms
  duration: 400ms, curve: easeOut
  slideY(begin: 0.5) + fadeIn()
```

---

## SCREEN 3 — GAME SCREEN (TRIPLE CHANCE)

### Full Screen Stack Layout
```
BACKGROUND: Image(bg_game_curtain.png, fit: BoxFit.cover)
  Red velvet curtain with deep folds, warm spotlight from above

LAYER STACK:
  1. bg_game_curtain.png (full screen)
  2. Main game Row layout
  3. Number grid drawer (slides from left)
  4. Result overlay (shows after spin)
  5. Confetti (on win)
```

### Left Tab Strip — Always Visible
```
WIDTH: 52px, FULL HEIGHT
BACKGROUND: #1a0000 → #0a0000 gradient (top to bottom)
BORDER RIGHT: 1.5px solid #3a0800

3 TAB SECTIONS (each 1/3 of height):

Each section contains (Column centered):
  TOP: WIN display box
    Container: dark #0a0000, border 1px #AA0000, radius 4px, padding 2px
    Text: "WIN : 0" — Oswald Bold 9px, white, rotated 90° (if vertical layout)
    
  MIDDLE: Mode label (rotated text)
    Text: "SINGLE" / "DOUBLE" / "TRIPLE"
    Style: Oswald Bold 11px, letterSpacing: 2
    Transform: rotate(-90°) so text reads bottom-to-top
    
  BOTTOM: PLAY display box + arrow
    Container: dark, border 1px red, round
    Text: "PLAY : 0" — same style as WIN
    Below: Triangle arrow ▶ (green #27AE60, 12px)
    
TAB STATES:
  INACTIVE: text color #666, bg #1a0000, border #3a0800
  ACTIVE:   text color #FFD700, bg #4a1800 → #2d0a00, border right #FFD700

ON TAP: slide open number grid drawer for that mode
```

### Center Wheel Panel
```
WIDTH: fills remaining space after tabs and right panel
PADDING: 8px all sides

COLUMN (top to bottom):
  1. Game title "✦ Triple Chance ✦"
     CinzelDecorative Black, 22px
     Gold gradient shader: #FFE57F → #FFD700 → #D4AF37
     TextShadow: dark, blur 8px
     ShaderMask with goldGradient

  2. Subtitle "SELECT · SPIN · WIN"
     Oswald Regular, 9px, #aa8800, letterSpacing: 4

  3. Status text row (live updates)
     "PLACE YOUR BETS" → "🎰 SPINNING..." → "TAP A MODE TO SELECT"
     Oswald SemiBold, 10px, #FFD700, letterSpacing: 2

  4. WHEEL (Expanded, centered)
     See WHEEL LAYER SPECIFICATION below

  5. Bottom ornament area (wheel_ornament_bottom.png overlaps bottom of wheel)
```

### Wheel — Complete Layer Stack
```
WHEEL STACK (center-aligned, square):

LAYER 1 (bottom): wheel_ornament_bottom.png
  Positioned: bottom center, overlaps wheel bottom by 15%
  Width: 50% of wheel diameter

LAYER 2: wheel_rim.png
  Size: 100% of wheel widget bounds
  Blend: softLight or normal (outer gold ring frame)

LAYER 3: wheel_stars_ring.png
  Size: 96% of wheel widget bounds
  Shows 8 gold stars around circumference

LAYER 4: ANIMATED RED RING (CustomPainter)
  Radii: outer 85%, inner 62% of wheel radius
  10 segments × 36° each
  Colors: alternating #6B0000 / #AA2020
  Numbers 0–9 (clockwise from top)
  Text: Rajdhani Bold, 14px, #ffbbbb (light red)
  AnimationController duration: 4.0s, Curves.decelerate

LAYER 5: ANIMATED GREEN RING (CustomPainter)
  Radii: outer 59%, inner 43%
  Colors: alternating #0A3D1F / #176930
  Numbers 0–9
  Text: Rajdhani Bold, 12px, #aaffcc (light green)
  AnimationController duration: 4.5s, Curves.decelerate

LAYER 6: ANIMATED BLACK RING (CustomPainter)
  Radii: outer 40%, inner 29%
  Colors: alternating #0d0d0d / #2a2a2a
  Numbers 0–9
  Text: Rajdhani Bold, 10px, #ffffff (white)
  AnimationController duration: 3.6s, Curves.decelerate

LAYER 7: Gold separator circles (non-rotating, painted)
  Circle at R=85%, R=62%, R=43%, R=29%
  Stroke: 1.8px, #D4AF37

LAYER 8: wheel_hub.png (non-rotating)
  Size: 22% of wheel diameter
  Position: exact center
  3D golden sphere

LAYER 9: RESULT LENS (non-rotating overlay)
  Position: 12 o'clock, covers 3 rings vertically
  Width: 32px, height: covers from R=86% to R=28%
  Background: LinearGradient(#1a3f99 top → #060f3a bottom)
  Border: 1.5px solid #5577ff
  Radius: 6px

  3 SLOTS stacked (for each ring):
    RED slot   (top):    text color #ff9999
    GREEN slot (middle): text color #99ffbb
    BLACK slot (bottom): text color #ffffff
    Horizontal dividers: 0.7px #5577ff between slots
    Text: Rajdhani Bold 22px, centered
    Default: "—", After spin: the digit (0–9)

LAYER 10: wheel_gem_top.png
  Position: top of wheel, 12 o'clock
  Size: ~32×44px (small green gem)

LAYER 11: Gold pointer/arrow (painted)
  Downward triangle at top center
  Color: #D4AF37, stroke #FFD700 1px
  Small white dot at tip

LAYER 12: wheel_stars_ring.png (some positioned individually as gold stars)
  6–8 stars visible around outer rim
```

### Right Control Panel
```
WIDTH: 220px, FULL HEIGHT
BACKGROUND: #150500 → #060000 (top to bottom gradient)
BORDER LEFT: 1.5px solid #D4AF37

SECTIONS (Column, top to bottom):

── HEADER ──
Height 30px, background #2a0500
Text: "Place your chips" — Oswald 10px, #e06060 (pink-red), letterSpacing: 1.5
Small red ✕ close button top-right (closes game, returns to lobby)

── PLAY / BALANCE ROW ──
Row, space-between:
  Left: Column [PLAY label] [play amount value]
  Right: Column [BALANCE label] [balance value]
  PLAY label: Oswald 8px, #888
  PLAY value: Rajdhani Bold 16px, white
  BALANCE label: Oswald 8px, #888
  BALANCE value: Rajdhani Bold 18px, white (or gold if changed)

── WIN ROW ──
Row: "WIN:" label + win value
  Same style, green color for win amount

── HISTORY GRID ──
Container: border 1px #6a2000, radius 5px, padding 6px
Label: "RESULT HISTORY" Oswald 8px, #444, letterSpacing: 2
3 rows × 10 dots = 30 history items
Each dot: Circle 18px, unique color per digit 0–9:
  0=#151515, 1=#6b0000, 2=#0a4020, 3=#6b0000, 4=#0a4020
  5=#6b0000, 6=#0a4020, 7=#142860, 8=#4a006a, 9=#0a4020
Shows digit number inside dot (Rajdhani Bold 9px white)

── CHIP ROW ──
Row, 5 chips, centered:
  chip_2.png, chip_5.png, chip_10.png, chip_50.png, chip_100.png
  Each: 44×44px Image
  INACTIVE: normal size, subtle shadow
  ACTIVE: scale 1.18 + translateY(-6px) + gold border glow

── ACTION BUTTONS (2×2 grid) ──
GridView 2 columns × 2 rows:
  [INFO green]    [DOUBLE amber]
  [CLEAR red]     [REMOVE purple]
Each button:
  Height 34px, radius 6px, Oswald Bold 11px, letterSpacing: 1.5
  Gradients:
    INFO:   #229954 → #196f3d
    DOUBLE: #d4820a → #b7690a
    CLEAR:  #a93226 → #922b21
    REMOVE: #7d3c98 → #6c3483
  Gloss overlay top 35%

── SPIN BUTTON ──
Full width × 52px, radius 8px
Gradient: #FFE066 → #FFD700 → #C9920A → #8B6914 (left to right)
Shadow: gold glow BoxShadow(#66FFD700, blur: 18)
Shimmer animation: infinite left-to-right while enabled+idle
Text: "▶  SPIN" Oswald Bold 16px, #1A0800, letterSpacing: 2

States: ENABLED (shimmer) | SPINNING (gray, "SPINNING...") | NO BETS (dim)

── COUNTDOWN ──
Container: dark bg #100500, border 1.5px #D4AF37, radius 7px
  Number: Rajdhani Bold 38px
    >8 seconds: color #FFD700, shadow gold
    ≤8 seconds: color #ff4444, scale pulse animation (1.0→1.08, 500ms infinite)
  Label: "SECONDS LEFT" Oswald 8px, #4a4a4a, letterSpacing: 3
```

---

## SCREEN 4 — NUMBER GRIDS (Slide-in Drawer)

### Drawer Container
```
SLIDE ANIMATION:
  Closed: translateX = -(drawerWidth) — hidden off left edge
  Open:   translateX = 0 — fully visible
  Duration: 300ms, Curves.easeInOut
  Trigger: tap any mode tab in left strip

DRAWER SIZE: width 340px (Single) / 580px (Double) / 620px (Triple)
FULL HEIGHT

DECORATION:
  gradient: #2a0800 → #180400
  border RIGHT: 2px solid #D4AF37
  boxShadow: right side, spread: 20, blur: 40, black 70%
```

### Drawer Header
```
Height: 44px, border bottom: 1px #D4AF37
Row:
  ← back arrow (gold) — closes drawer
  Spacer
  Mode title: "SINGLE DIGIT" / "DOUBLE DIGIT" / "TRIPLE DIGIT"
    Oswald Bold 13px, #D4AF37, letterSpacing: 2
  Spacer

Below: bet summary strip (Row):
  3 dark boxes: [PLAY: 0] [PICKS: 0] [WIN IF HIT: 0]
  Each box: dark bg, gold border 1px, radius 4px, 6px padding
```

### SINGLE Grid
```
GRID: 2 columns × 5 rows (10 cells for digits 0–9)
CELL SIZE: large — fills drawer width evenly
MIN HEIGHT per cell: 52px

CELL DESIGN (GestureDetector → Container):
  borderRadius: 10px
  gradient (LinearGradient top→bottom):
    GREEN: #3D9A3D → #1A6A1A  (even index: 0,2,4,6,8)
    PINK:  #D06070 → #A02030  (odd index: 1,3,5,7,9)
  border: 1.5px solid (darker shade of fill)
  Stack:
    - Gradient fill
    - Gloss overlay: white gradient top 40%, opacity 25%
    - Number text: Rajdhani Bold 26px, white, centered

SELECTED CELL:
  gradient: #9A7000 → #6A4500
  border: 2.5px solid #FFD700
  boxShadow: #88FFD700 blur 12, spread 2
  Transform.scale: 1.06

SPACING: 8px between cells
```

### DOUBLE Grid
```
GRID: 10 columns × 10 rows (100 cells for 00–99)
CELL SIZE: compact squares

LEFT SIDE: Column of 10 blue arrow row-selector buttons
  Each: 24px height, full row width indicator
  Icon: blue arrow ▶ (#4CAF50 green actually from screenshot)
  Tapping selects/deselects entire row

BOTTOM: Row of 10 blue arrow column-selector buttons
  Same pattern for columns

RIGHT SIDE: Chip value shortcut buttons (vertical column)
  Red rounded rectangles: [5] [10] [15] [20] [25] [50] [75]
  Each: 30×30px, red gradient #C41E3A→#8B0000, white Rajdhani Bold 11px

CELL DESIGN:
  Same green/pink alternating pattern: (row+col) % 2
  Size: ~42px × 30px (wider than tall)
  Number: Rajdhani Bold 11px, dark text
  borderRadius: 4px
  
GOLDEN FRAME around grid:
  Outer border: ornate gold frame (#D4AF37)
  Inner shadow: dark inner glow
```

### TRIPLE Grid
```
TOP PAGE SELECTOR ROW:
  10 tab buttons: [000][100][200][300][400][500][600][700][800][900]
  Each tab: 
    Width: fills evenly, height: 28px
    INACTIVE: dark bg #1a0000, border 1px #3a0800, text #666, Rajdhani 10px
    ACTIVE:   bg #2a1000, border 1.5px #FFD700, text #FFD700
  Active page shows: 000-099, 100-199, etc.

GRID: same 10×10 layout as Double but with 3-digit numbers
  Numbers: Rajdhani Bold 9px (very small)
  
RIGHT SIDE: Chip shortcuts [5][10][15][20][25][50][100]
LEFT + BOTTOM: Row/column arrow selectors (same as Double)
```

---

## SCREEN 5 — WIN OVERLAY

```
FULL SCREEN STACK:
  1. BackdropFilter: blur 6px
  2. Container: Colors.black.withOpacity(0.82)
  3. Result card (centered)

RESULT CARD:
  Background: Image(card_result_win.png) — dark gold-bordered card
  Width: 340px
  
  Stack on card image (Column, centered, padded 28px):
  
  Row 1: "SPIN RESULT"
    Oswald 9px, #555, letterSpacing: 3
    
  Row 2: 3-digit result (HUGE)
    "${red}${green}${black}" — Rajdhani Bold 68px
    WIN color:  #FFD700 + TextShadow gold glow
    LOSE color: #333333
    
  Row 3: Color-coded breakdown
    3 pill badges side by side:
      RED:   Container(bg:#6B0000, radius:8, padding:4×10) "R: ${r}"
      GREEN: Container(bg:#0A3D1F) "G: ${g}"
      BLACK: Container(bg:#1a1a1a) "B: ${b}"
    Below: match text "✓ ${selection} MATCHED!" green or "✗ No match" #555
    
  Row 4: WIN message
    Image(text_you_win.png, width: 220) — only on WIN
    OR Text "😔 NO WIN" Oswald 20px, #444 — on LOSE
    
  Row 5: Points earned/lost
    WIN:  "+${amount}" Rajdhani Bold 28px gold
          " points" Rajdhani 20px white
    LOSE: "Better luck next round!" Oswald 12px #555
    
  Row 6: NEXT ROUND button
    Full width, 50px, radius 10px
    Gold gradient same as SPIN button
    Text: "▶ NEXT ROUND" Oswald Bold 14px, letterSpacing: 2, #1A0800

CARD ENTRANCE:
  scale from 0.5 → 1.0, curve: Curves.elasticOut, duration: 500ms
  + fadeIn 300ms
```

### Win Celebration
```
CONFETTI: shoot from top-center, blast downward
  80 particles, colors: gold+white+red+green+blue+purple
  
SOUND: win.mp3 plays on card appear

VIBRATION: pattern [0, 100, 50, 200] — short, short-short-long
  Casino slot-win feel
```

### Lose Overlay
```
SAME card structure but:
  Dimmer overall (overlay opacity 0.88 instead of 0.82)
  Result number: dark gray
  No confetti
  lose.mp3 plays
  Single soft vibration: 80ms
  
  NEXT ROUND button slightly smaller
```

---

## SCREEN 6 — PROFILE SCREEN

```
BACKGROUND: bg_game_curtain.png + dark overlay (#660a0000)

HEADER BAR:
  ← back arrow (gold) | "MY ACCOUNT" Oswald Bold 16px letterSpacing:3 | ⚙ settings

SCROLLABLE CONTENT (Column):

PROFILE CARD (golden bordered):
  Row:
    Avatar: CircleAvatar, gold gradient, 2-char initials, radius 28px
    Column:
      username: Rajdhani Bold 20px white
      "Agent: ${name}": Oswald 12px #aa8800
      Status badge: "● ACTIVE" green pill OR "● INACTIVE" red pill

BALANCE DISPLAY:
  Container: dark bg, double gold border, glow shadow
  🪙 icon + "Points Balance" label + big number
  Number: Rajdhani Bold 42px, #FFD700

STATS ROW (3 boxes):
  TOTAL GAMES | TOTAL WON | TOTAL LOST
  Values: Rajdhani Bold 24px, labels: Oswald 9px muted

TABS: "POINT HISTORY" | "GAME HISTORY"
  Active tab: gold underline 2px, gold text
  Inactive: muted text

POINT HISTORY LIST:
  Each row: [↑↓ icon] [type badge] [note] [±amount] [balance after] [date]
  Credit: ↑ green icon, amount green "+100"
  Debit:  ↓ red icon, amount red "-10"
  Divider: gold 0.3 opacity

GAME HISTORY LIST:
  Each row: [date] [S/D/T badge] [R G B result dots] [✓✗] [±points]
  Result dots: 3 small circles (red/green/dark bg) with digit
  Win row: subtle green background tint
  Lose row: subtle red background tint

SETTINGS SECTION:
  🔊 Sound     — Switch (gold color scheme)
  📳 Vibration — Switch
  🔒 Change Password → dialog
  🚪 Logout → confirmation → clearSession → navigate /login
```

---

## ANIMATION SUMMARY

```
LOGIN:
  Card entrance:     slideY(0.3→0) + fadeIn, 600ms
  Logo bounce:       scale(0.7→1.0), elasticOut, 800ms
  Error shake:       translateX ±8px × 4, 50ms each

LOBBY:
  Cards stagger in:  each slideY(0.5→0) + fadeIn, delay: index×80ms

GAME SCREEN:
  Mode drawer:       translateX(-width→0), 300ms, easeInOut
  Chip select:       translateY(0→-6) + scale(1.0→1.18), 150ms
  Countdown red:     scale pulse 1.0→1.08, 500ms infinite
  SPIN button shimmer: left→right brightness wave, 2s infinite
  Wheel spin:        rotate, decelerate curve, 3.6–4.5s per ring

RESULT OVERLAY:
  Card entrance:     scale(0.5→1.0) elasticOut + fadeIn, 500ms
  Result number:     scale(0.2→1.0) spring + fadeIn, delay: 200ms after card
  Confetti:          burst from top, gravity fall, 3 seconds
```

---

## ASSET MANIFEST (complete list)
```
assets/images/
  bg_login.png              → Login background
  bg_lobby.png              → Lobby background
  bg_game_curtain.png       → Game screen background
  logo_bsg_full.png         → Login screen logo badge
  icon_bsg_1024.png         → Top bar mini icon + app icon
  logo_text_horizontal.png  → (reserved)
  wheel_rim.png             → Wheel outer gold frame
  wheel_stars_ring.png      → Stars around wheel
  wheel_hub.png             → Golden center ball
  wheel_ornament_bottom.png → Bottom scrollwork
  wheel_gem_top.png         → Top green gem
  chip_2.png                → Purple chip (denomination 2)
  chip_5.png                → Pink chip (denomination 5)
  chip_10.png               → Silver chip (denomination 10)
  chip_50.png               → Green chip (denomination 50)
  chip_100.png              → Black+Gold chip (denomination 100)
  card_triple_chance.png    → Game lobby card thumbnail
  card_coming_soon.png      → Locked game card
  card_result_win.png       → Result overlay card background
  text_you_win.png          → "YOU WIN!" text graphic
  single_star.png           → Decorative gold star

assets/sounds/
  spin_start.mp3            → Wheel starts spinning
  spin_tick.mp3             → Tick during spin
  spin_stop.mp3             → Wheel stops
  win.mp3                   → Win fanfare
  lose.mp3                  → Soft lose tone
  chip_click.mp3            → Number cell tap
  button_click.mp3          → Button press

assets/fonts/
  CinzelDecorative-Bold.ttf
  CinzelDecorative-Black.ttf
  Rajdhani-Medium.ttf
  Rajdhani-SemiBold.ttf
  Rajdhani-Bold.ttf
  Oswald-Light.ttf
  Oswald-Regular.ttf
  Oswald-SemiBold.ttf
  Oswald-Bold.ttf
```
