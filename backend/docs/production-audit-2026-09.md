# Production readiness audit — 2026-09-10 (step 2: gap analysis)

Audited: `app/**`, `components/**`, `hooks/**`, `lib/**`, `backend/apps/**`, settings, migrations,
tests, `docs/api-v1.md`, `docs/architecture.md`. Every item below was reproduced against the running
API or read directly out of the code; nothing here is a guess.

## Critical bugs (fixed in this pass)

1. **`DELETE /api/v1/questions/{id}/` returns HTTP 500 on any question a student answered.**
   `StudentAnswer.question` is `PROTECT`, and `TeacherQuestionDetailView.delete` calls
   `question.delete()` without handling `ProtectedError`, so the teacher gets an HTML debug page
   (stack trace, settings table) instead of an explanation. Reproduced: `500 ProtectedError`.
2. **Per-attempt deadline is derived from the live exam row.** `attempt_expires_at()` reads
   `attempt.exam.duration_minutes`, so a routine `PATCH /exams/{id}/ {"duration_minutes": 5}` while a
   class is writing silently re-cuts every running session's time (reproduced: a student's
   `remaining_seconds` dropped from 1800 to 300 with no other signal), and can expire an attempt
   mid-answer before the student reconnects.
3. **`complete_exam` / `archive_exam` leave attempts open.** After the teacher ends an exam, an
   in-progress attempt stays `in_progress` and keeps accepting answer writes (reproduced: `complete`
   → `200`, attempt still `in_progress`). Ending an exam must not extend the window for writing.
4. **Re-grading silently un-publishes a published result.** `TeacherManualGradeView` calls
   `_grade_attempt()`, which sets `status` from `exam.settings.result_visibility` and
   `published_at=None`. With `result_visibility=pending`, publishing exam results and then grading one
   more answer flips that result back to `pending` — a result a student already saw disappears.
5. **The grading snapshot has no denominator.** `ExamResult` stores `score`/`percentage` but not
   `maximum_score`; both read endpoints report the live `exam.total_marks`. Editing question marks after
   a result is graded leaves a student looking at `percentage: 100` next to `score 4 of 10`.
6. **No rate limiting anywhere.** `login`, `register`, `password-reset` and `password-reset/confirm` are
   `AllowAny` with unlimited attempts, and `PASSWORD_RESET_TIMEOUT` is Django's 3-day default.

## Security issues (fixed)

7. `CORS_ALLOW_CREDENTIALS = True` although authentication is a bearer header only — needless cookie
   exposure surface on a CORS-permitted origin.
8. No production transport hardening: HSTS, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`,
   `SECURE_SSL_REDIRECT`, `SECURE_CONTENT_TYPE_NOSNIFF` are unset; `DEBUG` defaults to true and
   `ALLOWED_HOSTS` includes a preview domain. Documented + env-gated defaults added.
9. `AdminUserSerializer` exposes `email` + `last_login` to admins only — verified correct; kept.

## Data integrity (fixed)

10a. **Teacher exam list inflated `question_count`.** `TeacherExamListCreateView.get` re-declared
   `question_count=Count("questions")` over the queryset that already had a distinct annotation, and the
   attempts join multiplied the rows: an exam with 3 questions and 4 attempts reported **12 questions**
   (reproduced before the fix, `12 != 3`). The list and the detail row now come from one annotated
   queryset, and `ExamListCounterAccuracyTests` pins it.


10. Missing database-level checks that only exist in `clean()`: `attempt_number >= 1`,
    `question.marks >= 0`, `option.order >= 1`, `exam.duration_minutes >= 1`,
    `end_at > start_at`, `result.score <= result.maximum_score`. A direct ORM write (admin, shell,
    data fix) can violate all of them today.
11. `ExamSettings` rows are created by a signal-less `get_or_create` in two places; a missing row
    currently 500s rather than self-healing on read paths that assume `exam.settings`.

## Exam-lifecycle / concurrency gaps (fixed)

12. **No stale-write protection.** Any answer `PATCH` overwrites unconditionally: a retried request, a
    queued offline batch, or a second tab can silently replace a newer answer. No revision exists.
13. **No multi-tab/multi-device control or detection.** Two tabs autosave the same attempt with
    last-write-wins and no signal reaches the teacher.
14. **No server-side session/activity log**, so "suspicious behaviour" reporting cannot exist.

## Missing essential features (implemented)

15. **Option order randomization is absent** (`ExamSettings.randomize_questions` exists; option order is
    always `order`). Deterministic per attempt, keyed by option UUID so grading is unaffected.
16. **Question bank is not a bank**: `/teacher/questions` only edits the questions of one exam. No
    search, filters, tags, difficulty, usage counts, archive, or reuse into another exam.
17. **No in-app notifications**, so "result published" only reaches a student who happens to reload.
18. **No grading queue**: a teacher with several exams cannot list "answers waiting for me" or see
    `17 / 24 graded`; the results page only works one exam at a time.
19. **Dashboard statistics are partly invented.** The teacher dashboard's participation bar is
    `Math.min(100, 20 + participant_count * 10)` — a fabricated percentage. No average score, pass
    rate, or completion rate is computed anywhere.

## Performance (fixed where it matters at ~180 students)

20. `GET /student/exams/` runs 2 extra queries per candidate exam (teacher membership + student
    profile) inside a Python loop → ~180 students × exams of unbounded fan-out; profile/school are
    per-request constants and belong outside the loop.
21. The student clock resync downloads the full attempt detail (all questions + options + answers) every
    60 s just to read `remaining_seconds`.
22. `TeacherStudentsOverviewView` materialises every attempt of every exam in Python.

## Accessibility / UI (fixed)

23. Autosave status is colour+text but not announced (`aria-live`), so a screen-reader user does not
    learn that a save failed; the exam timer announces every minute change (`aria-live=polite` on a
    1 Hz countdown) which is hostile with a reader enabled.
24. Question-navigator state is conveyed by colour alone (green/amber/grey); the flag glyph is the only
    non-colour cue.
25. Destructive teacher actions in the exam list menu archive without a confirmation summary of impact
    (attempt counts).

## Deliberate non-changes (documented, not bugs)

- Multiple-answer scoring stays full-credit exact-set matching: it is an existing, tested business rule
  and changing it would silently re-grade past attempts.
- `show_correct_answers` remains stored but unread by student routes; there is still no post-submit
  answer-review policy decision.
- No WebSocket/Celery/Redis: HTTP heartbeat + lazy finalization covers the requirement at this scale.
- Attempt expiry remains lazy (finalized on read/write) instead of a cron: no scheduler exists in this
  stack and every read path is idempotent.

## Resolution

| Area | Status |
| --- | --- |
| Items 1–13 (crashes, timer snapshot, lifecycle closure, publication integrity, frozen denominator, rate limiting, CORS/transport hardening, DB constraints, stale-write guard, session control, activity log) | Fixed, each with a backend test |
| Items 15–19 (option randomization, question bank, notifications, grading queue, fake statistic on the dashboard) | Implemented, with tests |
| Items 20–22 (audience N+1, oversized clock polling, roster loop) | Fixed: one `AudienceContext` per request, a dedicated heartbeat route, and annotated aggregates |
| Items 23–25 (aria-live, colour-only states, destructive-action copy) | Fixed on the exam screen, navigator, timer and dialogs |
| Item 26 (start inside the closing minute) | Fixed: 60-second floor, refused with `seconds_left`, mirrored in the start screen |

Backend suite: 186 tests. Frontend suite: 81 tests (`tsc --noEmit` and `next build` clean). A live
end-to-end probe (`118` HTTP checks exercised every new rule against the running API: session takeover,
stale-write refusal, deadline snapshot, exam-end finalization, option order stability, frozen grading
maximum, bank import/usage/archive, notification fan-out and read receipts, and the login throttle (429 on
the 13th attempt from one address against one account, unaffected for a neighbouring account).
