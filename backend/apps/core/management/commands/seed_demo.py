"""Create a small, believable school so the interface can be tried without inventing data by hand.

Development only. The command refuses to run with `DEBUG=False`, because a known password on a real
deployment is not a convenience — it is an open door.

Everything is idempotent: running it twice updates the same rows instead of failing on the unique
constraints, so it is safe to reach for after a `migrate` on a fresh clone.

    python manage.py seed_demo
    python manage.py seed_demo --no-exams        # accounts and groups only

The exam set is deliberately shaped so every state the student dashboard can show is on screen at once:
one attempt left half-finished, one exam open now, one scheduled for later, two with published results and
one handed in but not yet marked. Seeding only accounts leaves the dashboard empty, which tells you nothing
about whether it works.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.attempts.models import ExamAttempt, StudentAnswer
from apps.attempts.services import _grade_attempt, start_attempt
from apps.exams.models import Exam, ExamSettings, Question, QuestionOption
from apps.exams.services import publish_exam, refresh_question_hashes, refresh_total_marks
from apps.organizations.models import School, SchoolMembership
from apps.users.models import StudentGroup, User

SCHOOL_NAME = "دبیرستان نمونهٔ بررسی"
PASSWORD = "Examora1234!"

FIRST_NAMES = ["سارا", "امیرعلی", "نگار", "محمدحسین", "ریحانه", "ابوالفضل", "مریم", "یاسین", "زهرا", "آرش", "هانیه", "سینا"]
LAST_NAMES = ["احمدی", "رضایی", "کریمی", "موسوی", "صادقی", "جعفری", "حسینی", "نوری", "قاسمی", "رحیمی", "طاهری", "مرادی"]
CLASSES = [("پایه دوازدهم", "تجربی ۱"), ("پایه دوازدهم", "تجربی ۲")]

MARKS_PER_QUESTION = Decimal("4.00")

# text, four options, index of the correct one
QUESTION_BANKS: dict[str, list[tuple[str, list[str], int]]] = {
    "زیست‌شناسی": [
        ("کدام اندامک یاخته مسئول تولید بیش‌تر ATP است؟", ["میتوکندری", "ریبوزوم", "دستگاه گلژی", "لیزوزوم"], 0),
        ("فرایند رونویسی از روی DNA در کدام بخش یاخته انجام می‌شود؟", ["سیتوپلاسم", "هسته", "غشای یاخته", "تاژک"], 1),
        ("انتقال آب و مواد معدنی در گیاه بر عهدهٔ کدام بافت است؟", ["آبکش", "پوستک", "چوب", "مریستم"], 2),
        ("واحد ساختاری و عملی دستگاه عصبی کدام است؟", ["نفریت", "نورون", "آلوئول", "سارکومر"], 1),
        ("کدام گزینه از ویژگی‌های بافت پوششی است؟", ["سلول‌های درشت و پراکنده", "میان‌بافت فراوان", "رگ‌های خونی متعدد", "پیوستگی زیاد سلول‌ها"], 3),
    ],
    "شیمی": [
        ("نماد شیمیایی عنصر سدیم کدام است؟", ["S", "Si", "Na", "Sn"], 2),
        ("کدام ترکیب یک اسید قوی به شمار می‌آید؟", ["HCl", "CH₃COOH", "H₂CO₃", "NH₃"], 0),
        ("عدد اتمی کربن چند است؟", ["۸", "۶", "۱۲", "۱۴"], 1),
        ("عناصر یک دوره در جدول تناوبی در چه چیزی مشترک‌اند؟", ["تعداد الکترون ظرفیت", "شعاع اتمی", "تعداد لایه‌های الکترونی", "عدد جرمی"], 2),
        ("پیوند میان اتم‌های یک مولکول آب از چه نوعی است؟", ["یونی", "کووالانسی قطبی", "فلزی", "هیدروژنی"], 1),
    ],
    "فیزیک": [
        ("واحد SI نیرو کدام است؟", ["ژول", "وات", "نیوتن", "پاسکال"], 2),
        ("شتاب گرانش در سطح زمین تقریباً چقدر است؟", ["۹٫۸ متر بر مجذور ثانیه", "۶٫۷ متر بر مجذور ثانیه", "۱۰٫۵ متر بر مجذور ثانیه", "۳٫۷ متر بر مجطور ثانیه"], 0),
        ("در حرکت یکنواخت روی خط راست، کدام کمیت ثابت می‌ماند؟", ["تندی", "شتاب", "جابه‌جایی", "زمان"], 0),
        ("قانون دوم نیوتن کدام رابطه را بیان می‌کند؟", ["E=mc²", "F=ma", "V=IR", "P=F/A"], 1),
        ("واحد انرژی در دستگاه SI کدام است؟", ["کالری", "نیوتن", "ژول", "وات"], 2),
    ],
    "ریاضی": [
        ("حد «سینوس ایکس تقسیم بر ایکس» وقتی ایکس به صفر میل کند، چند است؟", ["صفر", "یک", "بی‌نهایت", "تعریف نشده"], 1),
        ("مشتق تابع «ایکس به توان سه» کدام است؟", ["سه ایکس به توان دو", "ایکس به توان دو", "سه ایکس", "ایکس به توان چهار تقسیم بر چهار"], 0),
        ("تابع «یک تقسیم بر ایکس» در نقطهٔ صفر چگونه است؟", ["پیوسته است", "مشتق‌پذیر است", "تعریف نشده و پیوسته نیست", "صفر می‌شود"], 2),
        ("مجموع اعداد ۱ تا ۱۰۰ برابر است با:", ["۵۰۰۰", "۱۰۱۰۰", "۵۰۵۰", "۱۰۰۰۰"], 2),
        ("دامنهٔ تابع رادیکالی «جذر ایکس» کدام است؟", ["ایکس بزرگ‌تر یا مساوی صفر", "همهٔ اعداد حقیقی", "ایکس بزرگ‌تر از یک", "ایکس مخالف صفر"], 0),
    ],
    "ادبیات فارسی": [
        ("در جملهٔ «باد بهاری وزید»، نقش واژهٔ «باد» چیست؟", ["نهاد", "مفعول", "متمم", "قید"], 0),
        ("آرایهٔ تشبیه در کدام گزینه آمده است؟", ["هوا سرد شد", "قدش چون سرو بود", "کتاب را خواندم", "آمد و رفت"], 1),
        ("مترادف واژهٔ «فراوان» کدام است؟", ["اندک", "تهی", "دور", "بسیار"], 3),
        ("در جملهٔ «دانش‌آموزان آزمودند»، فاعل کدام است؟", ["آزمودند", "دانش‌آموزان", "هر دو", "هیچ‌کدام"], 1),
        ("ضرب‌المثل‌ها به کدام قلمرو زبانی تعلق دارند؟", ["ادب عامه", "متن حقوقی", "متن علمی", "گزارش خبری"], 0),
    ],
}

# Each entry: the exam, its window relative to now, who answered what, and how much of it is published.
# `answered` maps the student's 1-based number to how many of the five questions they got right, so a target
# percentage is an exact multiple of twenty rather than a rounded guess.
EXAM_SPECS: list[dict] = [
    {
        "title": "آزمون میان‌نوبت زیست‌شناسی",
        "subject": "زیست‌شناسی",
        "description": "فصل ۱ و ۲ — یاخته، بافت‌ها و اندامک‌ها",
        "start_hours": -240, "end_hours": -236, "duration": 45, "passing": 50,
        "visibility": "immediate", "answered": {1: 4, 2: 3, 3: 5, 4: 2, 5: 4, 6: 5, 7: 3, 8: 4},
    },
    {
        "title": "آزمون فصل دوم شیمی",
        "subject": "شیمی",
        "description": "ساختار اتم و جدول تناوبی",
        "start_hours": -120, "end_hours": -116, "duration": 40, "passing": 50,
        "visibility": "immediate", "answered": {1: 3, 2: 5, 3: 4, 4: 3, 5: 5, 6: 2, 9: 4, 10: 5},
    },
    {
        "title": "کوئیز هفتهٔ سوم فیزیک",
        "subject": "فیزیک",
        "description": "حرکت‌شناسی و قوانین نیوتن — تحویل شده، منتظر انتشار نمره",
        "start_hours": -48, "end_hours": -45, "duration": 25, "passing": 50,
        "visibility": "pending", "answered": {1: 4, 2: 2, 3: 5, 4: 3, 5: 4, 6: 3, 7: 5, 11: 2, 12: 4},
    },
    {
        "title": "آزمون ریاضی — حد و پیوستگی",
        "subject": "ریاضی",
        "description": "در حال برگزاری؛ یک دانش‌آموز جلسهٔ نیمه‌تمام دارد",
        "start_hours": -1, "end_hours": 6, "duration": 50, "passing": 50,
        "visibility": "immediate", "publish": True, "in_progress_for": [1, 3],
    },
    {
        "title": "آزمون ادبیات فارسی — دستور زبان",
        "subject": "ادبیات فارسی",
        "description": "نقش‌نماهای دستوری و آرایه‌های ادبی",
        "start_hours": 72, "end_hours": 96, "duration": 45, "passing": 60,
        "visibility": "immediate", "publish": True,
    },
    {
        "title": "پیش‌نویس: آزمون زیست فصل ۴",
        "subject": "زیست‌شناسی",
        "description": "هنوز منتشر نشده و فقط در پنل آموزگار دیده می‌شود",
        "start_hours": 240, "end_hours": 244, "duration": 45, "passing": 50,
        "visibility": "pending", "draft": True,
    },
]


class Command(BaseCommand):
    help = "Create a demo school with one teacher, one administrator, a class of students, and a term of exams."

    def add_arguments(self, parser) -> None:  # type: ignore[no-untyped-def]
        parser.add_argument("--students", type=int, default=len(FIRST_NAMES), help="How many students to create.")
        parser.add_argument("--no-exams", action="store_true", help="Create accounts and groups only.")

    @transaction.atomic
    def handle(self, *args, **options) -> None:  # type: ignore[no-untyped-def]
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=true; it creates accounts with known passwords.")

        count = max(1, min(int(options["students"]), len(FIRST_NAMES)))
        school, _ = School.objects.get_or_create(name=SCHOOL_NAME, defaults={"city": "تهران"})

        admin = self._account("admin@examora.test", "مدیر", "سامانه", User.Role.ADMIN, is_staff=True)
        teacher = self._account("teacher@examora.test", "الهام", "برقشهر", User.Role.TEACHER)
        for user in (admin, teacher):
            SchoolMembership.objects.get_or_create(user=user, defaults={"school": school})

        students: list[User] = []
        for index in range(count):
            first, last = FIRST_NAMES[index], LAST_NAMES[index]
            grade, class_name = CLASSES[index % len(CLASSES)]
            student = self._account(f"student{index + 1}@examora.test", first, last, User.Role.STUDENT)
            SchoolMembership.objects.get_or_create(user=student, defaults={"school": school})
            profile = getattr(student, "student_profile", None)
            if profile is not None and (profile.grade != grade or profile.class_name != class_name):
                profile.grade = grade
                profile.class_name = class_name
                profile.save(update_fields=("grade", "class_name", "updated_at"))
            students.append(student)

        # Two overlapping-by-class groups, so the audience step has something to show and the union count is
        # visibly smaller than the sum of the two.
        half = max(1, len(students) // 2)
        groups = [
            ("تجربی ۲ — گروه الف", "دانش‌آموزانی که آزمون تکمیلی می‌دهند.", students[:half]),
            ("کلاس جبرانی", "برای کسانی که جلسهٔ قبل غایب بودند.", students[half - 1 : half + 2]),
        ]
        created_groups: list[StudentGroup] = []
        for name, description, members in groups:
            # A manual get-or-create: `get_or_create` would pass the `name__iexact` lookup to the constructor,
            # and the uniqueness rule here is case-insensitive per teacher, not an exact string match.
            group = StudentGroup.objects.filter(teacher=teacher, name__iexact=name).first()
            if group is None:
                group = StudentGroup.objects.create(teacher=teacher, name=name, description=description)
            group.students.set(members)
            created_groups.append(group)

        self.stdout.write(self.style.SUCCESS(f"مدرسهٔ «{school.name}» آماده است."))
        self.stdout.write("")
        self.stdout.write(f"  مدیر:    admin@examora.test    / {PASSWORD}")
        self.stdout.write(f"  آموزگار: teacher@examora.test  / {PASSWORD}")
        self.stdout.write(f"  دانش‌آموز: student1@examora.test … student{count}@examora.test / {PASSWORD}")
        self.stdout.write("")
        self.stdout.write(f"  {len(groups)} گروه با {sum(len(members) for _, _, members in groups)} عضویت ساخته شد.")

        if options["no_exams"]:
            return

        # Students nobody put in a group still get the exams directly, which exercises both halves of the
        # audience rule in one dataset.
        grouped = {student.id for group in created_groups for student in group.students.all()}
        direct = [student for student in students if student.id not in grouped]

        created = 0
        for spec in EXAM_SPECS:
            exam = self._exam(teacher, spec, created_groups, direct)
            self._populate(exam, spec, students)
            created += 1

        self.stdout.write("")
        self.stdout.write(f"  {created} آزمون با {ExamAttempt.objects.filter(exam__teacher=teacher).count()} تلاش ثبت شد.")
        self.stdout.write("  student1 یک آزمون نیمه‌تمام دارد؛ بقیه دو نتیجهٔ منتشرشده و یک آزمون منتظر نمره می‌بینند.")

    # ---------------------------------------------------------------- exams

    def _exam(self, teacher: User, spec: dict, groups: list[StudentGroup], direct: list[User]) -> Exam:
        now = timezone.now()
        start_at = now + timedelta(hours=spec["start_hours"])
        end_at = now + timedelta(hours=spec["end_hours"])
        defaults = {
            "description": spec["description"],
            "subject": spec["subject"],
            "grade": CLASSES[0][0],
            "class_name": "",
            "audience_mode": Exam.AudienceMode.SELECTED,
            "teacher": teacher,
            "duration_minutes": spec["duration"],
            "start_at": start_at,
            "end_at": end_at,
            "instructions": "به همهٔ سؤال‌ها پاسخ دهید؛ پاسخ‌ها به‌صورت خودکار ذخیره می‌شوند.",
        }
        exam, fresh = Exam.objects.get_or_create(title=spec["title"], teacher=teacher, defaults=defaults)
        if not fresh:
            # Re-running must move a stale demo window forward; an exam that ended last week teaches nobody
            # anything about the live states, and `publish_exam` refuses a window that has already closed.
            for field, value in defaults.items():
                setattr(exam, field, value)
            exam.save()
        exam.student_groups.set(groups)
        exam.students.set(direct)

        exam_settings, _ = ExamSettings.objects.get_or_create(exam=exam)
        exam_settings.result_visibility = spec["visibility"]
        exam_settings.passing_percentage = Decimal(spec["passing"])
        exam_settings.max_attempts = 1
        exam_settings.allow_unanswered = True
        exam_settings.question_layout = "paged"
        exam_settings.show_correct_answers = spec["visibility"] == "immediate"
        exam_settings.save()
        # `Exam.post_save` already created a settings row, and the reverse one-to-one descriptor caches the
        # instance it first saw. Without re-pointing it, `_grade_attempt` reads `attempt.exam.settings` and
        # gets the pre-update copy — every result comes out unpublished even though the row in the database
        # says otherwise. Assigning through the same accessor the grader uses is what keeps them identical.
        exam.settings = exam_settings

        if not exam.questions.exists():
            for order, (text, options, correct) in enumerate(QUESTION_BANKS[spec["subject"]], start=1):
                question = Question.objects.create(
                    exam=exam, owner=teacher, type=Question.Type.MULTIPLE_CHOICE, text=text, order=order,
                    marks=MARKS_PER_QUESTION, status=Question.Status.READY, difficulty=Question.Difficulty.MEDIUM,
                )
                for position, option_text in enumerate(options, start=1):
                    QuestionOption.objects.create(
                        question=question, text=option_text, order=position, is_correct=(position - 1 == correct),
                    )
            refresh_question_hashes(exam)
        refresh_total_marks(exam)

        if spec.get("draft"):
            exam.status = Exam.Status.DRAFT
            exam.save(update_fields=("status", "updated_at"))
        elif spec.get("publish"):
            # The real gate, so the demo cannot drift out of step with what publishing actually requires —
            # and it fires the audience notification, which gives the bell something to show.
            if exam.status in {Exam.Status.DRAFT, Exam.Status.SCHEDULED}:
                exam = publish_exam(exam.id)
        else:
            # A window that has already closed cannot be published; a finished exam is set directly.
            exam.status = Exam.Status.COMPLETED
            exam.save(update_fields=("status", "updated_at"))
        return exam

    def _populate(self, exam: Exam, spec: dict, students: list[User]) -> None:
        by_number = {index + 1: student for index, student in enumerate(students)}

        for number, correct_count in (spec.get("answered") or {}).items():
            student = by_number.get(number)
            if student is None:
                continue
            if ExamAttempt.objects.filter(exam=exam, student=student).exists():
                continue
            started = exam.start_at + timedelta(minutes=2 * number)
            submitted = started + timedelta(minutes=exam.duration_minutes - 5)
            attempt = ExamAttempt.objects.create(
                exam=exam, student=student, attempt_number=1, status=ExamAttempt.Status.SUBMITTED,
                started_at=started, submitted_at=submitted, last_activity_at=submitted,
                question_order=[str(question.id) for question in exam.questions.order_by("order")],
                expires_at=submitted,
            )
            self._answer_sheets(exam, attempt, correct_count)
            # The grading service is private to the attempts app, but it is the same function the submit path
            # and the teacher's marking desk call; re-implementing it here would let the demo disagree with
            # the real mark.
            _grade_attempt(attempt, finalized_at=submitted)

        for number in (spec.get("in_progress_for") or []):
            student = by_number.get(number)
            if student is None or ExamAttempt.objects.filter(exam=exam, student=student).exists():
                continue
            attempt, _ = start_attempt(exam.id, student, client_session="seed-demo", user_agent="seed_demo")
            # Two questions in, so the session looks like something a person was actually doing.
            self._answer_sheets(exam, attempt, 2, limit=2)

    def _answer_sheets(self, exam: Exam, attempt: ExamAttempt, correct_count: int, *, limit: int | None = None) -> None:
        questions = list(exam.questions.prefetch_related("options").order_by("order"))
        if limit is not None:
            questions = questions[:limit]
        for index, question in enumerate(questions):
            options = list(question.options.order_by("order"))
            answer = StudentAnswer.objects.create(attempt=attempt, question=question, answer_data={})
            chosen = next((option for option in options if option.is_correct), None)
            # Every second question beyond the target is answered wrongly rather than left blank, so the
            # sheet has incorrect rows as well as correct ones.
            if chosen is not None and index < correct_count:
                answer.selected_options.set([chosen])
            elif options:
                wrong = next((option for option in options if not option.is_correct), None)
                if wrong is not None:
                    answer.selected_options.set([wrong])

    # ---------------------------------------------------------------- accounts

    @staticmethod
    def _account(email: str, first_name: str, last_name: str, role: str, *, is_staff: bool = False) -> User:
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            user = User.objects.create_user(
                email=email, password=PASSWORD, first_name=first_name, last_name=last_name, role=role, is_staff=is_staff
            )
        else:
            # Re-running the command must not lock anybody out of a demo they are in the middle of.
            user.set_password(PASSWORD)
            user.first_name = first_name
            user.last_name = last_name
            user.role = role
            user.is_staff = is_staff
            user.is_active = True
            user.save()
        return user
