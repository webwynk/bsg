---
name: bsg-flutter-dev
description: >
  Phase-by-phase Flutter development guide for BSG (Best Smart Game) casino app.
  Covers full implementation from project setup to APK build: pubspec, theme, models,
  state management (Provider), all screens (login/lobby/game/profile), wheel
  CustomPainter with 3 animated rings, collapsible number grid drawer for
  SINGLE/DOUBLE/TRIPLE modes, result overlays, sounds, and release APK generation.
  Use this skill when building or extending any part of the BSG Flutter app.
---

# BSG Flutter Development — Phase-by-Phase Guide
## Best Smart Game | Claude Code Implementation

> **USAGE:** Tell Claude Code: "Read bsg-flutter-dev skill and implement Phase N"
> Claude Code reads this file directly and writes all files to your project.
> Always run `flutter pub get` and `flutter run` after each phase to verify.

---

## PROJECT ROOTS

```
Flutter project: D:\Download\Game\bsg_app\
Assets source:   D:\Download\Game\assets\
Design spec:     Read bsg-ui-design skill for pixel-perfect details
```

---

## PHASE 1 — PROJECT SETUP

### 1.1 Create Flutter Project
```bash
cd D:\Download\Game
flutter create bsg_app --org com.bsg --project-name best_smart_game
cd bsg_app

# Copy assets
xcopy ..\assets assets\ /E /I /Y

# Create font folder (user downloads fonts from fonts.google.com)
mkdir assets\fonts
mkdir assets\sounds
```

### 1.2 pubspec.yaml (complete)
```yaml
name: best_smart_game
description: BSG - Best Smart Game Casino App
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  http: ^1.1.0
  provider: ^6.1.1
  shared_preferences: ^2.2.2
  google_fonts: ^6.1.0
  audioplayers: ^5.2.1
  confetti: ^0.7.0
  flutter_animate: ^4.3.0
  shimmer: ^3.0.0
  vibration: ^1.8.4
  wakelock_plus: ^1.1.4

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_launcher_icons: ^0.13.1
  flutter_native_splash: ^2.3.6

flutter_launcher_icons:
  android: true
  image_path: "assets/images/icon_bsg_1024.png"
  adaptive_icon_background: "#060000"
  adaptive_icon_foreground: "assets/images/icon_bsg_1024.png"

flutter_native_splash:
  color: "#060000"
  image: assets/images/logo_bsg_full.png
  fullscreen: true

flutter:
  uses-material-design: true
  assets:
    - assets/images/
    - assets/sounds/
    - assets/fonts/
  fonts:
    - family: CinzelDecorative
      fonts:
        - asset: assets/fonts/CinzelDecorative-Bold.ttf
          weight: 700
        - asset: assets/fonts/CinzelDecorative-Black.ttf
          weight: 900
    - family: Rajdhani
      fonts:
        - asset: assets/fonts/Rajdhani-Medium.ttf
          weight: 500
        - asset: assets/fonts/Rajdhani-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/Rajdhani-Bold.ttf
          weight: 700
    - family: Oswald
      fonts:
        - asset: assets/fonts/Oswald-Light.ttf
          weight: 300
        - asset: assets/fonts/Oswald-Regular.ttf
          weight: 400
        - asset: assets/fonts/Oswald-SemiBold.ttf
          weight: 600
        - asset: assets/fonts/Oswald-Bold.ttf
          weight: 700
```

### 1.3 Android Configuration
```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<!-- Add to <activity> tag: -->
android:screenOrientation="sensorLandscape"
android:theme="@style/LaunchTheme"

<!-- Add inside <manifest>: -->
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.VIBRATE"/>
<uses-permission android:name="android.permission.WAKE_LOCK"/>
```

### 1.4 main.dart
```dart
// lib/main.dart
// - SystemChrome: landscape + fullscreen immersive sticky
// - WakelockPlus.enable()
// - MultiProvider: AuthProvider, GameProvider
// - MaterialApp with dark ThemeData base
// - initialRoute: '/splash'
// - routes: splash, login, lobby, game, profile
// - debugShowCheckedModeBanner: false
```

### 1.5 Folder Structure
```
lib/
├── main.dart
├── theme/
│   ├── app_colors.dart
│   ├── app_text_styles.dart
│   └── app_decorations.dart
├── models/
│   ├── user_model.dart
│   ├── spin_result_model.dart
│   └── transaction_model.dart
├── services/
│   ├── api_service.dart      ← STUB (real API added later)
│   ├── auth_service.dart
│   └── sound_service.dart
├── providers/
│   ├── auth_provider.dart
│   └── game_provider.dart
└── screens/
    ├── splash_screen.dart
    ├── login_screen.dart
    ├── lobby_screen.dart
    ├── game_screen.dart
    └── profile_screen.dart
    
lib/widgets/
├── wheel/
│   ├── wheel_widget.dart
│   ├── wheel_painter.dart    ← CustomPainter for 3 rings
│   └── result_lens.dart
├── panels/
│   ├── left_tab_strip.dart   ← always-visible SINGLE/DOUBLE/TRIPLE tabs
│   ├── number_drawer.dart    ← slide-in drawer container
│   ├── grid_single.dart      ← 2×5 digit grid
│   ├── grid_double.dart      ← 10×10 two-digit grid
│   └── grid_triple.dart      ← paged 10×10 three-digit grid
├── controls/
│   ├── chip_row.dart
│   ├── spin_button.dart
│   ├── action_buttons.dart
│   └── countdown_widget.dart
└── overlays/
    ├── result_overlay.dart
    └── win_celebration.dart
```

**Verify:** `flutter doctor` — all green ✓, `flutter pub get` — no errors

---

## PHASE 2 — THEME SYSTEM

### 2.1 app_colors.dart
```
Define all colors as static const Color values.
Include static const LinearGradient objects for:
  goldGradient, redGradient, darkBgGradient, goldShimmer
See bsg-ui-design skill for exact hex values.
```

### 2.2 app_text_styles.dart
```
Define static TextStyle factory methods:
  gameTitle(double size)    → CinzelDecorative 900
  number(double size)       → Rajdhani 700
  countdown(double size)    → Rajdhani 700 with gold glow shadow
  label(double size)        → Oswald 600 letterSpacing 1.5
  button(double size)       → Oswald 700 letterSpacing 2.0
  balance(double size)      → Rajdhani 700 gold

Each method returns TextStyle with embedded shadows where needed.
```

### 2.3 app_decorations.dart
```
Define static BoxDecoration getters:
  goldBorderPanel    → dark bg + 2px gold border + gold glow shadow
  chipSelected       → gold border + gold glow BoxShadow
  actionButton(Color) → gradient + gloss overlay + border bevel
  gridFrame          → ornate gold border + inner dark shadow
  resultCard         → dark gradient + 2.5px gold border + glow
  countdownBox       → dark bg + 1.5px gold border + radius 7px
```

---

## PHASE 3 — MODELS + SERVICES

### 3.1 Models

**user_model.dart:**
```
class UserModel:
  id, username, role, balance, agentId, agentName, isActive, token
  factory fromJson(), copyWith(int? balance), toJson()
```

**spin_result_model.dart:**
```
class SpinResult:
  id, red, green, black, resultString, mode, selections, chipValue,
  won, deductedAmount, winAmount, netChange, newBalance, createdAt
  factory fromJson()

String get resultDisplay => '$red$green$black'
bool get isBlackMatch — for single mode
bool get isDoubleMatch — for double mode
bool get isTripleMatch — for triple mode
```

**transaction_model.dart:**
```
class Transaction:
  id, amount, type, balanceAfter, note, createdAt
  bool get isCredit => amount > 0
  String get typeLabel  → human readable
  factory fromJson()
```

### 3.2 ApiService (STUB — real API later)
```dart
// lib/services/api_service.dart
const String BASE_URL = 'https://api.bsg.yourdomain.com';
// TODO: Replace with real URL when dashboard is ready

class ApiService {
  // LOGIN: stub accepts any non-empty credentials
  Future<Map<String,dynamic>> login(username, password) async {
    await Future.delayed(Duration(milliseconds: 800));
    if (username.isEmpty || password.isEmpty) throw 'Enter credentials';
    return { 'token': 'stub_$username', 'user': { stub user data } };
  }

  // SPIN: stub generates result with dart:math Random
  Future<SpinResult> spin(mode, selections, chipValue, token) async {
    await Future.delayed(Duration(milliseconds: 300));
    final r = Random();
    int red = r.nextInt(10), green = r.nextInt(10), black = r.nextInt(10);
    bool won = false;
    if (mode == 'single') won = selections.contains('$black');
    if (mode == 'double') won = selections.contains('$green$black');
    if (mode == 'triple') won = selections.contains('$red$green$black');
    // build and return SpinResult
  }

  // PROFILE: stub returns hardcoded stats
  Future<Map<String,dynamic>> getProfile(token) async { ... }
  Future<List<Transaction>> getTransactions(token) async { return []; }
  Future<List<SpinResult>> getGameHistory(token) async { return []; }
}
```

### 3.3 AuthService
```dart
// lib/services/auth_service.dart
// SharedPreferences keys: auth_token, auth_username, auth_balance, auth_user_id
class AuthService {
  Future<void> saveSession(UserModel user)
  Future<UserModel?> loadSession()
  Future<void> clearSession()
  Future<bool> hasSession()
}
```

### 3.4 SoundService
```dart
// lib/services/sound_service.dart
// Singleton, uses audioplayers package
class SoundService {
  bool isMuted = false;
  void playSpinStart(), playSpinStop(), playWin(), playLose()
  void playChipClick(), playButtonClick()
  void toggleMute()
  // plays 'assets/sounds/filename.mp3' via AudioPlayer
}
```

---

## PHASE 4 — STATE MANAGEMENT (PROVIDERS)

### 4.1 AuthProvider
```dart
class AuthProvider extends ChangeNotifier {
  UserModel? _user;
  bool _loading = false;
  String? _error;

  // Getters
  bool get isLoggedIn, isLoading; UserModel? get user; String? get error;
  int get balance => _user?.balance ?? 0;

  // Methods
  Future<bool> login(String username, String password)
  Future<void> tryAutoLogin()     // loads session from SharedPreferences
  void updateBalance(int newBalance)
  Future<void> logout()
}
```

### 4.2 GameProvider
```dart
class GameProvider extends ChangeNotifier {
  // State fields
  String _mode = 'single';         // 'single' | 'double' | 'triple'
  int _selectedChip = 5;
  Set<String> _selections = {};
  bool _isSpinning = false;
  bool _isDoubled = false;
  int _triplePage = 0;
  SpinResult? _lastResult;
  List<int> _blackHistory = [];    // last 30 BLACK ring results
  int _countdown = 30;
  Timer? _countdownTimer;
  bool _isDrawerOpen = false;

  // Computed
  int get totalBet => _selections.length * _selectedChip;
  int get winIfHit => _selectedChip * (_isDoubled ? 10 : 5);

  // Mode management
  void setMode(String mode, AuthProvider auth)
  void openDrawerWithMode(String mode, AuthProvider auth)
  void closeDrawer()
  void toggleDrawer()

  // Chip + betting
  void setChip(int value, AuthProvider auth)   // refund old → deduct new
  void toggleNumber(String num, AuthProvider auth)  // deduct on select, refund on deselect
  void clearBets(AuthProvider auth)
  void removeLastBet(AuthProvider auth)
  void doDouble(AuthProvider auth)

  // Spin
  Future<SpinResult?> doSpin(AuthProvider auth)  // calls API stub → returns result

  // Countdown
  void startCountdown({required VoidCallback onExpire})
  void resetCountdown({required VoidCallback onExpire})

  // Triple page
  void setTriplePage(int page)
}
```

**KEY RULES for GameProvider:**
```
1. Balance deducted IMMEDIATELY when number is selected
2. Balance refunded IMMEDIATELY when number is deselected
3. Balance refunded if mode is switched (clear all selections)
4. Balance refunded on clearBets() and removeLastBet()
5. Win amount added to balance in doSpin() when won == true
6. Server decides result (in real API) — never trust client for win/lose
```

---

## PHASE 5 — SPLASH + LOGIN SCREENS

### 5.1 SplashScreen
```dart
// lib/screens/splash_screen.dart
// - Show bg_login.png + logo_bsg_full.png centered
// - 2 second delay
// - Call auth.tryAutoLogin()
// - If session exists → navigate /lobby
// - If no session → navigate /login
// - Animate logo: scale + fade in
```

### 5.2 LoginScreen
```dart
// lib/screens/login_screen.dart
// See bsg-ui-design skill for EXACT pixel spec

WIDGET TREE:
Scaffold → Stack:
  Image(bg_login.png, BoxFit.cover)         // background
  Positioned.fill(dark vignette)             // edge darkening
  Center → SizedBox(width:420):              // card container
    Column:
      SizedBox(h:65) // push logo above card
      Stack:
        // Card body
        Container(cardDecoration, padding:40×32):
          Column:
            SizedBox(h:50)  // space for logo overlap
            memberLoginLabel()
            SizedBox(h:20)
            usernameField()
            SizedBox(h:12)
            passwordField()
            SizedBox(h:20)
            loginButton()
            SizedBox(h:12)
            errorMessage()
            SizedBox(h:8)
            footerText()
        
        // Logo overlapping top of card
        Positioned(top:-65, left:0, right:0):
          Center → Image(logo_bsg_full.png, height:130)

ANIMATIONS (flutter_animate):
  Entire card:  .animate().fadeIn(600ms).slideY(begin:0.3)
  Logo:         .animate().fadeIn(delay:200ms).scale(begin:(0.7,0.7), curve:elasticOut)
  Fields:       .animate(delay:400ms).fadeIn().slideX(begin:-0.2)
  Button:       .animate(delay:600ms).fadeIn().slideY(begin:0.2)

ERROR ANIMATION:
  errorCard.animate(target: hasError ? 1 : 0)
    .shakeX(amount:8, count:4, duration:200ms)

ON LOGIN PRESS:
  1. validate fields (not empty)
  2. show loading
  3. auth.login(username, password)
  4. success → Navigator.pushReplacementNamed('/lobby')
  5. fail → show error + shake
```

---

## PHASE 6 — LOBBY SCREEN

```dart
// lib/screens/lobby_screen.dart
// See bsg-ui-design skill for EXACT spec

WIDGET TREE:
Scaffold → Stack:
  Image(bg_lobby.png, BoxFit.cover)
  Column:
    TopBar(height:52)          // logo | welcome | disclaimer | balance | lock
    Expanded:
      GridView.builder(        // 5×2 = 10 game cards
        crossAxisCount: 5,
        childAspectRatio: 0.72,
        padding: EdgeInsets.symmetric(h:24, v:16),
        itemBuilder: (ctx, i) => GameCard(index: i)
      )
    PageIndicator(dots: 2)     // 2 page dots at bottom

GameCard(index):
  GestureDetector(onTap: index==0 ? navigate('/game') : showLockedDialog)
  Container(
    decoration: goldBorderCard,
    child: Stack:
      Image(i==0 ? card_triple_chance : card_coming_soon, BoxFit.cover)
      bottomGradientOverlay
      Positioned(bottom:10): Text(gameName, CinzelDecorative gold)
      if(i>0 && isLocked): ContactAdminRibbon()  // green diagonal
  )

STAGGER ANIMATION:
  .animate(delay: Duration(milliseconds: index * 80))
  .slideY(begin:0.5).fadeIn(duration:400ms)
```

---

## PHASE 7 — GAME SCREEN + LEFT PANELS

```dart
// lib/screens/game_screen.dart

WIDGET TREE:
Scaffold(backgroundColor: Colors.black) → Stack:
  // Layer 1: Background
  Image(bg_game_curtain.png, BoxFit.cover)
  
  // Layer 2: Main layout (Row)
  SafeArea → Row:
    LeftTabStrip()      // 52px wide, always visible
    Expanded(child: CenterWheelPanel())
    RightControlPanel() // 220px wide
  
  // Layer 3: Number Drawer (slides from left over wheel)
  NumberDrawer()        // AnimatedPositioned
  
  // Layer 4: Result Overlay (shows after spin completes)
  Consumer<GameProvider>(
    builder: (ctx, game, _) {
      if (game.lastResult == null) return SizedBox.shrink();
      return ResultOverlay();
    }
  )
```

### LeftTabStrip Widget
```dart
// lib/widgets/panels/left_tab_strip.dart

SizedBox(width:52) → Container(decoration: darkRedPanel, borderRight: gold):
  Column:
    _ModeTab(mode:'single', label:'SINGLE', color:casinoRed)
    Divider(color: #3a0800, height:1)
    _ModeTab(mode:'double', label:'DOUBLE', color:casinoRed)
    Divider(color: #3a0800, height:1)
    _ModeTab(mode:'triple', label:'TRIPLE', color:deepRed)

_ModeTab(mode, label, color):
  Expanded → GestureDetector(
    onTap: () => game.openDrawerWithMode(mode, auth),
    child: AnimatedContainer(
      duration: 200ms,
      decoration: isActive ? activetabDecor : inactiveTabDecor,
      child: Column(mainAxisAlignment: center):
        winDisplay('WIN', game.winForMode(mode))
        SizedBox(h:6)
        RotatedBox(quarterTurns:3):  // rotate -90°
          Text(label, Oswald Bold 11px, letterSpacing:2)
        SizedBox(h:6)
        playDisplay('PLAY', game.playForMode(mode))
        SizedBox(h:4)
        if(isActive) Icon(▶, green, 12px)  // green arrow
    )
  )
```

### NumberDrawer Widget
```dart
// lib/widgets/panels/number_drawer.dart

// Key feature: slides from left, overlays wheel panel

Consumer<GameProvider>(builder: (ctx, game, _) {
  double width = game.mode == 'single' ? 340 :
                 game.mode == 'double' ? 600 : 640;
  return AnimatedPositioned(
    duration: Duration(milliseconds: 300),
    curve: Curves.easeInOut,
    left: game.isDrawerOpen ? 52 : 52 - width,  // 52 = LeftTabStrip width
    top: 0, bottom: 0, width: width,
    child: GestureDetector(  // prevent tap-through
      onTap: () {},
      child: Container(
        decoration: drawerDecoration,  // dark panel, gold right border
        child: Column:
          DrawerHeader()
          BetSummaryStrip()
          Expanded:
            game.mode == 'single' ? GridSingle() :
            game.mode == 'double' ? GridDouble() : GridTriple()
      )
    )
  );
})

// BACKDROP: close drawer when tapping outside
// Wrap entire game screen body with GestureDetector
// that calls game.closeDrawer() if drawer is open
```

### DrawerHeader
```dart
Container(height:44, border-bottom: 1px gold):
  Row:
    IconButton(Icons.arrow_back_ios, gold, onPressed: game.closeDrawer)
    Spacer
    Text(modeTitle, Oswald Bold 13px, gold, letterSpacing:2)
      // "SINGLE DIGIT" / "DOUBLE DIGIT" / "TRIPLE DIGIT"
    Spacer
```

### GridSingle Widget
```dart
// lib/widgets/panels/grid_single.dart
// 2 columns × 5 rows = 10 cells for digits 0–9

GridView.count(
  crossAxisCount: 2,
  childAspectRatio: 1.8,
  padding: EdgeInsets.all(16),
  mainAxisSpacing: 8, crossAxisSpacing: 8,
  children: List.generate(10, (i) => NumberCell(
    number: '$i',
    isSelected: game.selections.contains('$i'),
    isEven: i % 2 == 0,
    onTap: () => game.toggleNumber('$i', auth),
  ))
)

NumberCell:
  GestureDetector → AnimatedContainer(duration:150ms):
    decoration: isSelected ? selectedCellDecor :
                isEven ? greenCellDecor : pinkCellDecor
    Transform.scale(scale: isSelected ? 1.06 : 1.0)
    Stack:
      gradientContainer (fill)
      glossOverlay (top 40%, white, opacity 25%)
      Center: Text(number, Rajdhani Bold 26px, white)
```

### GridDouble Widget
```dart
// lib/widgets/panels/grid_double.dart
// 10×10 grid (00-99) + row selectors + chip shortcuts

Row:
  // Left: Row selectors (10 arrow buttons)
  Column(10 items):
    RowArrowButton(rowIndex) for 0..9
    Expanded  // fills gap

  // Center: Grid with golden frame
  Expanded:
    Container(decoration: goldFrameDecor):
      GridView.count(
        crossAxisCount: 10,
        children: List.generate(100, (i) {
          String num = i.toString().padLeft(2, '0');
          return NumberCell(number: num, isEven: (i~/10 + i%10)%2 == 0, ...)
        })
      )

  // Right: Chip value shortcuts
  Column:
    for(int v in [5,10,15,20,25,50,75]):
      ChipShortcutBtn(value: v)

// Bottom of grid:
Row:
  SizedBox(rowBtnWidth)  // align with row selector
  Expanded:
    Row(10 items):
      ColumnArrowButton(colIndex) for 0..9

// RowArrowButton: selects/deselects entire row
// Tap: for digit 0-9, add '${row}0' through '${row}9' to selections
// ChipShortcutBtn: calls game.setChip(value, auth)
```

### GridTriple Widget
```dart
// lib/widgets/panels/grid_triple.dart
// Page tabs 000,100..900 + 10×10 grid for current page

Column:
  // Page tab row
  Row:
    for(int p in [0,1,2,3,4,5,6,7,8,9]):
      Expanded:
        GestureDetector(onTap: () => game.setTriplePage(p)):
          Container(
            decoration: p == game.triplePage ? activePageTab : inactivePageTab,
            child: Text('${p}00', Rajdhani Bold 10px)
          )
  
  // Main grid area (same structure as Double but 3-digit numbers)
  Row:
    RowSelectors
    Expanded:
      Container(decoration: goldFrameDecor):
        GridView.count(
          crossAxisCount: 10,
          children: List.generate(100, (i) {
            int base = game.triplePage * 100;
            String num = (base + i).toString().padLeft(3, '0');
            return NumberCell(number: num, ...)
          })
        )
    ChipShortcuts([5,10,15,20,25,50,100])
  
  ColumnSelectors
```

---

## PHASE 8 — WHEEL + CUSTOM PAINTER

### WheelWidget
```dart
// lib/widgets/wheel/wheel_widget.dart

// AnimationControllers (3 separate, different durations)
_redCtrl:   AnimationController(duration: 4000ms, vsync: this)
_greenCtrl: AnimationController(duration: 4500ms, vsync: this)
_blackCtrl: AnimationController(duration: 3600ms, vsync: this)

// Target rotations (set when spin result arrives)
double _redTarget = 0, _greenTarget = 0, _blackTarget = 0;

// Calculate target rotation for a digit
double _getTarget(double currentRot, int digit) {
  double cur360 = currentRot % 360;
  // Segment i starts at i*36° from top (0° = top)
  double tgt360 = (360 - digit * 36.0) % 360;
  double diff = tgt360 - cur360;
  if (diff <= 0) diff += 360;
  return currentRot + (5 * 360) + diff; // 5 full rotations
}

// WIDGET TREE:
Column:
  titleRow()           // "✦ Triple Chance ✦"
  subtitleRow()        // "SELECT · SPIN · WIN"
  statusRow()          // "PLACE YOUR BETS" etc.
  Expanded:
    LayoutBuilder → AspectRatio(1.0):
      Stack(alignment:center):
        // layer 8: ornament bottom (Positioned bottom)
        Positioned(bottom:0, width:50%):
          Image(wheel_ornament_bottom.png)
        // layer 1: rim
        Image(wheel_rim.png, width:100%, height:100%)
        // layer 2: stars ring
        Image(wheel_stars_ring.png, width:96%)
        // layer 3-5: animated rings (CustomPaint)
        AnimatedBuilder(animation: Listenable.merge([_r,_g,_b])):
          CustomPaint(
            painter: WheelPainter(
              redAngle:   _redCtrl.value * _redTarget / 360 * 2*pi,
              greenAngle: _greenCtrl.value * _greenTarget / 360 * 2*pi,
              blackAngle: _blackCtrl.value * _blackTarget / 360 * 2*pi,
              showNumbers: true,
            ),
            size: Size.square(constraints.maxWidth),
          )
        // layer 6: hub
        SizedBox(22% of size): Image(wheel_hub.png, BoxFit.contain)
        // layer 7: result lens
        Positioned(top:7%, child: ResultLens())
        // layer 8: gem top
        Positioned(top:0): Image(wheel_gem_top.png, height:5%)
        // layer 9: pointer
        Positioned(top:6%): _buildPointer()
```

### WheelPainter
```dart
// lib/widgets/wheel/wheel_painter.dart

class WheelPainter extends CustomPainter {
  final double redAngle;    // current rotation in radians
  final double greenAngle;
  final double blackAngle;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width/2, size.height/2);
    final r = size.width / 2;

    // Ring radii (as fraction of full radius)
    final ringSpec = [
      (0.85, 0.62, redColors,   numbers, redAngle),
      (0.59, 0.43, greenColors, numbers, greenAngle),
      (0.40, 0.29, blackColors, numbers, blackAngle),
    ];

    for (var (outerF, innerF, colors, nums, angle) in ringSpec) {
      canvas.save();
      canvas.translate(center.dx, center.dy);
      canvas.rotate(angle);
      canvas.translate(-center.dx, -center.dy);
      _drawRing(canvas, center, r*outerF, r*innerF, colors, nums);
      canvas.restore();
    }

    // Gold separator circles (non-rotating)
    for (double fr in [0.85, 0.62, 0.43, 0.29]) {
      canvas.drawCircle(center, r*fr,
        Paint()..color=Color(0xFFD4AF37)..style=PaintingStyle.stroke..strokeWidth=1.8);
    }
  }

  void _drawRing(Canvas canvas, Offset center, double outerR, double innerR,
                 List<Color> colors, List<int> digits) {
    for (int i = 0; i < 10; i++) {
      double startAngle = (i * 36 - 90) * pi/180; // -90 so 0° is at top
      double sweepAngle = 36 * pi/180;

      // Draw arc segment
      final paint = Paint()
        ..color = colors[i % 2]
        ..style = PaintingStyle.fill;
      
      Path path = Path()
        ..addArc(Rect.fromCircle(center:center, radius:outerR), startAngle, sweepAngle)
        ..arcTo(Rect.fromCircle(center:center, radius:innerR), startAngle+sweepAngle, -sweepAngle, false)
        ..close();
      canvas.drawPath(path, paint);

      // Draw number text
      double midAngle = startAngle + sweepAngle/2;
      double midR = (outerR + innerR) / 2;
      Offset textPos = Offset(
        center.dx + midR * cos(midAngle),
        center.dy + midR * sin(midAngle),
      );
      _drawText(canvas, '${digits[i]}', textPos, midAngle + pi/2);
    }
  }

  @override bool shouldRepaint(WheelPainter old) =>
    old.redAngle != redAngle || old.greenAngle != greenAngle || old.blackAngle != blackAngle;
}
```

### ResultLens Widget
```dart
// lib/widgets/wheel/result_lens.dart
// Shows RED/GREEN/BLACK digit at 12 o'clock position

Consumer<GameProvider>(builder: (ctx, game, _) {
  SpinResult? r = game.lastResult;
  return Container(
    width: 36, height: 80,  // covers all 3 rings
    decoration: BoxDecoration(
      gradient: LinearGradient(colors:[Color(0xFF1a3f99), Color(0xFF060f3a)], vertical),
      border: Border.all(color: Color(0xFF5577ff), width: 1.5),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Column:
      _slot(r?.red,   Color(0xFFff9999))  // RED digit
      Divider(color: Color(0xFF5577ff), height:0.7)
      _slot(r?.green, Color(0xFF99ffbb))  // GREEN digit
      Divider(color: Color(0xFF5577ff), height:0.7)
      _slot(r?.black, Color(0xFFffffff))  // BLACK digit
  );
})

_slot(int? digit, Color color):
  Expanded: Center: Text(
    digit == null ? '—' : '$digit',
    style: Rajdhani Bold 20px, color: color
  )
```

---

## PHASE 9 — RIGHT CONTROL PANEL

```dart
// lib/widgets/controls/ (multiple files)
// See bsg-ui-design skill SCREEN 3 RIGHT PANEL for exact spec

SizedBox(width:220) → Container(dark gradient, gold left border):
  Column:
    PanelHeader()          // "Place your chips" + X close button
    PlayBalanceRow()       // PLAY: | BALANCE:
    WinRow()               // WIN: amount
    HistoryGrid()          // 3×10 dots of black ring history
    ChipRow()              // 5 chip images, tap to select
    ActionButtonsGrid()    // 2×2: INFO/DOUBLE/CLEAR/REMOVE
    SpinButton()           // gold shimmer, "▶ SPIN"
    CountdownWidget()      // countdown number + "SECONDS LEFT"

ChipRow (chip_row.dart):
  Row of 5 GestureDetectors
  Each: Image(chip_N.png, 44px)
  Selected chip: AnimatedContainer → scale 1.18, translateY -6px, gold glow

SpinButton (spin_button.dart):
  Shimmer.fromColors(
    baseColor: Color(0xFFD4AF37),
    highlightColor: Color(0xFFFFE57F),
    enabled: !game.isSpinning && game.selections.isNotEmpty,
    child: GestureDetector(
      onTap: _handleSpin,
      child: Container(spinButtonDecor): Text("▶  SPIN")
    )
  )

CountdownWidget (countdown_widget.dart):
  Consumer<GameProvider>:
    AnimatedBuilder for scale pulse when <= 8 seconds:
      Text('${game.countdown}', style: countdown(
        color: game.countdown <= 8 ? dangerRed : goldBright
      ))

// ON SPIN:
void _handleSpin() async {
  if (game.isSpinning || game.selections.isEmpty) return;
  game.countdownTimer?.cancel();
  final result = await game.doSpin(auth);
  if (result == null) return;
  // 1. Run wheel animations
  await _animateWheelToResult(result.red, result.green, result.black);
  // 2. Show result overlay (set via notifyListeners in provider)
  // 3. Play sound
  result.won ? sounds.playWin() : sounds.playLose();
  // 4. Vibrate
}
```

---

## PHASE 10 — RESULT OVERLAY + CELEBRATIONS

```dart
// lib/widgets/overlays/result_overlay.dart

Stack(alignment:center):
  // Blurred backdrop
  BackdropFilter(filter: ImageFilter.blur(sigmaX:6, sigmaY:6)):
    Container(color: Colors.black.withOpacity(0.82))
  
  // Result card
  SizedBox(width:340):
    Stack:
      Image(card_result_win.png, BoxFit.fill)  // card background
      Padding(all:28):
        Column(mainAxisSize:min, spacing:12):
          Text('SPIN RESULT', Oswald 9px muted, letterSpacing:3)
          
          // Big result number
          Text('${r.red}${r.green}${r.black}', Rajdhani Bold 68px,
               color: r.won ? goldBright : Color(0xFF333333))
          .animate().scale(begin:(0.2,0.2), curve:Curves.elasticOut)
          
          // Color breakdown
          Row: redBadge(r.red) | greenBadge(r.green) | blackBadge(r.black)
          Text(matchStatus, Oswald 11px)
          
          // Win graphic or lose text
          if(r.won) Image(text_you_win.png, width:220)
          else Text('😔 NO WIN THIS ROUND', Oswald 20px, color:Colors.grey)
          
          // Points
          if(r.won) Text('+${r.winAmount} points', Rajdhani Bold 28px, gold)
          else Text('Better luck next round!', Oswald 12px, muted)
          
          // Next round button
          GestureDetector(onTap: _handleNextRound):
            Container(nextRoundBtnDecor): Text('▶ NEXT ROUND', Oswald Bold 14px)

// Card entrance animation:
.animate()
  .scale(begin:(0.5,0.5), curve:Curves.elasticOut, duration:500ms)
  .fadeIn(duration:300ms)

// Win celebration:
if(result.won) ConfettiWidget(controller: _confettiCtrl, ...)

void _handleNextRound() {
  game.clearLastResult();
  game.resetCountdown(onExpire: _autoSpin);
}
```

---

## PHASE 11 — PROFILE SCREEN

```dart
// lib/screens/profile_screen.dart
// Dark curtain background + header + scrollable content
// See bsg-ui-design SCREEN 6 for full spec

Scaffold → Stack:
  Image(bg_game_curtain.png) + dark overlay
  Column:
    HeaderBar()        // ← back | "MY ACCOUNT" | ⚙ settings
    Expanded → SingleChildScrollView:
      Column:
        ProfileCard()  // avatar initials + username + agent + status
        BalanceDisplay() // big balance number with coin icon
        QuickStatsRow()  // TOTAL GAMES | WON | LOST
        HistoryTabs()    // POINT HISTORY | GAME HISTORY tabs
        SettingsSection() // Sound/Vibration toggles + Logout
```

---

## PHASE 12 — BUILD + RELEASE APK

### Generate icons + splash
```bash
flutter pub run flutter_native_splash:create
flutter pub run flutter_launcher_icons
```

### Create release keystore (run once)
```bash
keytool -genkey -v -keystore %USERPROFILE%\bsg_release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias bsg_key
```

### android/key.properties
```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=bsg_key
storeFile=C:/Users/YOUR_USERNAME/bsg_release.jks
```

### android/app/build.gradle — add before android{} block
```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

### android/app/build.gradle — inside android{} block
```groovy
signingConfigs {
    release {
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
        storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
        storePassword keystoreProperties['storePassword']
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        shrinkResources true
    }
}
```

### Build commands
```bash
# Build release APK (split by ABI — smaller files)
flutter build apk --release --split-per-abi

# APK location (use arm64 for modern phones)
# build\app\outputs\flutter-apk\app-arm64-v8a-release.apk

# Install directly to connected phone
flutter install --release

# Share APK
# → Google Drive link  
# → yourdomain.com/download/bsg.apk
# → Firebase App Distribution (best for testing)
```

---

## DEVELOPMENT ORDER + TIMELINE

```
WEEK 1 — Foundation
  Day 1: Phase 1 — Setup + flutter doctor ✓
  Day 2: Phase 2 — Theme system
  Day 3: Phase 3 — Models + Services (stubs)
  Day 4: Phase 4 — Providers + state logic
  Day 5: Phase 5 — Login screen (test on emulator)

WEEK 2 — Core Screens
  Day 1: Phase 6 — Lobby screen + game cards
  Day 2: Phase 7 — Game screen + Left tab strip + NumberDrawer
  Day 3: Phase 8 — Wheel (CustomPainter) — hardest part
  Day 4: Phase 9 — Right panel + spin + countdown
  Day 5: Phase 10 — Result overlay + confetti + sounds

WEEK 3 — Polish + Ship
  Day 1: Phase 11 — Profile screen
  Day 2: Phase 12 — APK build + signing
  Day 3: Test on real Android phone, fix layout issues
  Day 4: Polish animations, sounds, test edge cases
  Day 5: Share APK with first users

FUTURE (when dashboard ready):
  Replace ApiService stubs with real HTTP calls
  Set BASE_URL to your Node.js/Supabase backend
  Test full login/spin/balance flow with real server data
```

---

## CLAUDE CODE USAGE INSTRUCTIONS

### Start a session:
```bash
cd D:\Download\Game\bsg_app
claude
```

### Reference this skill in instructions:
```
"Read the bsg-flutter-dev skill and implement Phase 7 — 
the NumberDrawer with slide animation and all 3 grid types"

"Read bsg-ui-design skill for the exact color values and 
decoration specs for the login screen card, then implement it"

"Implement the WheelPainter from Phase 8 — use CustomPainter 
with 3 separate rotation angles for red/green/black rings"
```

### After each phase:
```bash
flutter pub get
flutter run    # verify no errors on emulator
```
