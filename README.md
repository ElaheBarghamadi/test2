# Examora

Examora is an RTL-first, Persian school examination experience. This repository uses a **root-level Next.js frontend** alongside an independently runnable **Django/DRF backend** in `backend/`. The backend provides JWT authentication, self-profile management, teacher/admin exam authoring, teacher grading/reporting, and a secure student exam lifecycle. The existing Persian/RTL Next.js interface is connected to these endpoints through a typed client layer.

## Repository layout

```text
app/, components/, hooks/, lib/   Existing Next.js 15 frontend (repository root)
backend/                          Django 5 + Django REST Framework service
  config/                         Settings and URL configuration
  apps/core/                      Shared API utilities and health endpoint
  apps/users/                     Custom email user, profiles, JWT groundwork
  apps/exams/                     Exam, settings, question, option models
  apps/attempts/                  Attempt and answer lifecycle models
  apps/results/                   Persisted grading-result snapshot model
  docs/architecture.md            Backend design and extension guidance
  docs/api-v1.md                  Implemented API request/response reference
```

## Standard local development (separate services)

The recommended workflow runs the backend and frontend as separate processes. This keeps their logs,
restarts, and failures independent. Run the following from the repository root. Requirements: Node.js and
Python 3.12+ on `PATH`.

Install the frontend dependencies once after cloning:

```bash
npm ci
```

### 1. Start the backend — terminal 1

```bash
npm run dev:api
```

On first run this creates missing environment files, prepares `backend/.venv`, installs the locked Python
dependencies, applies migrations, and starts Django on `http://127.0.0.1:8000`. Wait until the terminal
reports that the API is up. With the default blank `DATABASE_URL`, Django uses local SQLite, so a separate
database service is not required. If using PostgreSQL, start it and configure `DATABASE_URL` in
`backend/.env` before starting the API.

### 2. Start the frontend — terminal 2

Open another terminal in the same repository and run:

```bash
npm run dev
```

`npm run dev` now starts **only Next.js** on `http://localhost:3000`; local API calls are proxied to the
backend from the first terminal. Once Next.js reports ready, open `http://localhost:3000`, sign in as a
teacher, then visit `/teacher/exams/create`.

Stop each process with `Ctrl+C` in its own terminal. The same workflow works on Windows, macOS, and Linux.

### Other run modes

```bash
npm run setup              # prepare env, Python venv, dependencies, and migrations; then exit
npm run dev:api            # backend only; includes first-run setup
npm run dev:web            # frontend only; alias for `npm run dev`
npm run dev:turbo          # frontend only, with Turbopack
npm run dev:stack          # optional convenience: start backend + frontend in one terminal
npm run dev:stack:turbo    # both services with Turbopack for the frontend
```

The standard workflow is the two-terminal API-then-frontend sequence above; `dev:stack` is retained as an
optional shortcut.

## Running with no internet connection

School networks are frequently air-gapped, so nothing in this project is fetched at run time. Everything the
app needs is checked into the folder or installed into it:

| Need | Where it lives | How it got there |
| --- | --- | --- |
| Node packages | `node_modules/` (git-ignored) | `npm ci` — or `npm run setup`, which passes `--prefer-offline` |
| Python packages | `backend/.venv/` (git-ignored) | `backend/requirements.lock` pins exact versions |
| Persian webfont | `public/fonts/Vazirmatn-var.woff2` | **committed** — Vazirmatn 33.0.3, variable weight 100–900 |
| Icons | `lucide-react` in `node_modules/` | no icon CDN, no remote SVG |
| Next.js telemetry | disabled (`NEXT_TELEMETRY_DISABLED=1` in `dev-stack.mjs`) | Next would otherwise attempt an outbound call on first run |

The font is the one thing that used to depend on the network. It is declared with `@font-face` in
`app/globals.css`, `preload`ed from `app/layout.tsx`, and mapped in `tailwind.config.ts` as `font-sans` and
`font-vazir`; `next/font/google` is deliberately **not** used, because it resolves at build time and would
need an egress connection. Serve the folder and the type renders offline.

To prepare an air-gapped machine, do this once while a connection is available and copy the whole folder:

```bash
npm ci                       # populates node_modules/ with the lockfile's exact tree
cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.lock && cd ..
```

Both directories are git-ignored, so either commit them to your deployment branch or copy the tree as-is.
After that, `npm run dev:stack` works with the network cable unplugged; it never reaches for a package
manager unless `node_modules/` or `backend/.venv/` is missing.

### Demo data

`backend/apps/core/management/commands/seed_demo.py` builds a self-contained school for local testing —
one admin, one teacher, twelve students with Persian names, two overlapping student groups, and a term of
six exams:

```bash
cd backend && ./.venv/bin/python manage.py seed_demo
cd backend && ./.venv/bin/python manage.py seed_demo --no-exams   # accounts and groups only
```

Every account uses the password `Examora1234!` (`teacher@examora.test`, `student1@examora.test`, …). The
command is idempotent and refuses to run unless `DEBUG` is true, so it cannot seed a production database.

The exam set is shaped so every state a screen can show is on it at once: one attempt left half-finished
(`student1` and `student3`, with ~50 minutes on the clock), one exam open now, one scheduled three days out,
two with published results at different percentages so the score trend has a direction, one handed in but
not yet marked, and one still a draft that only the teacher can see. Seeding accounts alone leaves every
dashboard empty, which tells you nothing about whether it works.

Re-running the command rewinds the half-finished attempts rather than skipping them — an attempt's deadline
is `started_at + duration`, so a session seeded an hour ago has already expired and the resume band, the one
state the dataset exists to show, would be gone. `seed_demo` therefore doubles as "refresh the demo".

Two deliberate details: the groups share a student, so picking both must count that student once — the union
rule the exam audience screen implements; and the exams reach students both through group membership and
through the direct `students` list, so one dataset exercises both halves of the audience rule.

## Frontend

The frontend is at the repository root. `.env.local` is created from the shipped example if it is missing.
`NEXT_PUBLIC_API_BASE_URL=/api/v1` uses the server-only `API_PROXY_TARGET` rewrite in local development, so
browser code never embeds a localhost API URL. For a deployed HTTPS API, set `NEXT_PUBLIC_API_BASE_URL` to
its `/api/v1` origin and configure Django CORS for the frontend origin.

The same variable does one more job: it is where `middleware.ts` asks Django whether a session is alive
before it renders a protected page (`/student/*`, `/teacher/*`, `/admin/*`). Without it, the gate falls back
to the client-side guard — the API is still the authority on every value, but the wrong-role shell would be
produced before the browser redirects. It is read from `.env.local` (`.env.local.example` ships the local
values); leave `API_PROXY_TARGET` unset and the gate stays inactive rather than locking anyone out.

### Why local pages feel slow, and what to use instead

`npm run dev` compiles each route the first time it is opened, and every page in this app is a client
component that refetches from Django on mount (`Cache-Control: private, no-store`), so a click between
screens pays for compilation *and* a round trip. Nothing is wrong with the machine.

```bash
npm run dev:turbo           # faster frontend route compiles with Turbopack
npm run build && npm start  # pre-compiled frontend; run the API separately
```

On the backend, `manage.py runserver` already answers concurrent requests on one thread each (Django's
development server is threaded by default; `--nothreading` opts out, which is what makes a page that fires
several fetches feel queued). Add `--noreload` to stop the file watcher re-importing the whole project on
every save, and keep `DEBUG=False` out of the picture — the slow part is the reload, not the settings.

Validate a production build after stopping the Next.js dev process (do not run the build concurrently with
`npm run dev`):

```bash
npm run build
```

### Instant navigation

Every screen now paints the moment it is clicked, before any data arrives. Three pieces work together:

1. **Route-level skeletons.** Each page directory has a `loading.tsx` rendering a `PageSkeleton`
   (`components/shared/skeleton.tsx`) shaped like that screen — dashboard cards, a list of rows, a form, an
   exam detail. Next.js streams it immediately, so the destination is on screen while the route compiles or
   refetches.
2. **A navigation progress bar.** `components/shared/navigation-progress.tsx` is mounted in the dashboard
   shell and sweeps across the top of the page for the duration of a transition. It wraps
   `history.pushState`/`replaceState` rather than listening for clicks, because `usePathname()` alone cannot
   see a navigation start and `useSearchParams()` in the shell would force a Suspense boundary during static
   rendering. It is disabled under `prefers-reduced-motion`.

   **It holds no React state, and must not gain any.** `window.history.pushState` is a global the framework
   also calls: Next's own `HistoryUpdater`, in `next/dist/client/components/app-router.js`, calls it from
   inside a `useInsertionEffect` on every App Router navigation. Wrapping it with a `setPending(true)` —
   which is what this component used to do — schedules an update during the insertion-effect phase, and
   React answers `useInsertionEffect must not schedule updates.` with a stack pointing at this file, once
   per click. The bar is therefore driven imperatively: the only thing written is `data-state` on a
   permanently mounted element (`idle` → `active` → `done` → `idle`), which React never renders and so
   never fights over, and `visibility: hidden` in `globals.css` is what takes the idle bar out of the
   accessibility tree. `navigation-progress.test.tsx` reproduces Next's exact call site — a `pushState`
   from inside a `useInsertionEffect` — and fails if the component goes back to state.
3. **Prefetching.** Sidebar links carry `prefetch`, so the route chunk is already in the browser by the time
   it is needed.

The skeletons are deliberately *not* shimmering placeholders that lie about the content — they carry the
real shape of the screen, and the data drops into the same layout, so nothing jumps when it lands.

### Quality gates

The same gates CI runs, runnable locally. A change is done when they agree:

```bash
npm run verify         # tsc --noEmit && vitest run          (frontend types + tests)
npm run build          # production build
npm run audit:deps     # npm audit --audit-level=high        (no known vulnerabilities, whole tree)

cd backend
python manage.py check                      # system checks
python manage.py check_lock                 # requirements.lock still matches pyproject.toml
python manage.py makemigrations --check --dry-run   # no model ahead of its migration
python manage.py test                       # the Django suite
python -m pip_audit -r requirements.lock    # no known vulnerabilities in the pinned set
```

Two dependency rules carry security weight here and are enforced, not remembered:

- **`requirements.lock` is the security boundary.** `djangorestframework==3.17.2` is the release that makes
  `DATA_UPLOAD_MAX_MEMORY_SIZE` apply to DRF's `request.data` (before it, the configured ceiling was bypassed on
  every API endpoint), and `PyJWT==2.15.1` fixes the JWK-set parsing advisories. `pip-audit` reads the lockfile
  directly, so the fix is always a pin bump.
- **The lockfile and `pyproject.toml` have to agree.** A range raised in the manifest with the old pin left
  behind installs the version the project just declared unacceptable, so `python manage.py check_lock` fails on
  exactly that. The backend is intentionally absent from `.github/dependabot.yml` for the same reason: a
  Dependabot PR cannot update both files for pip, and a green PR that changes nothing is worse than no PR.

### اجرای پروژه روی Windows بدون نصب npm در سیستم

برای اجرای فرانت‌اند نیازی به نصب سراسری Node.js یا npm و دسترسی Administrator نیست. اسکریپت پروژه، نسخهٔ portable و تأییدشدهٔ Node.js را داخل `.tools/` دانلود می‌کند و npm را فقط از همان پوشه اجرا می‌کند. `.tools/` و `node_modules/` عمداً در Git ثبت نمی‌شوند.

1. در PowerShell، از ریشهٔ پروژه اجرا کنید:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\setup-local-node.ps1
   ```

   اسکریپت با توجه به معماری `x64` یا `arm64`، Node.js `22.14.0` را از `nodejs.org` دریافت، SHA-256 آن را بررسی، در `.tools\node-v...` استخراج و سپس `npm ci` را از `package-lock.json` اجرا می‌کند. PATH سیستم و نصب‌های global تغییر نمی‌کنند.

2. فایل محیطی فرانت‌اند را بسازید:

   ```powershell
   Copy-Item .env.local.example .env.local
   ```

3. در یک پنجرهٔ PowerShell دوم، API Django را آماده و اجرا کنید (Python 3.12+ لازم است):

   ```powershell
   Copy-Item backend\.env.example backend\.env
   py -3 -m venv backend\.venv
   backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
   backend\.venv\Scripts\python.exe backend\manage.py migrate
   backend\.venv\Scripts\python.exe backend\manage.py runserver 0.0.0.0:8000
   ```

   برای محیط اشتراکی/production مقدارهای `DJANGO_SECRET_KEY`، `DATABASE_URL` و تنظیمات ایمیل را در `backend\.env` وارد کنید. در توسعهٔ محلی، بدون `DATABASE_URL` از SQLite محلی استفاده می‌شود.

4. در پنجرهٔ اول، سایت را با npm محلی اجرا کنید:

   ```powershell
   .\scripts\dev-local.cmd
   ```

   سپس `http://localhost:3000` را باز کنید. هر دستور npm دیگر نیز از همین مسیر اجرا می‌شود؛ برای نمونه: ` .\scripts\npm-local.cmd run build `. برای به‌روزرسانی یا نصب دوبارهٔ وابستگی‌ها، اسکریپت setup را دوباره اجرا کنید.

### Main frontend routes

- `/` — product landing
- `/login`, `/register`, `/forgot-password`, `/reset-password` — JWT authentication, school-code onboarding, and delivered password reset flow
- `/student/dashboard`, `/student/exam/{exam_id}`, `/student/exam/{exam_id}/review`, `/student/results/{attempt_id}`
- `/teacher/dashboard`, `/teacher/exams`, `/teacher/exams/create`, `/teacher/exams/{exam_id}`, `/teacher/exams/{exam_id}/edit`, `/teacher/questions`, `/teacher/groups`, `/teacher/results`, `/teacher/students`
- `/admin/dashboard`, `/admin/users`, `/admin/schools`, `/admin/exams`, and `/admin/profile` — real school/user administration and network-wide read-only exam monitoring

## Backend quick start

Prerequisites: Python 3.12+ and PostgreSQL for the intended local/runtime database.

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -e .
# `pyproject.toml` is the source of dependency intent; requirements.lock records this verified set.
cp .env.example .env
# Edit .env: use a strong key and a real PostgreSQL DATABASE_URL.
./.venv/bin/python manage.py migrate
./.venv/bin/python manage.py runserver 0.0.0.0:8000
```

Useful checks:

```bash
./.venv/bin/python manage.py check
./.venv/bin/python manage.py test
curl http://localhost:8000/health/
```

`DATABASE_URL` is PostgreSQL-first (`postgresql://user:password@host:5432/database`). When it is deliberately unset, Django uses a local ignored SQLite file only as a lightweight smoke-test fallback; do not use that fallback for shared or production deployments.

The backend loads `backend/.env` and, if needed, a monorepo-root `.env`. Copy `backend/.env.example` rather than committing a real `.env`. Root `.env.example` mirrors the backend values for hosts that prefer one monorepo-level environment file.

## Implemented backend API

- Custom `users.User` configured before initial migration: email login, names, `STUDENT` / `TEACHER` / `ADMIN` roles, active/staff flags, UUIDs, and timestamps; lean matching profiles are auto-provisioned.
- PostgreSQL-ready configuration, timezone-aware datetimes (`Asia/Tehran`), environment-configured hosts, and explicitly allowlisted CORS origins. Wildcard CORS is disabled.
- JWT register, login, refresh, logout/refresh-token blacklisting, and safe current-user responses under `/api/v1/auth/`.
- Password-reset email/request-confirmation endpoints, authenticated password changes, and self-profile read/update at `/api/v1/users/me/`, with role-specific editable profile fields and protected privilege fields.
- Owner-scoped teacher/admin APIs for exam list/create/detail/update, archive/restore, publish/complete workflow, early `start`, timed `extend`, atomic duplication, question create/read/update/delete, and atomic question reordering. List and detail rows carry `question_count`, `attempt_count`, `participant_count`, and `teacher_name`, so the teacher panel needs no extra round-trips.
- Question option edits are applied in place: an option that arrives with its `id` keeps it (so student selections stay linked), a new option is created, and removing an option a student already answered is refused rather than silently deleting their work.
- Structured settings and question-type validation, server-controlled ownership/status fields, targeted query optimization, and separate teacher-only answer-key serializers.
- Student APIs under `/api/v1/student/` for safe availability, idempotent start/reuse, persistent randomized question order, server-authoritative timing (including the extended window while an attempt is open), attempt number/limit, single/batch autosave, review flags, submission, automatic grading where deterministic, and result visibility enforcement.
- Safe result access only for immediate visibility or explicit teacher publication; answer keys, expected answers, explanations, teacher identity, grading configuration, and teacher-only settings are never emitted through student endpoints.
- Teacher reporting endpoints under `/api/v1/results/teacher/` for owned exam rows, actual-participant lists, submitted answer review, manual text grading, feedback, and controlled result publication. Results carry `passing_percentage` and a derived `passed` verdict for both teacher rows and the student result view.
- Teacher-owned student groups under `/api/v1/users/groups/` (list/create/update/delete) and a student directory under `/api/v1/users/students/`, which together drive exam targeting. A group is a named roster; membership is a separate row, so removing a student from a group never deletes them.
- Exam targeting is stored as `audience_mode` (`profile` or `selected`) plus the chosen `student_groups` and individual student ids. The server resolves both to one eligibility set, so a student in two chosen groups is counted once, and `GET /api/v1/student/exams/` only ever returns exams that student is eligible for.
- School/membership models, public active-school code onboarding, admin-only school/user management and network monitoring APIs, professional Django Admin registration for all domain models, a safe liveness endpoint at `GET /health/`, and a predictable DRF error envelope.

Read [`backend/docs/api-v1.md`](backend/docs/api-v1.md) for the actual endpoints and payloads, then [`backend/docs/architecture.md`](backend/docs/architecture.md) before implementing the next API slice.

## Frontend integration boundaries

- `lib/api/` is the sole typed fetch boundary: DTOs, mapping adapters, JSON/DRF errors, bearer headers, and one safe refresh/retry path live there.
- `lib/state/auth-store.ts` confirms `/auth/me/` after login and derives every route role from the server response.
- Teacher exam/question mutations remain in `lib/services/teacher-exam-service.ts`; the service orchestrates Django's intentionally separate exam, question, reorder, and publish endpoints.
- Student attempts use `lib/services/exam-attempt-service.ts` and only send selected option IDs or text. Correct answers and grading configuration never enter student state.

## Teacher workflow

The teacher workspace supports server-backed search/filter/sort, duplication/archive/restore, a six-step exam builder (اطلاعات پایه → تنظیمات → مخاطبان → سؤال‌ها → زمان‌بندی → بازبینی), typed question editing, scheduling, draft save/publish, participant reporting, manual text grading, controlled result publication, and CSV export. Question authoring is full CRUD: options can be added, re-worded, duplicated, reordered, and removed (the builder offers between two and ten rows, matching the server's minimum of two), each type marks its own answer key, short answers keep a list of accepted responses with case sensitivity, and every rule the publish gate enforces is previewed inline before saving. `start now` and `extend time` live on the exam detail screen and refuse themselves with the server's reason when the status or the clock does not allow it, and the detail screen states plainly when an exam is live and how many attempts are already recorded. It keeps the Persian/RTL design system and discriminated `Question` union intact. A separate question bank searches every question the teacher owns (text, type, difficulty, tag, archived state), shows where each one is used, and inserts copies of the selected rows into another exam in one action — copying, never sharing, so no live answer sheet can change under a class. The results screen adds a grading queue ordered by progress (`17 / 24 graded`), a per-row verdict column against the exam's pass mark, and a session-signals panel that reports what the platform observed without treating it as proof.

### Exam audience (step 3)

Step 3 of the builder answers one question: *who is allowed to sit this exam?* Two modes, both enforced on
the server:

- **بر اساس پروفایل** — every student whose grade/class profile matches the exam's. No list is stored, so a
  student added to the class tomorrow is included automatically.
- **گروه‌ها و دانش‌آموزان انتخابی** — an explicit roster assembled from the teacher's own student groups plus
  any individual students, with a live count of how many people the exam will be open to.

The screen is in `components/forms/exam-audience-form.tsx`; the eligibility rule is duplicated in
`backend/apps/exams/serializers.py` and `backend/apps/attempts/services.py`, and the backend refuses to
change the audience once an attempt exists. A published exam with `selected` targeting and an empty roster is
rejected with a Persian message rather than silently becoming a no-one exam.

### Student groups (گروه‌بندی)

`/teacher/groups` is its own section in the sidebar: create a group, give it a description, and pick members
by name, grade or class. Groups are reusable across exams — build «تجربی ۲ — گروه الف» once and select it in
every exam for that class. Editing or deleting a group attached to a scheduled exam is refused with the
reason, because it would silently change who can sit a published paper.

Models: `apps/users/models.py` (`StudentGroup`, `StudentGroupMember`) · views: `apps/users/group_views.py` ·
UI: `components/teacher/student-groups-workspace.tsx` and `components/teacher/student-picker.tsx`.

### Adding a question

`افزودن سؤال` opens a dialog that asks **only** for the question type first — six cards, each with its own
Persian label and one-line description — and then renders the fields that type actually has. A matching
question no longer shows an option list; an essay no longer shows an accepted-answer field. The stem, mark,
media and tags survive a trip back to the type picker, and nothing is added to the exam until the teacher
confirms, so closing the dialog throws the half-typed question away.

Supported types: چهارگزینه‌ای (one correct), چندگزینه‌ای چندپاسخی (teacher sets how many), درست/نادرست,
وصل‌کردنی, پاسخ کوتاه (list of accepted answers, case sensitivity), پاسخ تشریحی.

Optional material sits in two collapsible sections — «پاسخ رسانه‌ای دانش‌آموز» and «راهنما، برچسب و توضیح» —
which start closed and open themselves only when they already hold something. The stem, options and answer
key are never hidden.

### Images and audio in a question

A question's prompt can carry its own images and audio (`PromptMediaEditor`), or be given as an image alone
(«سؤال فقط تصویر است»). Per question, the teacher can also require the student to answer with an uploaded
image or a recording, with a cap on files and size.

Everything on that path is validated by magic bytes in `backend/apps/core/secure_uploads.py`, not by the
content type the browser claims: JPEG/PNG/WebP for images (SVG is rejected outright), MPEG/Ogg/WAV/WebM and
`ftyp`-branded MP4 for audio — the last one because Safari has no WebM encoder, so a student on an iPad would
otherwise be unable to answer. Declared size, dimension bombs, path traversal in the file name and empty
uploads are all refused, and stored media is served through an authenticated private route with
`no-store` and `nosniff`.

### Student dashboard

`/student/dashboard` answers three questions in order and then stops: *is anything running right now*,
*where do I stand*, and *what is next*.

- **Resume band.** A half-finished attempt is the only state where doing nothing costs marks, so it gets a
  full-width band above everything else with a clock that ticks every second. The clock is derived locally
  from the server's own `remaining_seconds` — the exam page re-reads the deadline from the server, so a
  drifting device clock cannot cost anyone time.
- **Four summary cards.** Actionable count, upcoming count with the nearest start, average percentage, and
  pass rate. All four are derived from the same `GET /student/exams/` payload the list renders, so the
  summary and the list cannot disagree, and an unmarked paper is never counted as a zero.
- **`#exams`** — the filter rail and one card per exam. A colour rail down the start edge means a student
  scanning twelve rows finds the urgent one without reading a label.
- **`#results`** — کارنامه (average ring, pass-rate bar, best/worst/pending), a روند نمرات chart ordered by
  submission time, and a transcript of every paper handed in.
- **تقویم** — the Persian-calendar month view, no longer folded inside a `<details>`.

The two sidebar links «آزمون‌های من» and «نتایج و عملکرد» point at `#exams` and `#results`; `Sidebar`
therefore tracks `window.location.hash`, because `usePathname()` excludes it and three links to one page
would otherwise all light up together — or, with the old exact-match rule, none of the fragment links would
ever light up at all.

There is deliberately **no** student overview endpoint. Everything above is computed client-side from data
the student is already allowed to see, which means the panel cannot leak a figure the teacher has not
published.

## Pre-login surfaces (landing, sign-in, sign-up, recovery)

Everything a visitor sees before they have an account: `/`, `/login`, `/register`, `/forgot-password`,
`/reset-password`.

**The landing page claims only what is in this repository.** The earlier version opened with a strip of
invented statistics — «۹۸٪ رضایت مدارس», «+۴۵هزار آزمون موفق», «۲۴/۷ پایداری سرویس» — for a product with no
deployed customers. School administrators are exactly the audience that checks such numbers, and a figure
that cannot be substantiated costs more trust than a modest one. What replaced it counts things that exist
in the source and can be verified there: 6 question types (`questionTypeMeta` / `apps/exams/models.py`),
3 ways to set an exam's audience, 4 result-detail levels, and 0 external network dependencies. Mock UI in a
screenshot is labelled «نمای نمونه»; the footer's `href="#"` links now point at real anchors and routes.

**A running exam, in CSS.** `components/shared/exam-demo-card.tsx` plays a 15-second, three-phase loop —
the timer counts down, the progress bar fills, the question crossfades, a «پاسخ‌ها خودکار ذخیره شد» chip
appears — and it does all of that with no state, no timers and no re-renders. The keyframes live in
`globals.css` (`demo-phase-a|b|c`, `demo-progress-fill`, `demo-saved`, `demo-orb`, `button-sheen`,
`field-shell`). Two rules matter if you touch them:

- `animation-delay` only applies **before the first iteration**, so staggering three infinite loops by 5 s
  each drifts apart after one cycle. The phases are percentages of one shared duration instead.
- The global `prefers-reduced-motion` rule collapses every animation onto its final keyframe, which for a
  crossfading stack means *all three phases invisible at once*. That media query therefore pins phase A
  visible and phases B and C hidden, so reduced-motion visitors get a still frame of the same scene rather
  than an empty panel.

**The password meter mirrors Django, and is never a gate.** `lib/auth/password-strength.ts` re-implements
the four validators `backend/apps/users/passwords.py` maps to Persian — minimum length 8, not entirely
numeric, not similar to the account, not common — so a sign-up is not refused after a round trip. Two of
the four cannot be reproduced exactly offline, and both are deliberately biased so the client can never
say «strong» about something the server will refuse:

| Rule | Server | Client |
| --- | --- | --- |
| length | `len(password)` (code points) | `[...password].length`, not `.length` (UTF-16 units) |
| all-numeric | `str.isdigit()`, Unicode-aware | `/^[\p{Nd}]+$/u`, **not** `/^\d+$/` — «۲۴۶۸» is digits to Django |
| similar to the account | `SequenceMatcher` ratio 0.7 over every attribute | containment against the name and address on the form, which is stricter |
| common | a ~1M-entry list | ~60 entries; the server holds the real list |

The meter advises; it does not block. Because "similar" and "common" are approximations, letting them
disable the submit button would mean the client refusing a password the server would have accepted — a
dead end the visitor cannot talk their way out of. `components/forms/auth-form.test.tsx` pins that decision.

**Shared field furniture.** `components/forms/auth-field.tsx` holds `Field`, `FieldSelect`, `StrengthMeter`,
`useCapsLock` and `CapsLockNotice`, used by both the sign-in/sign-up form and the reset screen (which
previously looked like a different product). Two details in `Field` are load-bearing:

- The border lives on a `.field-shell` wrapper so an icon and a trailing button sit *inside* the box. The
  `!important`s in its CSS rule are what beat Tailwind's own `focus-visible:ring-*`, which would otherwise
  paint a second ring over the first.
- The error message renders **outside** the `<label>`. Everything inside a label becomes part of the
  field's accessible name, so an error there renames «گذرواژه» to «گذرواژه گذرواژه باید دست‌کم ۸ کاراکتر
  باشد.» the moment it appears — and breaks any test or screen reader addressing the field by name.

Caps Lock is read from `event.getModifierState("CapsLock")` on key events rather than polled: the browser
only reports modifier state on an event. It is the one invisible reason a correct password gets refused,
and the server's answer («ایمیل یا گذرواژه نادرست است») points somewhere else entirely.

**The role picker is two cards, not a `<select>`.** Native radios kept visually as cards (`sr-only` input
inside a styled `<label>`), so keyboard and assistive-tech behaviour stays native while the choice is
visible — a collapsed default is how a teacher ends up with a pupil's account. Selecting «آموزگار» also
removes the grade and class fields, which are a pupil's attributes.

**Dev-only shortcut.** Outside production builds, the sign-in form offers one-click fill of the two
`seed_demo` accounts. The credentials live in `components/forms/auth-form.tsx` next to the seeder that
produces them; the branch is dead-code-eliminated from a production bundle.

## Student exam workflow

The student space is driven by server state end to end: the dashboard groups exams into ready/upcoming/in-progress/completed with the real remaining time, the start screen states the marks, the pass mark, the attempt budget, and the release policy before the clock begins, and the session itself autosaves each answer, keeps flags, survives a dropped connection by queueing writes, and re-reads the deadline from the server every minute and on tab focus so a teacher extension cannot be missed. When the countdown reaches zero the session confirms the deadline with the server, flushes queued answers, and submits itself; leaving mid-exam asks for confirmation first. Results show the published score, the pass verdict, and whether any answer still awaits manual grading. A second browser window can read but not write, so a duplicated tab cannot clobber answers, and `ادامه در این پنجره` moves the attempt deliberately. A calendar of the school's own month (Persian calendar via `Intl`, keyed to `Asia/Tehran`) and an in-app notification bell sit on both dashboards.

## Reliability model (read this before changing the exam engine)

- The server owns every exam-critical value: status, start/end window, remaining time, attempt state,
  submission, grading, results and the pass/fail verdict. The client counts down locally but re-reads the
  deadline from `POST /api/v1/student/attempts/{id}/heartbeat/` every minute and on tab focus.
- An attempt's deadline is **snapshotted** when it starts. Editing `duration_minutes` mid-exam must not
  change a running student's window; only `extend` does, explicitly.
- Unsent answers are also kept **on the device**, not only in memory: `lib/exam/answer-journal.ts` mirrors the
  pending queue into IndexedDB (200ms debounce, plus a write on `pagehide`), and `StudentExamSession` restores
  it after a reload with `restoreJournal`. The record exists only while something is genuinely unsent and is
  deleted the moment the server accepts the queue, so a stale record can never resurrect a saved answer; a
  submitted sheet never restores local edits at all. Signing out or losing the token clears every record,
  because a shared school computer must not keep one student's work for the next one.
- Answers are guarded, not merged: `X-Exam-Revision` (refuses an out-of-date write and returns the current
  revision so the client can re-base) and `X-Exam-Session` (one window writes at a time; a second one reads
  and can take over deliberately). Both headers are optional, so an older client is never locked out.
- Teacher content edits are non-destructive by construction: option rows keep their primary keys, removing
  an answered option or deleting/re-typing an answered question is refused, and re-grading never
  un-publishes a result.
- `manage.py close_overdue_exams` is the scheduler-free way to end exams whose window has passed; the
  teacher exam list runs the same idempotent transition for its own scope.

## Tests

`.github/workflows/ci.yml` runs all of it on every push and pull request: `npm ci`, `tsc --noEmit`, `npm test`
and `npm run build` for the frontend, plus `manage.py check`, `makemigrations --check --dry-run` and the Django
suite for the backend. Nothing else needs to be run by hand before a merge.

```bash
npm test          # Vitest + React Testing Library (jsdom) for the frontend
```

```bash
cd backend
./.venv/bin/python manage.py migrate     # required after pulling: new constraints and columns
./.venv/bin/python manage.py test        # needs DJANGO_SECRET_KEY in the environment
```

Set `DJANGO_SECRET_KEY`, and outside local development also `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
a real `EMAIL_*` configuration, and optionally the `DJANGO_THROTTLE_*` rate overrides (see
`backend/docs/api-v1.md`). `DJANGO_DEBUG` defaults to `false`, so a deployment that forgets it gets the
hardened branch (SSL redirect, HSTS, secure cookies, `X-Frame-Options: DENY`) rather than debug pages;
`backend/.env` is what turns debug on for local work. `manage.py close_overdue_exams` ends
exams whose window has passed and is safe to run from cron, though the teacher list already reconciles
its own scope lazily.
