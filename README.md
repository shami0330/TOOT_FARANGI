# توت فرنگی — نسخهٔ مک

برنامهٔ مک (Electron، Universal: Apple Silicon و Intel) که فایل `app/index.html` را اجرا می‌کند.

## ساخت و انتشار روی گیتهاب
1. یک مخزن (repo) بساز و همهٔ این پوشه را در آن push کن.
2. تگ بزن:
   ```
   git tag v100.93.0 && git push origin v100.93.0
   ```
3. در تب Actions کار «Build macOS app» اجرا می‌شود و فایل `.dmg` در Releases مخزن ظاهر می‌شود.
   (بدون تگ هم می‌شود از Actions ← Run workflow زد؛ فایل در Artifacts می‌ماند.)

## نصب
فایل dmg را باز کن و برنامه را به Applications بکش. چون برنامه امضای Apple ندارد، بار اول:
راست‌کلیک ← Open، یا در ترمینال:
```
xattr -cr "/Applications/توت فرنگی.app"
```

## نسخهٔ تازه
فایل HTML جدید را جای `app/index.html` بگذار، `version` در `package.json` را بالا ببر و تگ تازه بزن.

## نکته‌ها
- برنامه از `http://localhost:47831` اجرا می‌شود تا داده‌ها در یک مبدأ ثابت بمانند و Appwrite (Hostname = localhost) بپذیرد. پورت را در `main.js` تغییر نده.
- داده‌های قبلی که در Chrome داری با برنامه یکی نیست؛ از خود برنامه پشتیبان بگیر و در نسخهٔ مک بازیابی کن.

## عیب‌یابی انتخاب پوشه (نسخهٔ ۱۰۰٫۹۳)
- پیام‌های موقت «[tf]» در فایل `tf-debug.log` نوشته می‌شود: `~/Library/Application Support/توت فرنگی/tf-debug.log`
- اگر انتخاب‌گر بومی کار نکند، برنامه خودکار به پل پوشه (`preload.js` + `app/tf-shim.js`) می‌رود؛ مسیر پوشه در `tf-dirs.json` کنار همین لاگ نگه‌داری می‌شود.
