# نظام حجز الفحص الفني - نسخة مستقلة

## المتطلبات
- Node.js 18+
- npm

## التثبيت

```bash
npm install
```

## الإعداد

1. انسخ ملف `.env.example` إلى `.env`:
```bash
cp .env.example .env
```

2. عدّل ملف `.env` وغيّر:
   - `ADMIN_PASSWORD`: كلمة مرور لوحة التحكم
   - `JWT_SECRET`: مفتاح عشوائي طويل

## التشغيل

```bash
npm start
```

## الروابط

- **الموقع الأمامي**: `http://localhost:3000/site`
- **لوحة التحكم**: `http://localhost:3000/admin`

## النشر على Render

1. ارفع المشروع على GitHub
2. أنشئ Web Service جديد على Render
3. اختر المستودع
4. أضف متغيرات البيئة:
   - `ADMIN_PASSWORD`: كلمة المرور
   - `JWT_SECRET`: مفتاح عشوائي
5. اضغط Deploy

## النشر على Railway

1. ارفع المشروع على GitHub
2. أنشئ مشروع جديد على Railway
3. اختر المستودع
4. أضف متغيرات البيئة
5. Railway سيشغّل `npm start` تلقائياً

## ملاحظات

- قاعدة البيانات SQLite تُحفظ في `database.db`
- على Render/Railway، قاعدة البيانات تُحذف عند إعادة النشر (استخدم Persistent Disk)
- لحفظ البيانات بشكل دائم على Render: أضف Persistent Disk وغيّر `DB_PATH` لمسار الـ disk
