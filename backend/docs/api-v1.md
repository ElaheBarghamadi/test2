# Examora API v1 — implemented endpoints

Base URL: `/api/v1/`

Authentication: `Authorization: Bearer <access-token>` unless marked public. All date-times are ISO 8601, timezone-aware values.

API errors preserve DRF detail semantics inside a consistent envelope:

```json
{
  "detail": {"field_name": ["Validation message"]},
  "status_code": 400
}
```

Authentication failures are `401`, role/permission failures are `403`, and another teacher's owned resource is intentionally returned as `404` to avoid leaking its existence.

## Authentication and profile

| Method | URL | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/register/` | No | Public | Create a student or teacher account. Admin role is rejected. |
| `POST` | `/auth/login/` | No | Public | Exchange email and password for JWT tokens and safe user data. |
| `POST` | `/auth/token/refresh/` | No | Public | Rotate a refresh token for a new access token. |
| `POST` | `/auth/logout/` | Yes | Any | Blacklist the supplied refresh token. |
| `POST` | `/auth/password-reset/` | No | Public | Send a one-time reset link without revealing account existence. |
| `POST` | `/auth/password-reset/confirm/` | No | Public | Validate a one-time link and set the new password. |
| `GET` | `/auth/me/` | Yes | Any | Read the safe authenticated user and relevant profile. |
| `GET` | `/users/me/` | Yes | Any | Same safe self-profile representation. |
| `PATCH` | `/users/me/` | Yes | Any | Update the caller's own allowed profile fields. |
| `POST` | `/users/me/password/` | Yes | Any | Verify the old password and replace it with a validated new password. |

### Register

```json
{
  "email": "teacher@example.com",
  "first_name": "Mina",
  "last_name": "Ahmadi",
  "password": "A-long-unique-password",
  "role": "teacher",
  "school_code": "AB12CD34"
}
```

`role` is optional and defaults to `student`. Only `student` and `teacher` are accepted publicly. `school_code` is optional; when provided it must be the code of an active school and creates the account membership. The safe response may include `{ "school": { "id", "name", "city" } }`, but never the join code. The profile signal creates the matching lean profile; administrator accounts remain a controlled workflow concern.

Success (`201`) returns no password data:

```json
{
  "id": "uuid",
  "email": "teacher@example.com",
  "first_name": "Mina",
  "last_name": "Ahmadi",
  "full_name": "Mina Ahmadi",
  "role": "teacher",
  "profile": {"type": "teacher", "teacher_identifier": null, "department": ""},
  "created_at": "2026-09-06T...Z"
}
```

### Login, refresh, and logout

`POST /auth/login/` takes `{ "email": "…", "password": "…" }` and returns `access`, `refresh`, and the same safe `user` object. Invalid credentials use SimpleJWT's generic no-active-account response and do not disclose whether an email exists.

`POST /auth/token/refresh/` takes `{ "refresh": "…" }`. Refresh rotation and the token blacklist are enabled. `POST /auth/logout/` takes the active refresh token in the same shape and blacklists it, returning `204`. Already-issued access tokens cannot be revoked individually and remain usable only until their configured short expiry (15 minutes); this is the documented JWT invalidation behavior.

### Password reset and self-profile updates

`POST /auth/password-reset/` takes `{ "email": "…" }` and always responds generically to prevent account enumeration. For an active account it sends a URL to the configured `FRONTEND_URL`; local development deliberately uses Django console email. `POST /auth/password-reset/confirm/` takes `{ "uid", "token", "new_password" }`. Tokens are single-use because the password change invalidates them.

`POST /users/me/password/` takes `{ "old_password", "new_password" }`; it is authenticated and verifies the current password.

### Self-profile updates

The response is the same safe user object shown above. Accepted fields are intentionally narrow:

```json
{
  "first_name": "Mina",
  "last_name": "Ahmadi",
  "teacher_profile": {"department": "Sciences"}
}
```

Students may instead send `student_profile` with `grade` and/or `class_name`. `email`, `role`, `is_staff`, `is_superuser`, `is_active`, password, and identifiers are not mutable through this endpoint.

## Teacher exam management

All routes in this section require a teacher or administrator. A teacher only sees and changes their own exam rows. Administrators may access all rows. The API assigns the authenticated caller as the owner at creation and never reads a client-provided `teacher` value.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/exams/` | List caller-owned exams, or all exams for an administrator. |
| `POST` | `/exams/` | Create a draft exam. |
| `GET` | `/exams/{exam_id}/` | Read a teacher-management exam detail, including answer keys. |
| `PATCH` | `/exams/{exam_id}/` | Partially update permitted exam metadata/settings. |
| `POST` | `/exams/{exam_id}/publish/` | Validate then move draft/scheduled exam to `scheduled` or `active`. |
| `POST` | `/exams/{exam_id}/start/` | Open a published exam for students immediately (early start). |
| `POST` | `/exams/{exam_id}/extend/` | Add minutes to an `active` exam and shift its `end_at`. |
| `POST` | `/exams/{exam_id}/complete/` | Move an `active` exam to `completed`. |
| `POST` | `/exams/{exam_id}/archive/` | Archive without deleting the row. |
| `POST` | `/exams/{exam_id}/restore/` | Restore an archived exam to its previous appropriate state. |
| `POST` | `/exams/{exam_id}/duplicate/` | Atomically create a draft copy owned by the caller. |

### List filters

`GET /exams/` supports a deliberately small query surface:

- `status`: one of `draft`, `scheduled`, `active`, `completed`, `archived`
- `search`: title, description, or subject text
- `ordering`: `title`, `status`, `start_at`, `created_at`, `updated_at`, each optionally prefixed with `-`; default `-updated_at`

Invalid values return a validation error rather than being silently interpreted.

### Create/update payload

```json
{
  "title": "Cell biology assessment",
  "description": "Review of chapter three.",
  "subject": "Biology",
  "grade": "12",
  "class_name": "12-A",
  "instructions": "Read every prompt.",
  "duration_minutes": 45,
  "start_at": "2026-10-03T08:00:00+03:30",
  "end_at": "2026-10-03T08:45:00+03:30",
  "settings": {
    "allow_previous_questions": true,
    "question_layout": "paged",
    "randomize_questions": false,
    "result_visibility": "pending",
    "show_correct_answers": false,
    "max_attempts": 1,
    "passing_percentage": 50,
    "randomize_options": false,
    "allow_unanswered": true
  }
}
```

`randomize_options` shuffles option order per attempt (see *Option order* below); `allow_unanswered`
set to `false` makes `submit` refuse while any question in the attempt's own snapshot is still blank.
`question_layout` chooses how the paper is delivered — `paged` (default) shows one question per screen,
`single_page` shows the whole sheet at once — and is presentation only: it changes no mark, no snapshot and
no permission. `allow_previous_questions: false` is enforced by the server, but only on a `paged` layout,
where "going back" is a real move; on a one-page sheet the setting is stored and reported as inert rather
than silently rewritten (see *Going back* below).
`passing_percentage` is a percentage of the
exam total (`0`–`100`, two decimals, `0` meaning "no pass verdict"); it drives `passed` on every student
result and is copied by `duplicate`. Durations must be positive; an end time requires a start time and must follow it. `teacher`, `status`, `status_before_archive`, and `total_marks` are server-controlled and rejected in normal create/update payloads.

### Response metadata

Both `GET /exams/` and `GET /exams/{exam_id}/` annotate each row with the counters the teacher panel
shows, so no second request is needed:

- `teacher_name`: the owning teacher's full name
- `question_count`: number of questions (list rows carry the count, detail rows carry the bodies)
- `attempt_count`: student attempts recorded for the exam
- `participant_count`: distinct students with at least one attempt

### Start and extend

`POST /exams/{exam_id}/start/` is the "start now" control for a scheduled or draft exam whose content is
already valid. It answers `200` with the updated exam detail and refuses (`400`) when the exam is already
`active`/`completed`/`archived`, when `end_at` has passed, or when no valid question exists yet. Publishing
is not required first: starting implies the exam passed the same validation `publish` performs. A future
`start_at` is pulled back to now, and `total_marks` is refreshed before the exam opens.

```json
{"extra_minutes": 15}
```

`POST /exams/{exam_id}/extend/` accepts one integer between `1` and `180` and only works on an `active` exam;
any other field is rejected. It raises `Exam.duration_minutes` and moves `end_at` forward by the same amount.
Because attempt expiry is derived from `started_at + exam.duration_minutes` (capped by `end_at`) at read time,
students who are writing right now gain the same minutes on their next request — the web client re-reads the
deadline every 60 seconds and whenever the tab regains focus, so the extra time appears without a reload. An
attempt that had already been finalized is never revived.

### Status workflow

Normal `PATCH` requests cannot alter status.

- `publish`: only `draft` or `scheduled` exams; validation must pass. A future start schedules the exam, otherwise it activates it. A scheduled exam cannot be manually activated before its start.
- `complete`: only `active` to `completed`.
- `archive`: any non-archived status to `archived`, retaining the former status internally.
- `restore`: only `archived`; restores the saved status, adjusted for schedule expiry where needed.

Publishing requires a title, at least one valid question, a valid schedule, and a non-expired end time. The response reports question-specific validation keys such as `question:<uuid>` when content is invalid.

### Duplicate behavior

Duplication is atomic. It creates a new UUID, appends ` (Copy)` to the title, makes the caller the owner, forces `draft`, copies structured settings/questions/options, and does not mutate the original.

## Teacher question management

Question routes require the same teacher/admin and ownership rules as the parent exam. They deliberately use teacher serializers that contain correctness data. Student exam routes use a separate serializer family and never reuse these representations.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/exams/{exam_id}/questions/` | List ordered teacher-management questions. |
| `POST` | `/exams/{exam_id}/questions/` | Append a question to the exam. |
| `POST` | `/exams/{exam_id}/questions/reorder/` | Atomically replace the full question order. |
| `GET` | `/questions/{question_id}/` | Get a teacher-owned question. |
| `PATCH` | `/questions/{question_id}/` | Update a question and optionally replace options. |
| `DELETE` | `/questions/{question_id}/` | Delete a question and resequence the remaining questions. |

### Create/update payload

```json
{
  "type": "multiple_choice",
  "text": "Which organelle produces ATP?",
  "instructions": "Select one answer.",
  "marks": "2.00",
  "configuration": {},
  "explanation": "Mitochondria generate most cellular ATP.",
  "options": [
    {"text": "Mitochondrion", "is_correct": true},
    {"text": "Nucleus", "is_correct": false}
  ]
}
```

The server appends new questions and owns `order`; use reorder rather than sending an `order` field. An option array replaces the full option set on question `PATCH`, and response options are numbered in the received order.

### Option identity and answered-option protection

Each entry in `options` may carry the `id` of an existing option:

```json
{
  "type": "multiple_answer",
  "text": "Which units are SI?",
  "marks": "2.00",
  "configuration": {},
  "options": [
    {"id": "option-uuid-1", "text": "Newton", "is_correct": true},
    {"id": "option-uuid-2", "text": "Watt", "is_correct": true},
    {"text": "Pound", "is_correct": false}
  ]
}
```

- With an `id`, the row is updated in place, so its primary key — and therefore every `StudentAnswer.selected_options` link to it — survives an edit.
- Without an `id`, a new option is created. Options of the question that are absent from the payload are deleted.
- An `id` that is not an option of this question (foreign, or already deleted) is rejected with "One or more option IDs no longer exist on this question. Reload it and try again." Repeating one `id` twice in a single payload is rejected with "Option IDs must not repeat in one request."
- Removing an option that a student has already selected is refused with "Options 1, 3 are already part of a student answer and cannot be removed. Keep them in the list or duplicate the exam for a fresh structure." Re-wording that option, or changing which option is the key, remains allowed, so an exam in progress can be corrected without destroying submitted work.

A client that has no server identity for an option (a row the teacher just added in the builder) must omit `id` rather than invent one; any non-UUID placeholder is treated as a new option by the web client for that reason.

Two further guards protect attempts that already exist:

- `type` cannot change on a question that has student answers: the stored selection would be graded
  under different rules. The response is a `400` naming `type`.
- `DELETE /questions/{id}/` on a question with answers returns `409` with
  `{"code": "question_has_answers", "answered_count": n}`. `StudentAnswer.question` is `PROTECT`, and that
  protection is the point; before this check the ORM raised `ProtectedError` and the endpoint answered a
  `500` debug page.

### Bank metadata

A question also carries bank-only fields — they never enter grading:

| Field | Meaning |
| --- | --- |
| `difficulty` | `easy`, `medium` or `hard`; defaults to `medium` |
| `tags` | list of `{id, name}`; writing `["a", "b"]` replaces the set, `[]` clears it |
| `is_archived` | hidden from the bank list, still fully part of its exam |
| `usage_count` | how many questions were copied from this one |
| `answered_count` | how many student answers reference this row |
| `exam_title`, `exam_subject`, `exam_status` | the owning exam, so the bank needs no second request |

### Question bank endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/questions/` | Search every question the caller owns. Filters: `search`, `type`, `difficulty`, `tag`, `subject`, `exam`, `archived`, `ordering` (`updated_at`, `difficulty`, `marks`, `answered_count`, `type`, each optionally `-`prefixed). First 200 rows. |
| `GET` | `/questions/tags/` | The teacher's tags with usage counts, for filter chips. |
| `POST` | `/questions/{id}/archive/` | Body `{"action": "archive"}` or `{"action": "restore"}`. |
| `POST` | `/exams/{id}/questions/import/` | Body `{"question_ids": [...]}` — appends **copies** of those questions to the exam, in the given order, and records `copied_from`. |

Import copies rather than links on purpose: a *shared* question would let an edit made for one exam change
the answer sheet of a live one and silently re-grade attempts already submitted. Copies preserve each exam's
history, and `usage_count` is how the bank still reports where a question ended up. A question belonging to
another teacher (or a missing id) is refused with a `400` on `question_ids`; the whole import is one
transaction and refreshes the target exam's `total_marks`.

Validation by question type:

- `multiple_choice`: at least two options and exactly one correct option.
- `multiple_answer`: at least two options and at least one correct option.
- `true_false`: exactly two options and exactly one correct option.
- `short_answer`: no options; structured metadata may include non-empty `expected_answers`, boolean `case_sensitive`, positive `max_length`, and `placeholder`.
- `written`: no options; metadata may include positive `max_length`, `placeholder`, and `grading_note`.

Unsupported configuration keys and malformed values are rejected. Student-side automatic grading is documented below; written answers and short answers with no expected-answer rule are left for teacher manual grading (`/results/teacher/attempts/{attempt_id}/answers/{question_id}/grade/`).

### Reorder payload

The complete ordered set is mandatory; it must contain every current question of the exam exactly once.

```json
{
  "question_ids": ["question-uuid-2", "question-uuid-1", "question-uuid-3"]
}
```

The operation executes in a transaction and uses safe temporary ordering to avoid unique-order collisions.

## Student exam API

All routes in this section require an authenticated `student`. Teachers and administrators cannot use these student endpoints. Attempt resources are always filtered to the authenticated student; another student's attempt is returned as `404`.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/student/exams/` | Dashboard-safe list of the caller's upcoming, available, in-progress, or completed exams. |
| `POST` | `/student/exams/{exam_id}/start/` | Start an available exam, or return the existing active attempt for a duplicate request. |
| `GET` | `/student/attempts/{attempt_id}/` | Restore a safe exam session with questions, own answers, flags, and server timing. |
| `PATCH` | `/student/attempts/{attempt_id}/answers/{question_id}/` | Idempotently autosave one answer. |
| `PATCH` | `/student/attempts/{attempt_id}/answers/` | Atomically autosave a validated non-empty batch of answers. |
| `POST` | `/student/attempts/{attempt_id}/flagged-questions/{question_id}/` | Flag a question for review. |
| `DELETE` | `/student/attempts/{attempt_id}/flagged-questions/{question_id}/` | Remove that flag. |
| `POST` | `/student/attempts/{attempt_id}/submit/` | Finalize once, run automatic grading, and return only an eligible safe result. |
| `GET` | `/student/results/{attempt_id}/` | Read a submitted/expired result only when visibility permits it. |

### Availability and start behavior

The API filters out drafts, archives, expired schedule windows, and exams that do not match the student's current profile grade/class. If an exam owner belongs to a school, only students with the same active school membership can see or start it; legacy teachers with no school membership retain the pre-existing grade/class behavior. A scheduled exam is shown as `upcoming` before `start_at`; once its window opens it is startable even if no external scheduler has yet changed its teacher-facing status. Completed exams appear only when the caller has an existing attempt.

### Dashboard item fields

Each item of `GET /student/exams/` carries the facts the student space needs without a second request:

```json
{
  "id": "exam-uuid",
  "title": "Cell biology assessment",
  "duration_minutes": 45,
  "total_marks": "12.00",
  "question_count": 6,
  "max_attempts": 2,
  "attempts_used": 1,
  "passing_percentage": 50.0,
  "result_visibility": "pending",
  "allow_unanswered": false,
  "allow_previous_questions": true,
  "question_layout": "paged",
  "teacher_name": "Sara Mohammadipour",
  "availability": "in_progress",
  "attempt": {
    "id": "attempt-uuid",
    "status": "in_progress",
    "attempt_number": 1,
    "remaining_seconds": 1234,
    "result": null
  }
}
```

`availability` is one of `available`, `upcoming`, `in_progress`, `completed`. `attempt` is the caller's own
most recent attempt and is `null` when there is none; `remaining_seconds` is recomputed from the server clock
so a resumed session shows the time that is actually left. `passing_percentage`, `allow_unanswered`,
`allow_previous_questions`, `question_layout` and `result_visibility` come from the exam settings, which lets
the start screen state the pass mark, the blank-answer rule, the delivery layout and the release policy
before the first attempt — those two rules are stated here precisely because the alternative was the client
guessing them. `teacher_name` is a full name only: no
teacher primary key, email, or settings object appears in a student response, and the in-attempt payload
carries no teacher block at all. `attempt.result` is emitted **only once the teacher has published the result** and contains
`score`, `percentage`, `maximum_score`, `passing_percentage`, `passed`, and `is_final`; `passed` is `null`
while the score is not final or when the teacher left `passing_percentage` at `0`, and `is_final` is `false`
while any response awaits manual grading. Nothing else about the attempt — answers, flags, or keys — is
included.

Start runs in a transaction that locks the exam row. It validates the role, audience, state/window, questions, attempt limit, and one more thing: **at least 60 seconds of usable window**. The window is `min(duration_minutes, exam.end_at - now)`, so a student who opens a closing exam is refused (`400` with `seconds_left`) instead of burning an attempt on an unanswerable paper. A second start request reuses the valid in-progress attempt (`200`) rather than creating a parallel attempt; the first creation returns `201`.

At start, question UUID order is generated by the backend and persisted in `ExamAttempt.question_order`. With `randomize_questions=true`, this order uses server-side randomness once and remains stable for that attempt. Option randomization is intentionally not implemented because there is no current structured option-randomization setting or snapshot field.

### Attempt detail and timer

Attempt detail returns the attempt state, safe exam content, navigation settings (`allow_previous_questions`, `randomize_questions`, `allow_unanswered`, `question_layout`), questions/options, the student's own answers/flags, plus `server_time`, `expires_at`, `remaining_seconds`, `attempt_number`, `attempt_limit`, `answer_revision`, and `answer_frontier` (how far this attempt has written, in its own question order — the *Going back* rule below). Its `exam` block also carries `total_marks`, `question_count`, `passing_percentage`, and `result_visibility` so the review screen can state the pass mark and when the result will appear; `show_correct_answers`, `max_attempts`, and every answer-key field stay out of it on purpose.

**The deadline is a per-attempt snapshot.** `ExamAttempt.expires_at` is fixed at `min(started_at + duration_minutes, exam.end_at)` when the attempt starts, and the timer is computed from it. A teacher who edits `duration_minutes` mid-exam therefore changes nothing for students who are writing — only `POST /exams/{id}/extend/` moves an open attempt's deadline, by exactly the minutes granted, and only for attempts whose deadline has not passed. Attempts created before the column existed fall back to deriving the deadline from the live exam. `POST /exams/{id}/complete/` and `/archive/` set every open attempt's deadline to now, finalize it, and grade the answers it already holds (`409` on later writes) — a closed exam does not leave a window open behind it.

### Write guards: revision and session

Two optional request headers guard student writes. Absent headers mean "no guard", so older clients keep working.

| Header | Meaning |
| --- | --- |
| `X-Exam-Revision` | The `answer_revision` the payload was built from. |
| `X-Exam-Session` | A random id one browser tab holds for the life of the attempt. |

- Any accepted write (answer, batch, or a flag that changed state) advances `answer_revision` inside the same transaction.
- A write carrying a lower revision is refused with `409 {"code": "stale_revision", "answer_revision": n}`, so a retried or queued request cannot land on top of a newer answer. `n` lets the client re-base and resend once.
- A write from a *different* session while the owning session wrote within 45 seconds is refused with `409 {"code": "another_session_active"}`. Reads are never refused, so a second tab can still show the exam.
- One quiet exception: a start request that *reuses* an in-progress attempt moves ownership to the window that asked, because that is the window the student is looking at. The displaced window then sees the conflict on its next write and can claim back.
- A write to an attempt that has been finalized returns `409 {"code": "attempt_finalized"}`.
- On a `paged` attempt whose settings say `allow_previous_questions: false`, a write naming a question below
  `answer_frontier` returns `409 {"code": "question_locked", "question_ids": [...]}`. The refused ids are
  named so a queued flush can drop them, re-read their stored values and resend the rest; a batch is refused
  whole rather than applied in part. Every accepted write moves the frontier to the highest question index it
  touched, and the heartbeat echoes `answer_frontier` so the runner can lock a passed question without a
  full detail read. Flagging a passed question stays allowed — it asks the teacher to look, it does not
  change an answer. The two refusal events (`stale_write_rejected`, `question_locked`) are written after the
  rolled-back transaction, so the teacher's activity list sees them.
- Rejected stale writes and deliberate takeovers are recorded as `AttemptEvent` rows.

| Method | URL | Purpose |
| --- | --- | --- |
| `POST` | `/student/attempts/{id}/heartbeat/` | Clock-only resync: `server_time`, `expires_at`, `remaining_seconds`, `status`, `answer_revision`, `answer_frontier`, `session_locked_by_other`, `question_count`. Also finalizes an expired attempt, and refreshes session ownership. Deliberately tiny — it exists so a class polling once a minute does not each download the whole answer sheet. |
| `POST` | `/student/attempts/{id}/claim-session/` | Explicit takeover: moves the attempt to the caller's `X-Exam-Session`, increments `session_switch_count`, records a signal. Returns the same shape as the heartbeat. |
| `POST` | `/student/attempts/{id}/signals/` | Records one browser-observed signal: `tab_hidden`, `tab_visible`, `disconnected`, `reconnected`. Any other `kind` is a `400`; the server stamps the time and ignores signals after finalization. |

### Going back

`question_layout` and `allow_previous_questions` together decide whether a student may revisit an answer.

| Layout | `allow_previous_questions` | What the student may do |
| --- | --- | --- |
| `single_page` | either | Edit anything on the sheet until submit; the setting is stored and reported, but nothing enforces it because there is no "back" to block. |
| `paged` | `true` | Move freely between questions (`question_index` in the review payload is only a display position). |
| `paged` | `false` | Move forward freely; a question becomes final once a *later* question has an answer written to it. |

`answer_frontier` is the server's record of the last column in that table: the highest index in the attempt's
own `question_order` that an answer has been written to, advanced by every accepted write and echoed by the
heartbeat. It counts written answers only — a flag, a visit or an unanswered skip moves nothing — and it is
measured in the snapshot order, so relabelling indices in a request cannot unlock a passed question. Writing
below it on the last row returns `409 {"code": "question_locked", "question_ids": [...]}`, and the batch
endpoint refuses the whole request rather than saving some of it. Nothing about the rule changes grading,
`question_order`, or which answers are accepted: it restricts when an answer may be written, not what counts
as correct.

### Option order

With `randomize_options`, an attempt snapshots `option_order` — `{question_id: [option ids]}` — at start, and `StudentAttemptQuestionSerializer` emits options in that order for the rest of the attempt's life. It is stable across refresh, reconnect and re-open, and differs per attempt. True/false questions are never reordered (the student's boolean answer maps positionally), and grading always matches option UUIDs, so display order can never change a score. The deadline is server-calculated as the earlier of `started_at + duration_minutes` and exam `end_at` when one exists.

Any request that reads or changes an in-progress attempt independently checks the deadline. On expiry, saved work is retained, the attempt is set to `expired`, `submitted_at` is recorded, automatic grading runs, and later modifications are rejected. Submitting an already-expired attempt returns its existing finalized state safely; work is never discarded.

### Autosave request formats

Choice and true/false questions use option UUIDs. One-choice and true/false answers require exactly one ID; multiple-answer requires one or more. Sending an empty ID array deliberately clears an existing choice answer. Every submitted ID must belong to that question.

```json
{"selected_option_ids": ["option-uuid"]}
```

Short and written answers use text. Empty text clears an answer; configured `max_length` is enforced.

```json
{"text": "Mitochondrion"}
```

For batch autosave, each item has a question ID plus one of the shapes above. All items are validated before database changes; any item error rolls the batch back.

```json
{
  "answers": [
    {"question_id": "question-uuid-1", "selected_option_ids": ["option-uuid-1"]},
    {"question_id": "question-uuid-2", "text": "A short response"}
  ]
}
```

### Submission, grading, and visibility

Submission is idempotent: repeated requests do not create a second result or change an already final state. `{"trigger": "auto"}` in the body only labels the activity log entry (a submission the timer forced), it never changes what is graded. When `allow_unanswered` is `false`, submit answers `400` on `answers` while any question of the attempt's own snapshot is blank. Multiple choice, multiple answer, and true/false use exact selection matching. Multiple-answer is deliberately **full-credit only**: the selected option set must exactly equal the correct set. Short answers are automatically graded only when the existing structured `expected_answers` configuration is present, using trimmed exact matching and optional case sensitivity. Written answers, and short answers without expected answers, are counted as pending manual grading rather than incorrect.

The persisted snapshot reports automatic `score`, aggregate correct/incorrect/unanswered counts, pending manual count, and percentage only when no manual grading remains. It also reports `maximum_score`, `attempt_number`, `submitted_at`, `passing_percentage`, and the derived `passed` verdict (`null` when the percentage is not final or no pass mark is configured). It never returns question answer keys. `result_visibility` is enforced as follows:

- `immediate` → safe result is published and returned.
- `pending` → result is stored as pending and not visible to the student.
- `hidden` → result is stored as hidden and not visible to the student.

`ExamResult.maximum_score` is the total this attempt was graded against, frozen at grading time, so a later re-weighting of questions cannot contradict a result a student has already read; the read endpoints report it rather than the live `exam.total_marks`. `manual_grading_count` is how many answers needed the teacher's pen, which makes "17 of 24 graded" computable without walking answers. Re-grading a published result keeps it published (`revised_at` is stamped); publication is only ever reversed on purpose.

`show_correct_answers` is deliberately **not used by any student API in this release**. Even for immediate results, no response contains `is_correct`, correct option IDs, expected answers, explanations, question configuration, or teacher-only settings. This conservative rule is intentional until a separate reviewed product policy for post-exam answer review is implemented.

## Teacher grading and participation API

Teacher and administrator accounts can access reporting only for the teacher-owned exams (an administrator receives the system-wide view). These endpoints are intentionally separate from the student API: they may reveal a student's submitted response to the owning teacher, but never broaden what a student can read.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/results/teacher/overview/` | Aggregate dashboard counts and recent attempt activity. |
| `GET` | `/results/teacher/students/` | A school-assigned teacher receives the same-school student roster (including no-attempt students); legacy teachers receive actual participants only. |
| `GET` | `/results/teacher/exams/{exam_id}/` | Aggregate per-attempt class results for one owned exam. Optional `?submission_status=submitted\|needs_grading\|in_progress` filters server-side. |
| `GET` | `/results/teacher/grading-queue/` | Finalized attempts with answers still waiting, teacher-wide, least-finished first. Optional `exam_id`, `student_id`. |
| `GET` | `/results/teacher/exams/{exam_id}/grading/` | Marking board: every question with cohort tallies and how many manual marks are still open. |
| `GET` | `/results/teacher/exams/{exam_id}/grading/{question_id}/` | One question answered by every finalized attempt, with the answer key and rubric alongside it. |
| `POST` | `/results/teacher/exams/{exam_id}/grading/{question_id}/` | Save a whole marking screen at once, in one transaction. |
| `GET` | `/results/teacher/attempts/{attempt_id}/` | Teacher-only submitted text/choice response detail. Every answer carries `awarded_score` and `verdict` (`unanswered\|correct\|incorrect\|pending\|manual`) so an auto-graded row can be shown with its mark instead of being hidden. |
| `PATCH` | `/results/teacher/attempts/{attempt_id}/answers/{question_id}/grade/` | Grade a submitted short/written answer. |
| `PATCH` | `/results/teacher/attempts/{attempt_id}/feedback/` | Save the aggregate feedback string for the result. |
| `POST` | `/results/teacher/exams/{exam_id}/publish/` | Publish all fully graded pending/hidden results for that exam. |

A queue row is `{"attempt_id", "attempt_number", "student_id", "student_name", "exam_id", "exam_title", "submitted_at", "graded_count", "manual_count", "open_count", "progress", "result_status"}`; the counts come from the grading snapshot, so clearing the queue does not need one request per attempt. `GET /results/teacher/overview/` now returns `completion_rate`, `average_percentage`, `average_score`, `graded_result_count`, `verdict_count`, `passed_count`, `pass_rate`, `pending_manual_answer_count`, `manual_answer_count` and `recently_completed_exams` alongside the previous counts — every one a database aggregate, because the dashboard's progress bar used to be drawn from `20 + participant_count * 10`.

The board returns `{exam, attempt_count, questions[], progress{total, graded, percent}}`; each question row carries `requires_manual_grading`, the answered/blank/correct/incorrect counts, `graded_count` and `pending_count` for the manual marks still open, `average_score` (null while the question has anything pending) and `is_complete`. A keyed question is complete by definition; a manual one is complete when every row has a mark. The question page returns `{exam, question, progress{index,total,questions}, stats, rows[]}`, where `question` includes the teacher-only key (`correct_option_ids`, `expected_answers`, `explanation`, `grading_notes`) and each row is `{attempt_id, attempt_number, student_name, grade, class_name, submitted_at, answer_id, selected_option_ids, selected_option_texts, text, is_flagged, awarded_score, verdict, manual_score, feedback, editable}`. `editable` is false on a keyed question: those rows are shown to be read, not typed over, and a `POST` against such a question is refused with `400 {"detail": {"question": [...]}}`.

A cohort save takes `{"grades": [{"attempt_id": ..., "mark": 3.5, "feedback": "..."}]}`. `mark` must be a number — clearing a previously saved mark is not what this screen is for — and is validated against the question's weight. Rows must belong to a finalized attempt of this exam, and the request is rejected as a whole (`400`, with `detail.rows[]` naming the `index`, `attempt_id` and `error` for each bad row) rather than applying the good half; more than 500 rows in one request is refused outright. A successful save re-grades each touched attempt, sends the grading-completed notification through the same helper the single-answer `PATCH` uses, and answers with `{saved, results[], stats, questions, progress, rows}` so the screen can update without a second fetch.

`GET /results/teacher/attempts/{attempt_id}/` also returns `attempt_number`, `server_time`, `remaining_seconds` (for an attempt still in progress), `session_switch_count` and `session_signals`. Signals are observations for a human, not a verdict: nothing in the platform changes a score because of them.

Manual grading accepts a score between zero and the question marks plus optional response feedback:

```json
{"manual_score": 4.0, "feedback": "Strong reasoning; add one example."}
```

Only finalized written answers and short answers without an automatic expected-answer rule can be manually graded. Regrading recalculates the persisted result snapshot. A pending/hidden result is student-visible only after the publish endpoint is used; rows with unresolved manual responses are deliberately left unpublished.

## Notifications API

In-app only: no email, push, worker or socket is involved, and rows are created inside the transaction of the transition they describe (a rolled-back publish leaves no ghost notification).

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/notifications/` | The caller's rows plus `unread_count`. Filters: `unread_only`, `limit` (1-100, default 30). |
| `GET` | `/notifications/unread-count/` | Badge count only. |
| `POST` | `/notifications/{id}/read/` | Mark one read; another user's row is `404`. |
| `POST` | `/notifications/read-all/` | Mark every unread row of the caller read. |

Kinds: `exam_published`, `exam_started`, `exam_ended`, `grading_required`, `grading_completed`, `result_published`. Recipients are resolved with the same audience rule the student dashboard uses (school membership first, then the grade/class pair), so a publish notifies exactly the students who could sit the exam. Repeating an event is a no-op: each row carries a `dedupe_key` (`<kind>:<exam id>` or `<kind>:<attempt id>`) with a partial unique constraint per recipient, and the bulk insert ignores conflicts.

## Organization administration API

All routes below require the `admin` role. They are a real management surface, not a replacement for Django's superuser administration.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/admin/schools/` | List schools with user/exam counts, or create one. |
| `PATCH` | `/admin/schools/{school_id}/` | Change a school name, city, or active status. Join codes are server-generated/read-only. |
| `GET`, `POST` | `/admin/users/` | List/filter all accounts, or provision an account and optional school/profile. |
| `PATCH` | `/admin/users/{user_id}/` | Change names, role, active status, password, school membership, and role-appropriate profile. |
| `GET` | `/admin/overview/` | Real counts plus recent user/exam summaries. |
| `GET` | `/admin/exams/` | Network-wide, read-only exam monitoring including owner, school, questions, and participants. |

School deletion is deliberately absent because memberships are protected. Deactivation prevents public code-based joins and new administrative assignments while retaining historical relationships. Each user has at most one membership. Administrators cannot remove their own admin role or deactivate their own account. User list filters are `search`, `role`, and `school_id`.

An `admin/users` create request uses `email`, `password` (minimum 8 characters), optional names/`role`/`is_active`/`school_id`, and role-specific `student_profile: { grade, class_name }` or `teacher_profile: { department }`. Updates accept the same mutable fields (email is intentionally immutable) and an optional new password.

## Rate limits and hardening

Throttling uses the LocMem cache and is opted in per view through `throttle_scope`; nothing else pays for a cache round-trip.

| Scope | Default | Keyed by |
| --- | --- | --- |
| `login` | `12/min` | source IP + the email in the body |
| `register` | `8/hour` | source IP |
| `password_reset` | `5/hour` | source IP + the email in the body |
| `exam_write` | `240/min` | source IP (student answer/flag/submit/start routes) |

Every rate is an environment override (`DJANGO_THROTTLE_LOGIN`, `DJANGO_THROTTLE_REGISTER`, `DJANGO_THROTTLE_PASSWORD_RESET`, `DJANGO_THROTTLE_EXAM_WRITE`); an empty value disables that scope. Keying login by IP *and* account is what makes credential stuffing cost the attacker while one shared school NAT address cannot lock out a whole class. A throttled answer write is a `429`, and the client keeps the pending queue and retries rather than dropping the edit.

Also fixed in this pass: `CORS_ALLOW_CREDENTIALS` is off (bearer headers need no ambient credentials), `PASSWORD_RESET_TIMEOUT` is three hours instead of Django's three days, and outside `DEBUG` the settings module turns on HSTS, `SECURE_SSL_REDIRECT`, `SECURE_CONTENT_TYPE_NOSNIFF`, `X_FRAME_OPTIONS=DENY` and secure session/CSRF cookies. `DJANGO_ALLOWED_HOSTS` remains the only way to add a host.

### Database invariants

Enforced in the schema, not only in Python:

- `unique_exam_student_attempt_number` — one row per attempt number, so a duplicate start cannot create a second one.
- `attempt_number_positive`, `exam_duration_positive`, `question_order_positive`, `question_marks_non_negative`, `option_order_positive` — non-negative/positive columns.
- `exam_end_after_start` — `end_at > start_at` whenever both exist.
- `score_within_maximum` — a result's score never exceeds its frozen `maximum_score`.
- `unique_tag_name_per_teacher` — tags are lowercased for comparison and scoped to one teacher.
- `StudentAnswer.question` and `ExamAttempt.exam`/`.student` are `PROTECT`; deleting graded content is refused rather than cascading.

`manage.py close_overdue_exams` is the scheduler-free way to move exams whose window has closed into `completed` (and finalize their open attempts); the teacher exam list runs the same idempotent transition for its own scope, so a cron entry is an optimization, not a requirement.

## Intentionally absent

Live WebSocket updates, Redis/Celery processing, advanced anti-cheating, AI monitoring, screen recording, and advanced analytics remain outside this API. Deliberately absent after review, because they would create contradictory behaviour rather than capability: `show_score` and `show_teacher_feedback` toggles (result visibility already governs whether a student sees a published result at all, and per-field switches would let a "published" result hide the number it publishes), and an `autosubmit_at_timeout` switch (an expired attempt is always finalized and graded so no saved work is lost; the client's automatic submit is a convenience on top of that). Option-level randomization and the reusable bank, by contrast, shipped in this round. There is also no post-submission answer-review endpoint: after `submit`, a student sees aggregated marks and the pass verdict, never per-question correctness or the answer key. `show_correct_answers` remains a stored, teacher-editable setting that no student route reads yet. The platform provides authenticated exam delivery, autosave, result retrieval, manual text grading, controlled publication, school management, user management, and CSV export.
