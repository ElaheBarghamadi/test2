# Examora backend architecture

## Scope

The backend is an independently runnable Django/DRF service alongside the root-level Next.js frontend. This release implements JWT authentication, password reset/change, self-profile management, school membership/onboarding, administrator school/user management, teacher/admin exam and question management, and the complete student attempt lifecycle: availability, start/reuse, safe session detail, autosave, flags, deadline finalization, automatic grading, manual text grading, publication, and visibility-gated results. The existing Next.js UI connects to these APIs through typed adapters.

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
| `DEFAULT_FROM_EMAIL` / `DJANGO_EMAIL_BACKEND` | Reset-email sender and Django delivery backend; configure SMTP variables in production. |

When `DATABASE_URL` is deliberately absent, a local ignored SQLite database supports smoke tests. Shared, staging, and production deployments must provide PostgreSQL. Timestamps are timezone-aware (`USE_TZ=True`, `TIME_ZONE=Asia/Tehran`).

## Installed applications

- **core**: UUID/timestamp base model, health endpoint, and the DRF exception envelope.
- **organizations**: `School` tenant boundary, one-school-per-user membership, Django Admin registration, and administrator management/reporting APIs.
- **users**: custom email user, lean role profiles, JWT auth, password reset/change, self-profile serializers, and reusable role/owner permissions.
- **exams**: teacher-owned exams, structured settings, questions/options, workflow/validation services, and teacher/student serializer separation.
- **attempts**: student availability/start/detail, strict answer autosave and flags, durable attempt question order, deadline finalization, and submission services.
- **results**: persisted automatic-grading snapshots, manual-grading pending count, and student visibility-gated safe result reads.

`AUTH_USER_MODEL = "users.User"` was set before initial migrations. Do not replace it after data exists.

## Domain and workflow decisions

### Users and profiles

`User` authenticates with email and has `STUDENT`, `TEACHER`, or `ADMIN` role choices plus Django active/staff flags. Student and teacher profile signals provision only the matching lean profile. Public registration allows only `student` and `teacher`; administrator creation is controlled through the admin-only user API or Django Admin. An optional active-school join code creates a one-school membership without exposing the code in safe user responses.

Self-profile updates use structured nested profile serializers. They cannot mutate role, email, staff/superuser/active flags, or managed profile identifiers. Passwords use separate authenticated change and anonymous one-time reset flows; reset delivery is environment configured and its request response never reveals whether an account exists.

### Exams and settings

`Exam` owns teacher, metadata, duration, schedule, status, and a persisted total mark value. The narrow one-to-one `ExamSettings` model holds navigation, randomization, result visibility, correct-answer visibility, and attempt limits; API input uses this structured model rather than an unvalidated settings blob.

Normal patches never change status. Service functions in `apps.exams.services` own publishing, completion, archive, restore, duplication, and ordering transitions. `status_before_archive` is a small internal field that lets restore return an exam to its prior state; it is not client-writable.

### Questions and answer keys

Question types are structured Django choices: multiple choice, multiple answer, true/false, short answer, and written. Choice correctness lives in `QuestionOption`; short/written metadata has a narrowly validated `configuration` object. New teacher questions append safely, and reordering requires the complete question ID set in one transaction.

Teacher serializers may include `is_correct`, explanation, and configuration. The independent student attempt serializer family deliberately excludes answer keys, expected answers, explanations, configuration, teacher identity, result visibility, and correct-answer settings. Student routes never reuse a teacher serializer.

### Publication and integrity

`validate_exam_for_publication()` is the shared publish gate. It requires a title, valid schedule, at least one question, and valid option/type configuration. Publishing atomically selects `scheduled` for future starts or `active` otherwise; expired schedules and invalid transitions return structured DRF validation errors.

`duplicate_exam()` copies settings, questions, and options in a transaction, assigns the caller as owner, forces the duplicate to `draft`, and leaves the source untouched.

### Student attempts, timing, and results

Student access uses structured grade/class values already present on `StudentProfile` and `Exam`: a blank target is open to every eligible student, while a populated target must match the profile. When an exam owner belongs to a school, the student must belong to that same school; legacy users without a teacher-school membership retain the former audience behavior. Draft and archived exams are never exposed; schedule windows are evaluated with timezone-aware server time.

`ExamAttempt.question_order` is a backend-generated UUID snapshot. It persists the one-time randomized question sequence when `ExamSettings.randomize_questions` is enabled, so response order cannot change between requests. There is intentionally no option-randomization feature because no current structured setting defines it.

The authoritative deadline is the earlier of `started_at + duration_minutes` and exam `end_at`. A request reaching an expired active attempt retains saved answers, changes the status to `EXPIRED`, records `submitted_at`, and creates a grading snapshot. Answer writes then fail. Duplicate start returns the active attempt; duplicate submission returns the existing finalized result.

Choice questions are graded with exact correct-option set matching; multiple-answer intentionally awards full credit only for an exact set. Short answers are graded only when the existing typed `expected_answers` structure is configured. Written answers and unconfigured short answers remain pending manual grading and do not count as incorrect. Result percentage is null until all manual grading is complete.

`ExamSettings.result_visibility` maps to persisted result state: `immediate` publishes a safe aggregate result, while `pending` and `hidden` are stored but withheld. `show_correct_answers` is deliberately not exposed by student APIs in this release: no student response returns answer keys, per-question correctness, explanations, or configuration.

## Permissions and query policy

Use `apps.users.permissions` rather than ad hoc role checks. Teacher management routes require `IsTeacherOrAdministrator` plus `IsExamOwnerOrAdministrator`. Student routes require `IsStudent` or `IsOwnStudentAttempt`; teachers and administrators cannot act as students through these endpoints. Teachers receive owner-filtered querysets; unseen teacher/student-owned resources return `404` rather than leak existence. Administrators retain the broader teacher-management access already established.

Administrator organization lists annotate school/exam/user counts and select related membership/profile rows. Major teacher list/detail queries use `select_related()` for teacher/settings and targeted `prefetch_related()` for questions/options. School-assigned teachers receive a same-school roster including students with no attempt; legacy teachers receive participant-derived rows. Student attempt detail prefetches the caller's answers/options and independently fetches the persisted ordered question set, avoiding obvious N+1 patterns.

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

## Deliberately deferred

- Option randomization, advanced partial scoring, fuzzy/NLP assessment, and post-exam answer-key review
- Redis, WebSockets, Celery, proctoring, anti-cheating, advanced analytics, and deployment pipeline work
