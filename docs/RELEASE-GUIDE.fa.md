# راهنمای ساخت و انتشار خودکار در GitHub

## اعمال اصلاحات

این بسته نسخهٔ اصلاح‌شدهٔ سورس است و لزوماً شامل آخرین تغییراتی که جداگانه در مخزن GitHub داده‌اید نیست. پیش از جایگزینی، از تغییرات مخزن خود پشتیبان بگیرید و تفاوت‌ها را ادغام کنید؛ کل مخزن را کورکورانه بازنویسی نکنید. مهم‌ترین تغییرات این اصلاح در `.github/workflows/release.yml`، `packages/ui/src/skin/app-icon.tsx`، بخش About در `packages/ui/src/featurecenter/index.tsx`، و دستور `pretest` در `package.json` هستند. نسخه در فایل ZIP برابر 1.0.1 است؛ نسخهٔ موجود مخزن خود را بررسی کنید و آن را ناخواسته کاهش ندهید.

نسخهٔ آیکن اکنون از `package.json` خوانده می‌شود؛ `npm test` نیز ابتدا آیکن‌های متناسب با همان نسخه را بازتولید می‌کند. macOS runner به `macos-15` تغییر کرده است. فایل workflow و تغییرات را commit و روی شاخهٔ پیش‌فرض push کنید.

## مجوز و فعال‌سازی

در GitHub به **Settings → Actions → General** بروید، Actions را فعال کنید و در **Workflow permissions** گزینهٔ **Read and write permissions** را انتخاب و Save کنید. در مخازن سازمانی ممکن است محدودیت سازمان یا دسترسی Actions مانع این تنظیم شود. فایل workflow باید در شاخهٔ پیش‌فرض وجود داشته باشد تا اجرای دستی در UI فعال شود.

## انتشار خودکار با tag (پیشنهادی)

در یک clone از مخزن، پس از ادغام اصلاحات و اطمینان از تمیز بودن وضعیت Git، نسخهٔ جدید بسازید. اگر نسخهٔ کنونی 1.0.1 است و تگ v1.0.1 قبلاً استفاده شده، دستور زیر نسخهٔ 1.0.2 و تگ v1.0.2 می‌سازد:

```bash
git checkout main
git pull origin main
npm ci
npm version patch --no-git-tag-version
npm run generate:icons
npm run typecheck
npm test
git add package.json package-lock.json assets/icon installer-assets
git commit -m "Release new version"
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"
```

در PowerShell به جای دو خط تعیین VERSION و tag می‌توانید از این استفاده کنید:

```powershell
$version = node -p "require('./package.json').version"
git tag "v$version"
git push origin main
git push origin "v$version"
```

نام شاخه را در صورت متفاوت بودن از `main` تغییر دهید. پیش از اجرا مطمئن شوید نام تگ جدید قبلاً استفاده نشده است؛ تگ قدیمی را بازنویسی نکنید. نام تگ باید دقیقاً `v` به‌علاوهٔ نسخهٔ `package.json` باشد. `npm version patch` در نسخهٔ prerelease ممکن است رفتاری متفاوت داشته باشد؛ در آن حالت نسخه را آگاهانه انتخاب کنید.

پس از push تگ، از صفحهٔ **Actions → Release** وضعیت jobهای Verify، Build و Publish را ببینید. پس از موفقیت، از صفحهٔ **Releases** فایل‌های Windows، macOS Intel و Apple Silicon، Linux، نسخهٔ وب و `SHA256SUMS.txt` را دریافت کنید. این روند به سهمیه، مجوز و در دسترس بودن runnerهای GitHub وابسته است. بیلدها بدون امضای دیجیتال هستند و ممکن است SmartScreen یا Gatekeeper هشدار دهند.

## اجرای دستی

از **Actions → Release → Run workflow** شاخه یا تگ دارای اصلاحات را انتخاب کنید. مقدار `draft` به‌طور پیش‌فرض روشن است؛ برای انتشار فوری خاموش کنید. برای پیش‌انتشار، `prerelease` را فعال کنید. اگر تگ مربوط به نسخه وجود نداشته باشد، workflow آن را روی commit انتخاب‌شده می‌سازد. اگر وجود دارد، باید دقیقاً به همان commit اشاره کند؛ در غیر این صورت نسخه را افزایش دهید. اجرای مجدد یک تگ قدیمی از فایل workflow و کد همان تگ استفاده می‌کند، نه اصلاحات جدید شاخه.

هر سه بیلد باید موفق باشند؛ اگر فایل مورد انتظار نباشد، انتشار متوقف می‌شود و release ناقص ساخته نمی‌شود. فایل‌های موقت بیلدهای موفق را می‌توان تا پایان مدت نگهداری از بخش Artifacts همان اجرای Actions دانلود کرد.
