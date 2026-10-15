# Examora — برنامهٔ کار (مهر ۱۴۰۵)

وضعیت پایه: بک‌اند **بیشتر زیرساخت را داشت**؛ رابط کاربری‌اش ساخته نشده بود.
**هر ۸ خواسته انجام شده و تست شده است.** ✅

| # | خواسته | بک‌اند | فرانت | وضعیت |
|---|---|---|---|---|
| ۱ | گروه‌بندی دانش‌آموزان | ✅ `StudentGroup`, `/users/groups/` | ✅ `/teacher/groups` | **انجام شد** |
| ۲ | معلم تعیین کند چه کسی آزمون بدهد | ✅ `audience_mode`, `student_groups`, `students` | ✅ گام «مخاطبان» | **انجام شد** |
| ۳ | افزودن سؤال ساده‌تر (اول نوع، بعد بقیه) | — | ✅ دیالوگ دوگامی + بخش‌های تاشو | **انجام شد** |
| ۴ | انواع سؤال (۶ نوع) | ✅ | ✅ | **انجام شد** |
| ۵ | عکس در صورت / صورت کاملاً تصویری | ✅ `QuestionMedia`, `image_only` | ✅ `PromptMediaEditor` | **انجام شد** |
| ۶ | پاسخ با عکس/صوت + کنترل سخت‌گیرانه | ✅ `secure_uploads`, `StudentAnswerAttachment` | ✅ ضبط صدا در مرورگر | **انجام شد** |
| ۷ | همه‌چیز آفلاین داخل پروژه | ✅ `backend/.venv` + `requirements.lock` | ✅ `node_modules` + فونت vendor شده | **انجام شد** |
| ۸ | جابه‌جایی فوری بین صفحات | — | ✅ ۱۹ اسکلت + نوار پیشرفت + prefetch | **انجام شد** |

## ترتیب اجرا — همه تمام شد
1. ✅ فونت و آفلاین بودن
2. ✅ صفحهٔ گروه‌ها
3. ✅ گام مخاطبان در آزمون
4. ✅ بازطراحی افزودن سؤال
5. ✅ ضبط صدا و سخت‌گیری رسانه
6. ✅ ناوبری فوری
7. ✅ `npm run verify` + اجرای استک + `next build`

## نتیجهٔ تست‌ها

| بررسی | نتیجه |
|---|---|
| `npx tsc --noEmit` | بدون خطا |
| `npm run lint` | ۰ خطا، ۱ هشدار از قبل موجود (`no-img-element` در `private-media.tsx` — عمدی) |
| `npx vitest run` | **۳۸۹ تست در ۵۰ فایل — پاس** |
| `manage.py test` (بک‌اند کامل) | **۴۴۴ تست — OK** |
| `manage.py check` | تمیز |
| `next build` | ✅ در ۱۷.۹ ثانیه، هر ۲۶ مسیر ساخته شد |

## آنچه اضافه شد (فایل‌های اصلی)

**گروه‌بندی (خواستهٔ ۱)**
- `app/teacher/groups/page.tsx` + `components/teacher/student-groups-workspace.tsx` + `components/teacher/student-picker.tsx`
- `components/layout/navigation.ts` — «گروه‌ها» به سایدبار اضافه شد
- `lib/api/users.ts` + `lib/api/mappers.ts` — `usersApi.studentGroups()` / `studentDirectory()`

**مخاطبان آزمون (خواستهٔ ۲)**
- `components/forms/exam-audience-form.tsx` — دو حالت «بر اساس پروفایل» و «گروه‌ها و دانش‌آموزان انتخابی»
- گام‌های `exam-creator.tsx` از ۵ به ۶ رسید: اطلاعات پایه → تنظیمات → **مخاطبان** → سؤال‌ها → زمان‌بندی → بازبینی
- قانون اجتماع (نه جمع): دانش‌آموزی که در دو گروه انتخاب‌شده است **یک بار** شمرده می‌شود
- `backend/apps/exams/services.py` — درگاه انتشار با پیام فارسی

**افزودن سؤال (خواستهٔ ۳)**
- `components/teacher/question-builder.tsx` بازنویسی شد: `QuestionTypeGrid` → `QuestionFields`
- دو بخش تاشو («پاسخ رسانه‌ای دانش‌آموز» و «راهنما، برچسب و توضیح») که بسته باز می‌شوند و فقط وقتی خودشان باز می‌شوند که چیزی داخلشان باشد
- بازگشت به انتخاب نوع، متن سؤال و نمره و رسانه را **حفظ می‌کند**

**پاسخ صوتی و تصویری (خواستهٔ ۶)**
- `hooks/use-voice-recorder.ts` + بازنویسی `components/exam/answer-media-upload.tsx`
- `backend/apps/core/secure_uploads.py` — شناسایی با magic bytes، نه content-type مرورگر؛ پشتیبانی `ftyp`/MP4 برای Safari
- `backend/apps/core/test_secure_uploads.py` — ۸ تست برای بمب ابعاد، فایل خالی/بیش‌ازحد، SVG، و نام فایل با `../`

**آفلاین (خواستهٔ ۷)**
- `public/fonts/Vazirmatn-var.woff2` (Vazirmatn 33.0.3) + `@font-face` در `app/globals.css` + `preload` در `app/layout.tsx`
- `scripts/dev-stack.mjs`: `NEXT_TELEMETRY_DISABLED=1`، `npm install --prefer-offline --no-audit --no-fund`، `pip install --disable-pip-version-check`
- `backend/apps/core/management/commands/seed_demo.py` — دادهٔ نمونهٔ آفلاین (۱ معلم، ۱۲ دانش‌آموز، ۲ گروه)

**ناوبری فوری (خواستهٔ ۸)**
- `components/shared/skeleton.tsx` — `PageSkeleton` با حالت‌های dashboard / list / detail / form
- ۱۹ فایل `loading.tsx` تولید شد
- `components/shared/navigation-progress.tsx` + `prefetch` روی لینک‌های سایدبار

## نکتهٔ لاگ ۴۰۴

لاگی که فرستاده بودید (`Not Found: /teacher/exam/create/` روی پورت API) مربوط به checkout قدیمی‌تر از
کامیت `52d264c` است. در `backend/config/urls.py` یک redirect برای هر دو شکل
`/teacher/exam/create/` و `/teacher/exam/create` تعریف شده که با **302** به
`{FRONTEND_URL}/teacher/exams/create` می‌فرستد — تست شد و کار می‌کند.

## اجرای سریع

```bash
cd backend && ./.venv/bin/python manage.py seed_demo && cd ..
npm run dev:stack
```

رمز همهٔ حساب‌های نمونه: `Examora1234!`
`teacher@examora.test` · `student1@examora.test` … `student12@examora.test` · `admin@examora.test`
