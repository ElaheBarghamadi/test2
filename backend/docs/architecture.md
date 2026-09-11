# Examora backend architecture

## Scope

The backend is an independently runnable Django/DRF service alongside the root-level Next.js frontend. It implements JWT authentication with rate limiting, password reset/change, self-profile management, school membership/onboarding, administrator school/user management, teacher exam and question management (including early start, time extension, and a reusable searchable question bank), the complete student attempt lifecycle (availability, start/reuse, safe session detail, guarded autosave, offline queue, flags, deadline finalization, automatic grading, manual grading, publication, visibility-gated results), server-recorded session activity signals, and in-app notifications. The existing Next.js UI connects to these APIs through typed adapters.

Detailed request/response documentation is in [`api-v1.md`](api-v1.md).

## Dependency management

`pyproject.toml` is the source of dependency intent, with deliberately narrow compatible-version ranges. `requirements.lock` records the verified runtime resolution; update both intentionally. Local development installs the project with `pip install -e .`.

## Runtime configuration

`config/settings.py` loads `backend/.env` first and then an optional monorepo-root `.env`.

| Variable | Purpose |
| --- | --- |
| `DJANGO_SECRET_KEY` | Required when `DJANGO_DEBUG=false`; always use a unique secret outside local smoke tests. |
| `DJANGO_DEBUG` | Defaults to `true` only for local development. |
| `DATABASE_URL` | PostgreSQL connection URL for intended shared/runtime environments. |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated HTTP host allowlist. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origin allowlist; wildcard origins are disabled. |
| `CSRF_TRUSTED_ORIGINS` | Optional trusted origins for Django-admin/session use. |
| `FRONTEND_URL` | Absolute frontend origin embedded in password-reset emails. |
| `DJANGO_THROTTLE_LOGIN` / `_REGISTER` / `_PASSWORD_RESET` / `_EXAM_WRITE` | Per-scope rate limits; an empty value disables that scope. |
| `DJANGO_PASSWORD_RESET_TIMEOUT_SECONDS` | Reset-link lifetime (three hours by default; Django's own default is three days). |
| `DJANGO_CORS_ALLOW_CREDENTIALS` | Off by default; bearer tokens need no ambient credentials. |
| `DJANGO_SECURE_SSL_REDIRECT` / `DJANGO_SECURE_HSTS_SECONDS` / `DJANGO_ALLOWED_HOSTS` | Transport hardening, applied only when `DJANGO_DEBUG=false`. |
| `DEFAULT_FROM_EMAIL` / `DJANGO_EMAIL_BACKEND` | Reset-email sender and Django delivery backend; configure SMTP variables in production. |

When `DATABASE_URL` is deliberately absent, a local ignored SQLite database supports smoke tests. Shared, staging, and production deployments must provide PostgreSQL. Timestamps are timezone-aware (`USE_TZ=True`, `TIME_ZONE=Asia/Tehran`).

## Installed applications

- **core**: UUID/timestamp base model, health endpoint, and the DRF exception envelope.
- **organizations**: `School` tenant boundary, one-school-per-user membership, Django Admin registration, and administrator management/reporting APIs.
- **users**: custom email user, lean role profiles, JWT auth, password reset/change, self-profile serializers, and reusable role/owner permissions.
- **exams**: teacher-owned exams, structured settings, questions/options, workflow/validation services, and teacher/student serializer separation.
- **attempts**: student availability/start/detail, strict answer autosave and flags, durable attempt question order, deadline finalization, and submission services.
- **results**: persisted grading snapshots (score, frozen maximum, verdict counts, manual-grading progress), manual grading, publication, teacher reporting, and the grading queue.
- **notifications**: in-app, recipient-scoped rows with per-event dedupe, written inside the transition they describe.

`AUTH_USER_MODEL = "users.User"` was set before initial migrations. Do not replace it after data exists.

## Domain and workflow decisions

### Users and profiles

`User` authenticates with email and has `STUDENT`, `TEACHER`, or `ADMIN` role choices plus Django active/staff flags. Student and teacher profile signals provision only the matching lean profile. Public registration allows only `student` and `teacher`; administrator creation is controlled through the admin-only user API or Django Admin. An optional active-school join code creates a one-school membership without exposing the code in safe user responses.

Self-profile updates use structured nested profile serializers. They cannot mutate role, email, staff/superuser/active flags, or managed profile identifiers. Passwords use separate authenticated change and anonymous one-time reset flows; reset delivery is environment configured and its request response never reveals whether an account exists.

### Exams and settings

`Exam` owns teacher, metadata, duration, schedule, status, and a persisted total mark value. The narrow one-to-one `ExamSettings` model holds navigation, question and option randomization, the complete-answer-sheet rule, result visibility, correct-answer visibility, attempt limits, and the passing percentage; API input uses this structured model rather than an unvalidated settings blob, and every field is validated in both `clean()` and the serializer.

Normal patches never change status. Service functions in `apps.exams.services` own publishing, completion, archive, restore, duplication, and ordering transitions. `status_before_archive` is a small internal field that lets restore return an exam to its prior state; it is not client-writable.

### Questions and answer keys

Question types are structured Django choices: multiple choice, multiple answer, true/false, short answer, and written. Choice correctness lives in `QuestionOption`; short/written metadata has a narrowly validated `configuration` object. New teacher questions append safely, and reordering requires the complete question ID set in one transaction.

Teacher serializers may include `is_correct`, explanation, and configuration. The independent student attempt serializer family deliberately excludes answer keys, expected answers, explanations, configuration, and correct-answer settings. Result visibility and the answer-sheet rule are included on purpose: a student must be able to see when a result will appear and whether blanks block submission, and neither is a grading secret. Student routes never reuse a teacher serializer.

### Publication and integrity

`validate_exam_for_publication()` is the shared publish gate. It requires a title, valid schedule, at least one question, and valid option/type configuration. Publishing atomically selects `scheduled` for future starts or `active` otherwise; expired schedules and invalid transitions return structured DRF validation errors.

`duplicate_exam()` copies settings, questions, and options in a transaction, assigns the caller as owner, forces the duplicate to `draft`, and leaves the source untouched.

### Student attempts, timing, and results

Student access uses structured grade/class values already present on `StudentProfile` and `Exam`: a blank target is open to every eligible student, while a populated target must match the profile. When an exam owner belongs to a school, the student must belong to that same school; legacy users without a teacher-school membership retain the former audience behavior. Draft and archived exams are never exposed; schedule windows are evaluated with timezone-aware server time.

`ExamAttempt.question_order` is a backend-generated UUID snapshot: the one-time randomized question sequence, so order cannot change between requests. `ExamAttempt.option_order` does the same per question when `randomize_options` is enabled. Both are snapshots rather than per-request randomness, which is what makes refresh, reconnect, and re-open show the same paper. Grading always matches option UUIDs — never a position — so no shuffle can move a score, and true/false is excluded from option shuffling because the student's boolean answer maps positionally.

The authoritative deadline is snapshotted per attempt: `ExamAttempt.expires_at = min(started_at + duration_minutes, exam.end_at)`, evaluated once at start. Deriving it from the live exam row instead (the previous behaviour) let a routine `PATCH /exams/{id}/ {"duration_minutes": 5}` re-cut the time of every student mid-answer. `extend_exam_time` therefore moves open attempts' deadlines explicitly, and completion/archival set them to now so a closed exam leaves no window behind.

A request reaching an expired active attempt retains saved answers, changes the status to `EXPIRED`, records `submitted_at`, and creates a grading snapshot. Answer writes then fail with `409 {"code": "attempt_finalized"}`. Duplicate start returns the active attempt; duplicate submission returns the existing finalized result.

Two optimistic-concurrency guards cover the races that actually happen. `answer_revision` increments inside every accepted write, and a request whose `X-Exam-Revision` is older is refused with `409 {"code": "stale_revision", "answer_revision": n}`, so a retried or offline-queued request cannot overwrite a newer answer; the client re-bases from the reported number and sends once more. `client_session` names the window that owns the attempt: a write from a different `X-Exam-Session` while the owner wrote within 45 seconds is refused with `409 {"code": "another_session_active"}`. Reads are never refused, and `claim-session` is the explicit takeover, so an accidental duplicate tab cannot quietly destroy answers and a deliberate device switch is one click. Both guards are opt-in per request (absent headers mean no guard), which keeps older clients working.

`ExamSettings.question_layout` is how the teacher delivers the paper: `paged` (the default) shows one question per screen, `single_page` shows the whole sheet at once. It is presentation only — it enters no snapshot, no grading path and no permission check, and a student can never set it.

`allow_previous_questions` is a rule, not a look. When it is `false` **and** the layout is `paged`, `ExamAttempt.answer_frontier` records the highest snapshot index an answer has been written to, and a later write naming a question below it is refused with `409 {"code": "question_locked", "question_ids": [...]}`. The frontier is measured in the attempt's own `question_order`, resolved server-side from the attempt rather than from anything the client sends, so a shuffled paper cannot be walked backwards by relabelling indices. A batch is refused whole rather than applied in part — a half-applied flush would leave answers saved but reported as failures — and the client drops the named ids, re-reads them, and resends the rest. Flagging stays allowed on a passed question: it asks the teacher to look at an answer, it does not change one. `single_page` is exempt by definition, since "going back" has no meaning when everything is on screen, and the refusal never applies to `answer_frontier` staying at zero on a permissive exam. Both the write response and the heartbeat carry the frontier, so the runner can grey out a passed question without a full detail read.

State transitions run in transactions that lock the parent row: `select_for_update()` on the exam for start/publish/extend/complete/archive/duplicate/reorder, and on the attempt for every answer, flag, and submission. On SQLite the locks are effectively no-ops and correctness rests on the unique constraints (`unique_exam_student_attempt_number`, `unique_answer_per_attempt_question`); on PostgreSQL they serialize the concurrent-start and double-submit races outright.

`ExamResult` is a snapshot, not a recompute-on-read: it stores the score, the frozen `maximum_score` it was graded against, the verdict counts, `manual_grading_count` for progress, and `published_at`. Re-grading preserves a `PUBLISHED` status (stamping `revised_at`) because pulling a result back out of a student's hands is not a side effect anyone asked for; publication is reversed deliberately by an administrator, not implicitly by the next keystroke.

Choice questions are graded with exact correct-option set matching; multiple-answer intentionally awards full credit only for an exact set. Short answers are graded only when the existing typed `expected_answers` structure is configured. Written answers and unconfigured short answers remain pending manual grading and do not count as incorrect. Result percentage is null until all manual grading is complete.

Marking is read through the same verdict the score came from. `apps/attempts/grading.py` is the only place that decides what one answer is worth and returns `{awarded, verdict, requires_manual}`; `ExamAttemptService._grade_attempt` uses it to persist the totals, and `TeacherAttemptAnswerSerializer` uses it to describe a single answer, so the number on the sheet and the number in the score cannot drift apart. A blank answer is a zero and never enters the grading queue, which is why a sheet cannot stay pending over a question the student deliberately skipped.

The teacher's marking desk (`/teacher/exams/{exam_id}/marking`) is built on that: it shows the **whole** sheet, keyed questions included, with the mark the exam gave them and the answer that earned it, read-only — the teacher signs off on a complete paper instead of seeing only the leftovers. Two orders are supported because the two jobs are different: sheet by sheet for one student, and question by question for the whole cohort at once, where `POST /results/teacher/exams/{exam_id}/grading/{question_id}/` writes every mark on the screen in one transaction and re-grades each touched attempt. The batch is deliberately all-or-nothing — every row is validated first, so a typo in the ninth student's box cannot leave half a class saved — and it refuses rows belonging to another exam, marks above the question's own weight, and any attempt at a keyed question, which is auto-graded and therefore not the teacher's to type over. It carries no throttle scope, matching `TeacherManualGradeView`, because a marking screen is a burst of keystrokes, not a rate-limit candidate.

`ExamSettings.result_visibility` maps to persisted result state: `immediate` publishes a safe aggregate result, while `pending` and `hidden` are stored but withheld. `show_correct_answers` is deliberately not exposed by student APIs in this release: no student response returns answer keys, per-question correctness, explanations, or configuration.

## Who may be shown a page

API authorization and page visibility are different doors, and only one of them used to exist. Every Django endpoint re-checks the bearer role and object owner; nothing in the frontend widens or narrows that. Before this layer, `curl /admin/users` answered `200` with the administrator shell, because the role check ran in the browser after hydration — the markup had already been produced and sent, and only then was the visitor redirected.

`middleware.ts` now decides before rendering, from `lib/auth/page-access.ts` (`/student` → students, `/teacher` → teachers and administrators, `/admin` → administrators only). To ask the question server-side, login also mirrors the session: two HttpOnly cookies, `examora_role` (this app's own record, including the access-token expiry) and `examora_access` (one cookie holding `access~refresh`, joined on `~` because a JWT already contains dots; a mirror written before the separator changed is still readable through a legacy dot fallback).

The credential itself lives in `localStorage`, not `sessionStorage`. That is a deliberate change with a reason worth keeping in the record: `sessionStorage` is per-tab, so a teacher who opened an exam or a marking screen in a second tab had no credential there while the first tab stayed signed in, and because cookies *are* shared the server rendered the page while the client insisted on a login. Sharing `localStorage` makes the credential's reach match the cookie's. The cost is persistence: the tokens now outlive the last tab, which is why `lib/api/token-storage.ts` drops a session nobody has touched for eight hours and re-reads the shared value on every use. A rotated or cleared token propagates through the `storage` event, so one tab logging out logs every tab out, and no tab keeps refreshing with a token the server has already blacklisted. The gate verifies the mirrored token against `GET /api/v1/auth/me/` and takes the role **from that reply**, never from the cookie, so forging `examora_role` buys nothing; a verified role mismatch rewrites the mirror rather than logging anyone out, which is how a demotion lands on the same navigation. The mirror is never forwarded to Django as authorization, so it is not a credential and carries no data.

Three limits are accepted deliberately and should not be read as stronger than they are. A rendered shell is not an authorized read: every value on it still has to pass the API. When the internal API hop is unreachable, the gate falls back to the role hint and renders, rather than locking a school out of its own screens on a network blip. And a role change propagates within the fingerprint cache's TTL (15 seconds) plus the mirror's own lifetime, not instantly. `lib/auth/page-access.ts` is tested as pure logic (`npx vitest run lib/auth/page-access.test.ts`) and the API half by `backend/apps/core/test_access_matrix.py`.

## Dates are Jalali everywhere, including at the point of entry

Every date the app prints goes through `formatDate`/`formatDateTime` with `fa-IR-u-ca-persian`, so a day
is never shown as a Gregorian number inside a Persian sentence, and the exam calendar is a real Jalali month
grid. The part that used to break the promise was *entry*: scheduling an exam meant a browser-native
`datetime-local` control, i.e. a Gregorian grid, and the edit form read the stored instant back as UTC, so a
Tehran exam appeared in the field three and a half hours early and could be saved at that wrong time.

`lib/utils/persian-civil.ts` is the answer: civil (no-instant) Persian↔Gregorian arithmetic with `Intl` as
the only calendar oracle, so the picker names months exactly the way the display formats them, and
`components/ui/persian-date-time-field.tsx` schedules a start and an end on the school's own calendar —
Persian month names, Persian digits, Saturday first, `امروز`, hour and minute selects. Browsers whose ICU
has no Persian calendar get a plain native input plus a sentence saying why, never a Gregorian grid wearing
Persian labels.

None of this touches the API contract. `start_at`/`end_at` are still ISO-8601 instants; `apiDate` in
`lib/api/mappers.ts` turns a wall clock plus the exam's timezone into that instant, and `dateTimeInput` now
reads it back as the same wall clock, so editing an exam without touching its schedule no longer moves it.
The window summary and the validation compare instants computed in the exam's timezone rather than the
reader's.

## Permissions and query policy

Use `apps.users.permissions` rather than ad hoc role checks. Teacher management routes require `IsTeacherOrAdministrator` plus `IsExamOwnerOrAdministrator`. Student routes require `IsStudent` or `IsOwnStudentAttempt`; teachers and administrators cannot act as students through these endpoints. Teachers receive owner-filtered querysets; unseen teacher/student-owned resources return `404` rather than leak existence. Notification rows and the attempt heartbeat/claim/signal routes are filtered by `recipient`/`student` in the queryset before any object check, so another account's row is indistinguishable from a missing one. Administrators retain the broader teacher-management access already established.

Administrator organization lists annotate school/exam/user counts and select related membership/profile rows. Major teacher list/detail queries use `select_related()` for teacher/settings and targeted `prefetch_related()` for questions/options. School-assigned teachers receive a same-school roster including students with no attempt; legacy teachers receive participant-derived rows. Student attempt detail prefetches the caller's answers/options and independently fetches the persisted ordered question set, avoiding obvious N+1 patterns. `GET /student/exams/` resolves the caller's school membership and profile once (`AudienceContext`) instead of twice per exam, which was the dominant cost of the busiest student route. The clock resync uses the heartbeat route, which returns a handful of scalars (deadline, status, revision, navigation frontier, ownership) rather than a serialized answer sheet. Teacher list/detail rows annotate distinct counts so a question count is never multiplied by the attempts join.

## API conventions

- Liveness: `GET /health/` returns only `{ "status": "ok", "service": "examora-backend" }`.
- API base: `/api/v1/`.
- Access tokens are bearer JWTs (15 minutes); refresh tokens rotate and are blacklisted at logout.
- DRF errors use `{ "detail": <DRF details>, "status_code": <HTTP status> }` and never expose debug traces.
- The default DRF policy is authenticated. Public auth endpoints explicitly use `AllowAny`.

## Local verification

```bash
cd backend
./.venv/bin/python manage.py migrate
./.venv/bin/python manage.py check
./.venv/bin/python manage.py makemigrations --check --dry-run
./.venv/bin/python manage.py test
curl http://localhost:8000/health/
```

Create an administrative user in a controlled environment with `./.venv/bin/python manage.py createsuperuser`, then use `/admin/` for administration.

## Concurrency and integrity summary

- Attempt start, answer writes, flags and submission each run inside a transaction that locks the parent
  row (`select_for_update()` on the exam for start, on the attempt for every write).
- Attempt identity is enforced in the schema (`exam`, `student`, `attempt_number` unique), so a concurrent
  duplicate start cannot produce two attempts even where row locks are weak (SQLite).
- `answer_revision` is bumped per accepted write in the same transaction, and a stale `X-Exam-Revision` is
  refused — a retried request can never overwrite a newer answer.
- `X-Exam-Session` names the owning window; a second window may read but not write until it claims the
  session. The switch count and the claim are recorded as signals for the teacher, not enforced as a
  punishment.
- On a paged exam with `allow_previous_questions: false`, `answer_frontier` (the highest snapshot index
  written) is the server-side "no going back" boundary: a later write naming a question below it is refused
  whole, in a batch as well as singly, and the refused ids are reported back so the client can drop them.
  Indices come from the attempt's own snapshot, never from the client.
- A refused write still leaves its activity row — `stale_write_rejected` and `question_locked` events are
  created *after* the rolled-back transaction, in the view's conflict handler. Creating them inside it
  undid the row along with the write, which left the teacher's log missing exactly the refusals worth
  seeing.
- Grading is a snapshot write: score, frozen `maximum_score`, counts, `manual_grading_count`, and status
  transitions (`PENDING`/`HIDDEN`/`PUBLISHED`), never a recompute-on-read. Publication survives regrading.
- A start requires at least 60 seconds of remaining window, so the closing exam cannot consume a student's
  only attempt.
- `score <= maximum_score`, positive orders/marks/durations, `end_at > start_at` and
  `attempt_number >= 1` are database CHECK constraints, not only Python validation.

## Deliberately deferred

- Partial credit inside one multiple-answer question (exact-set matching is a deliberate rule with stored results behind it), fuzzy/NLP assessment, and post-exam answer-key review (`show_correct_answers` is stored and editable but no student route reads it yet).
- Redis, WebSockets, Celery, proctoring, screen capture, advanced analytics, and deployment pipeline work. Session detection, offline recovery, and clock reconciliation are all HTTP + snapshot state, which is sufficient at a school's scale and removes a failure domain rather than adding one.
- Automatic activation still runs lazily: reading the teacher exam list closes exams whose window has passed, and `manage.py close_overdue_exams` does the same for everyone when wired to cron.
