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
    "randomize_questions": false,
    "result_visibility": "pending",
    "show_correct_answers": false,
    "max_attempts": 1
  }
}
```

`settings` may be omitted or partially supplied on `PATCH`. Durations must be positive; an end time requires a start time and must follow it. `teacher`, `status`, `status_before_archive`, and `total_marks` are server-controlled and rejected in normal create/update payloads.

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

Validation by question type:

- `multiple_choice`: at least two options and exactly one correct option.
- `multiple_answer`: at least two options and at least one correct option.
- `true_false`: exactly two options and exactly one correct option.
- `short_answer`: no options; structured metadata may include non-empty `expected_answers`, boolean `case_sensitive`, positive `max_length`, and `placeholder`.
- `written`: no options; metadata may include positive `max_length`, `placeholder`, and `grading_note`.

Unsupported configuration keys and malformed values are rejected. Student-side automatic grading is documented below; teacher manual grading remains deferred.

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

Start runs in a transaction. It validates the role, audience, state/window, questions, and attempt limit. A second start request reuses the valid in-progress attempt (`200`) rather than creating a parallel attempt; the first creation returns `201`.

At start, question UUID order is generated by the backend and persisted in `ExamAttempt.question_order`. With `randomize_questions=true`, this order uses server-side randomness once and remains stable for that attempt. Option randomization is intentionally not implemented because there is no current structured option-randomization setting or snapshot field.

### Attempt detail and timer

Attempt detail returns the attempt state, safe exam content, navigation-only settings (`allow_previous_questions`, `randomize_questions`), questions/options, the student's own answers/flags, plus `server_time`, `expires_at`, and `remaining_seconds`. The deadline is server-calculated as the earlier of `started_at + duration_minutes` and exam `end_at` when one exists.

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

Submission is idempotent: repeated requests do not create a second result or change an already final state. Multiple choice, multiple answer, and true/false use exact selection matching. Multiple-answer is deliberately **full-credit only**: the selected option set must exactly equal the correct set. Short answers are automatically graded only when the existing structured `expected_answers` configuration is present, using trimmed exact matching and optional case sensitivity. Written answers, and short answers without expected answers, are counted as pending manual grading rather than incorrect.

The persisted snapshot reports automatic `score`, aggregate correct/incorrect/unanswered counts, pending manual count, and percentage only when no manual grading remains. It never returns question answer keys. `result_visibility` is enforced as follows:

- `immediate` → safe result is published and returned.
- `pending` → result is stored as pending and not visible to the student.
- `hidden` → result is stored as hidden and not visible to the student.

`show_correct_answers` is deliberately **not used by any student API in this release**. Even for immediate results, no response contains `is_correct`, correct option IDs, expected answers, explanations, question configuration, or teacher-only settings. This conservative rule is intentional until a separate reviewed product policy for post-exam answer review is implemented.

## Teacher grading and participation API

Teacher and administrator accounts can access reporting only for the teacher-owned exams (an administrator receives the system-wide view). These endpoints are intentionally separate from the student API: they may reveal a student's submitted response to the owning teacher, but never broaden what a student can read.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/results/teacher/overview/` | Aggregate dashboard counts and recent attempt activity. |
| `GET` | `/results/teacher/students/` | A school-assigned teacher receives the same-school student roster (including no-attempt students); legacy teachers receive actual participants only. |
| `GET` | `/results/teacher/exams/{exam_id}/` | Aggregate per-attempt class results for one owned exam. |
| `GET` | `/results/teacher/attempts/{attempt_id}/` | Teacher-only submitted text/choice response detail. |
| `PATCH` | `/results/teacher/attempts/{attempt_id}/answers/{question_id}/grade/` | Grade a submitted short/written answer. |
| `PATCH` | `/results/teacher/attempts/{attempt_id}/feedback/` | Save the aggregate feedback string for the result. |
| `POST` | `/results/teacher/exams/{exam_id}/publish/` | Publish all fully graded pending/hidden results for that exam. |

Manual grading accepts a score between zero and the question marks plus optional response feedback:

```json
{"manual_score": 4.0, "feedback": "Strong reasoning; add one example."}
```

Only finalized written answers and short answers without an automatic expected-answer rule can be manually graded. Regrading recalculates the persisted result snapshot. A pending/hidden result is student-visible only after the publish endpoint is used; rows with unresolved manual responses are deliberately left unpublished.

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

## Intentionally absent

Live WebSocket updates, Redis/Celery processing, advanced anti-cheating, AI monitoring, screen recording, and advanced analytics remain outside this API. The platform provides authenticated exam delivery, autosave, result retrieval, manual text grading, controlled publication, school management, user management, and CSV export.
