# Clean Streak — Session Context

> Read this at the start of every new session. It replaces the need to re-read the full codebase from scratch.

---

## What This App Is

**Clean Streak** is a mobile-first PWA (Progressive Web App) for tracking sobriety / habit-quitting streaks. A user names their habit, sets a quit date, and the app counts how many days they have been clean. Multiple habits can be tracked simultaneously. It is live at:

**https://clean-streak-app-fawn.vercel.app**

GitHub repo: **https://github.com/t-ali-zia/Clean-Streak-APP.git**

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single `index.html` — React 18 (UMD CDN), Babel Standalone (in-browser JSX transpilation) |
| Backend / DB | Supabase (anonymous auth + magic link, Postgres, RLS, Edge Functions) |
| Push notifications | Web Push API + VAPID keys + Supabase Edge Function (`send-notifications`) |
| Hosting | Vercel (buildCommand: `node build.js`, outputDirectory: `dist`) |
| Service worker | `sw.js` — network-first caching, push event handler, notification click handler |

**No npm packages are installed at runtime.** All dependencies are loaded via CDN:
- `@supabase/supabase-js@2.49.4` (UMD)
- `react@18` + `react-dom@18` (production UMD)
- `@babel/standalone` (in-browser JSX compilation)

---

## File Structure

```
Clean Streak APP/
├── index.html        ← Entire frontend. All components, logic, styles live here.
├── sw.js             ← Service worker (caching + push notifications)
├── build.js          ← Node build script: injects env vars, copies to dist/
├── manifest.json     ← PWA manifest
├── vercel.json       ← Vercel config (headers, rewrites, build command)
├── package.json      ← Minimal: just defines the build script
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── dist/             ← Build output (generated, not committed)
```

---

## Critical Coding Rules

These rules are non-negotiable. Breaking them crashes the app silently.

### 1. Double quotes only in JS strings
The file uses **in-browser Babel standalone**. Single-quoted strings with apostrophes (e.g. `'it\'s'`) break parsing. Use double quotes for all JS strings:
```javascript
// WRONG — crashes
const msg = 'You\'ve got this';
// CORRECT
const msg = "You've got this";
```

### 2. No React fragment shorthand
`<>...</>` crashes in-browser Babel. Always use the full form:
```jsx
// WRONG — crashes
return <><div/><div/></>;
// CORRECT
return <React.Fragment><div/><div/></React.Fragment>;
```

### 3. VAPID guard must use length check, NOT string comparison
`build.js` does a global regex replace of `"__VAPID_PUBLIC_KEY__"` across the entire file at build time — including inside comparison expressions. So:
```javascript
// WRONG — after build, becomes: VAPID_PUB_KEY !== "actual-key-here" → always false
if (VAPID_PUB_KEY !== "__VAPID_PUBLIC_KEY__") { ... }

// CORRECT — length check is not affected by substitution
if (VAPID_PUB_KEY.length > 50) { ... }
if (VAPID_PUB_KEY.length < 50) { ... }  // for the "missing" error check
```
This applies to `SUPABASE_URL` and `SUPABASE_ANON_KEY` too — never compare these to their placeholder strings.

---

## How the Build Works

`build.js` (run by Vercel at deploy time):
1. Reads `index.html`
2. Replaces three placeholder tokens globally:
   - `"__SUPABASE_URL__"` → actual Supabase project URL
   - `"__SUPABASE_ANON_KEY__"` → actual anon key
   - `"__VAPID_PUBLIC_KEY__"` → actual VAPID public key
3. Writes result to `dist/index.html`
4. Copies `sw.js`, `manifest.json`, and `icons/` to `dist/`

Environment variables are set in Vercel dashboard (not in the repo). All three are required for the app to work fully.

---

## Supabase Setup

**Project URL:** Set via `SUPABASE_URL` env var (Vercel)
**Anon key:** Set via `SUPABASE_ANON_KEY` env var

### Auth
- Users sign in **anonymously** on first load (`sb.auth.signInAnonymously()`)
- Email **magic link** is available to link/restore accounts across devices
- `onAuthStateChange` listener in App handles `USER_UPDATED` (email added) and `SIGNED_IN` (restored from another device)
- Site URL in Supabase dashboard: `https://clean-streak-app-fawn.vercel.app`
- Redirect URL in Supabase dashboard: `https://clean-streak-app-fawn.vercel.app`

### Database Tables
| Table | Purpose |
|---|---|
| `user_profiles` | `id` (UUID, FK to auth.users), `name` (text), `onboarding_done` (bool) |
| `habits` | `id`, `user_id`, `name`, `color`, `quit_date`, `created_at` |
| `push_subscriptions` | `user_id` (unique), `subscription` (jsonb — Web Push subscription object) |

### Edge Function: `send-notifications`
- Managed in Supabase dashboard (not in repo)
- Cron-triggered daily
- Secrets required: `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- **Important:** Must use the legacy `service_role` JWT key from Supabase → Settings → API → "Legacy anon, service_role API keys". The new `sb_secret_...` format is NOT a JWT and does not work.
- Notification priority logic:
  1. Milestone hit today → `"🎉 X days — [habit name]"` + milestone message
  2. 1–2 days before milestone → `"Almost there 🎯"` + countdown
  3. Default → `"Day X — [habit name] 🔥"` + daily quote

---

## App Structure (Components in index.html)

```
App                          ← Root. Manages all state, auth, DB sync.
├── LoadingScreen            ← Spinner shown during init
├── OnboardingScreen         ← First launch: name + habit setup
├── NotifScreen              ← Push notification permission request
└── Dashboard view
    ├── DashboardScreen      ← Main screen: streaks, quote, calendar
    │   ├── StreakCard        ← Per-habit card (days count + milestone badges)
    │   ├── MilestoneBadge   ← 7d / 14d / 30d / 100d badge (earned or countdown)
    │   ├── CalendarMonth    ← Single month calendar with habit dots
    │   └── CollapsibleCalendar ← Expandable list of all months since earliest habit
    ├── EditSheet            ← Bottom sheet: edit/delete a habit
    ├── AddHabitSheet        ← Bottom sheet: add a new habit
    └── AccountSheet         ← Bottom sheet: link email / restore account
```

### App State
```javascript
loading        // bool — init in progress
userId         // string | null — Supabase auth user ID
userEmail      // string — set if user linked an email
screen         // "onboarding" | "notif" | "dashboard"
name           // string — user's display name
habits         // array: [{ id, name, color, quitDate }]
selectedHabit  // habit object | null — controls EditSheet
showNotif      // bool — shows NotifScreen overlay
showAddHabit   // bool — shows AddHabitSheet overlay
showAccount    // bool — shows AccountSheet overlay
isDark         // bool — theme toggle (persisted to localStorage)
```

---

## Theming (Light / Dark Mode)

Implemented via CSS custom properties.

### How it works
- CSS variables defined in `<style>` block: `:root {}` (dark defaults) + `[data-theme="light"] {}` (light overrides)
- Theme applied by setting `document.documentElement.setAttribute("data-theme", "light"|"dark")`
- A tiny inline `<script>` in `<head>` runs before React to apply the saved theme from localStorage — prevents flash of wrong theme on load
- `isDark` state in `App` toggles the attribute and saves to localStorage
- Toggle button (sun/moon icon) lives in the DashboardScreen header (leftmost of the three icon buttons)

### CSS Variable Tokens
| Token | Dark value | Light value |
|---|---|---|
| `--bg` | `#0e0e12` | `#f2f2f7` |
| `--bg-sheet` | `#1a1a24` | `#ffffff` |
| `--text` | `#ffffff` | `#111111` |
| `--text-sub` | `rgba(255,255,255,0.6)` | `rgba(0,0,0,0.6)` |
| `--text-dim` | `rgba(255,255,255,0.45)` | `rgba(0,0,0,0.5)` |
| `--text-faint` | `rgba(255,255,255,0.3)` | `rgba(0,0,0,0.38)` |
| `--text-ghost` | `rgba(255,255,255,0.2)` | `rgba(0,0,0,0.22)` |
| `--text-muted` | `rgba(255,255,255,0.25)` | `rgba(0,0,0,0.28)` |
| `--card` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.04)` |
| `--card-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.07)` |
| `--input-bg` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.05)` |
| `--input-border` | `rgba(255,255,255,0.12)` | `rgba(0,0,0,0.1)` |
| `--icon` | `rgba(255,255,255,0.5)` | `rgba(0,0,0,0.5)` |
| `--icon-dim` | `rgba(255,255,255,0.4)` | `rgba(0,0,0,0.35)` |
| `--separator` | `rgba(255,255,255,0.1)` | `rgba(0,0,0,0.1)` |
| `--handle` | `rgba(255,255,255,0.2)` | `rgba(0,0,0,0.12)` |
| `--overlay` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` |
| `--badge-bg` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.04)` |

Plus calendar-specific tokens (`--cal-active`, `--cal-dim`, etc.) and `--backdrop`, `--dashed-border`, `--dashed-color`, `--quote-bg`, `--quote-border`, `--today-ring`, `--future-text`.

### SVG icons in JSX
SVG `stroke` and `fill` attributes do **not** inherit CSS variables when set as plain HTML attributes. Use `style` prop instead:
```jsx
// WRONG — CSS variable won't work here
<path stroke="var(--icon)" .../>

// CORRECT — style prop works with CSS variables
<path style={{ stroke: "var(--icon)" }} .../>
```

### Date input color-scheme
Controlled via CSS (not inline style) so it responds to the theme:
```css
input[type="date"] { color-scheme: dark; }
[data-theme="light"] input[type="date"] { color-scheme: light; }
```
**Do not add `colorScheme` to inline styles on date inputs** — inline styles override CSS and will break the light mode picker.

---

## Quote System

- 227 quotes in the `QUOTES` array
- `seededShuffle(arr, seed)` — Fisher-Yates with a deterministic PRNG (no Math.random)
- `getDailyQuote(userId)` — seed is derived from `(cycle * 99991) + userId charCodes`. Each 227-day cycle uses a different shuffle order. Different users see different quotes on the same day.
- "TODAY'S REMINDER" section on the dashboard shows today's quote

---

## Push Notifications

- Permission requested on `NotifScreen`
- Subscription created via `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUB_KEY) })`
- Subscription stored in `push_subscriptions` table (upserted by `user_id`)
- On app init, if permission is already granted, subscription is re-upserted (handles re-installs and token rotation)
- VAPID public key loaded via Vercel env var → `build.js` substitution
- Edge Function (`send-notifications`) reads subscriptions, sends via Web Push

---

## Key UI Details

- **Milestone badges:** 2×2 grid, fixed 38px height. Earned = habit color background + checkmark. Not earned = subtle bg + "Xd left" countdown in second line.
- **Streak cards:** `gridAutoRows: "1fr"` ensures equal height across all habit cards regardless of content.
- **Bottom sheets:** Slide up from bottom (`animate-sheetIn`). Backdrop is blurred. All sheets have `overflow: "hidden"` on the container to prevent date pickers from overflowing.
- **Delete confirmation:** EditSheet has `confirmDelete` state. First "Remove habit" press shows an inline warning with Cancel / Delete buttons. No immediate deletion.
- **Header icons (Dashboard):** Three icon buttons — sun/moon (theme toggle), person (AccountSheet), bell (NotifScreen).

---

## Deployment

1. Push to `main` on GitHub
2. Vercel auto-deploys (connected to repo)
3. Build runs `node build.js` which injects env vars and writes `dist/`
4. Vercel serves `dist/` with headers from `vercel.json`

**Vercel env vars required:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY` (used only by Edge Function, not injected into frontend)

---

## Git Setup

- Remote: `https://github.com/t-ali-zia/Clean-Streak-APP.git`
- Branch: `main`
- Credentials stored in macOS keychain via `git credential-osxkeychain`
- GitHub username: `t-ali-zia`

---

## What Is Working (as of last session)

- ✅ Anonymous auth on first load
- ✅ Onboarding flow (name + habits)
- ✅ Dashboard with streak cards, milestone badges, calendar, daily quote
- ✅ Add new habit (AddHabitSheet)
- ✅ Edit habit name / quit date (EditSheet)
- ✅ Delete habit with confirmation dialog
- ✅ Share habit as image (canvas → native share sheet or download)
- ✅ Push notification permission + subscription creation
- ✅ Daily push notifications via Supabase Edge Function (milestone-aware, quote-driven)
- ✅ Account linking via email magic link (link this device)
- ✅ Account restore via magic link (restore from another device)
- ✅ Data synced to Supabase on every change
- ✅ Light mode / dark mode toggle (sun/moon button in header, persisted to localStorage)
- ✅ Service worker caching (offline fallback)
- ✅ PWA installable (manifest + icons + SW)

## Known Limitations / Not Yet Done

- The share image canvas always renders in dark mode (hardcoded colors) — intentional for now
- `manifest.json` `background_color` and `theme_color` are hardcoded dark — not dynamic with theme
- No user-facing settings screen beyond what's in AccountSheet
- No ability to reorder habits
- No "reset streak" option (user must delete and re-add)
