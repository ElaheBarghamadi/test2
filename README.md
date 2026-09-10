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

## Frontend

The frontend remains the repository root. Copy the public-safe API example and start the app:

```bash
cp .env.local.example .env.local
npm ci
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL=/api/v1` uses the server-only `API_PROXY_TARGET` rewrite in local development, so browser code never embeds a localhost API URL. For a deployed HTTPS API, set `NEXT_PUBLIC_API_BASE_URL` to its `/api/v1` origin and configure Django CORS for the frontend origin.

Validate a production build (do not run it concurrently with `npm run dev`):

```bash
npm run build
```

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
- `/teacher/dashboard`, `/teacher/exams`, `/teacher/exams/create`, `/teacher/exams/{exam_id}`, `/teacher/exams/{exam_id}/edit`, `/teacher/questions`, `/teacher/results`, `/teacher/students`
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
- School/membership models, public active-school code onboarding, admin-only school/user management and network monitoring APIs, professional Django Admin registration for all domain models, a safe liveness endpoint at `GET /health/`, and a predictable DRF error envelope.

Read [`backend/docs/api-v1.md`](backend/docs/api-v1.md) for the actual endpoints and payloads, then [`backend/docs/architecture.md`](backend/docs/architecture.md) before implementing the next API slice.

## Frontend integration boundaries

- `lib/api/` is the sole typed fetch boundary: DTOs, mapping adapters, JSON/DRF errors, bearer headers, and one safe refresh/retry path live there.
- `lib/state/auth-store.ts` confirms `/auth/me/` after login and derives every route role from the server response.
- Teacher exam/question mutations remain in `lib/services/teacher-exam-service.ts`; the service orchestrates Django's intentionally separate exam, question, reorder, and publish endpoints.
- Student attempts use `lib/services/exam-attempt-service.ts` and only send selected option IDs or text. Correct answers and grading configuration never enter student state.

## Teacher workflow

The teacher workspace supports server-backed search/filter/sort, duplication/archive/restore, a five-step exam builder, typed question editing, scheduling, draft save/publish, participant reporting, manual text grading, controlled result publication, and CSV export. Question authoring is full CRUD: options can be added, re-worded, duplicated, reordered, and removed (the builder offers between two and ten rows, matching the server's minimum of two), each type marks its own answer key, short answers keep a list of accepted responses with case sensitivity, and every rule the publish gate enforces is previewed inline before saving. `start now` and `extend time` live on the exam detail screen and refuse themselves with the server's reason when the status or the clock does not allow it, and the detail screen states plainly when an exam is live and how many attempts are already recorded. It keeps the Persian/RTL design system and discriminated `Question` union intact.

## Student exam workflow

The student space is driven by server state end to end: the dashboard groups exams into ready/upcoming/in-progress/completed with the real remaining time, the start screen states the marks, the pass mark, the attempt budget, and the release policy before the clock begins, and the session itself autosaves each answer, keeps flags, survives a dropped connection by queueing writes, and re-reads the deadline from the server every minute and on tab focus so a teacher extension cannot be missed. When the countdown reaches zero the session confirms the deadline with the server, flushes queued answers, and submits itself; leaving mid-exam asks for confirmation first. Results show the published score, the pass verdict, and whether any answer still awaits manual grading.

## Tests

```bash
npm test          # Vitest + React Testing Library (jsdom) for the frontend
```

```bash
cd backend
./.venv/bin/python manage.py test        # needs DJANGO_SECRET_KEY in the environment
```
