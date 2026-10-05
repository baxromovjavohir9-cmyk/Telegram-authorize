# Telegram bot orqali kirish

Faqat Telegram orqali kirish mumkin. Parol yo'q. Saytda tugma bosiladi, bot Telegramda
«Ruxsat berish / Rad etish» xabarini yuboradi, javobga qarab sayt foydalanuvchini kiritadi.

## 1. Bot yarating

1. Telegramda **@BotFather** ga yozing va `/newbot` yuboring.
2. Bot nomi va username'ini tanlang (username `bot` bilan tugashi kerak).
3. BotFather bergan **tokenni** saqlab qo'ying.

`/setdomain` kerak emas, `localhost` da ham ishlaydi.

## 2. Ishga tushiring

Node.js 20.6 yoki yangiroq versiya kerak.

```bash
cp .env.example .env     # BOT_TOKEN va SESSION_SECRET ni to'ldiring
npm install
npm run dev
```

Brauzerda `http://localhost:3000` ni oching.

## Render'ga joylash (bepul)

1. Papkani GitHub'da yangi repozitoriyga yuklang (`.env` yuklanmaydi, `.gitignore` buni ta'minlaydi).
2. [dashboard.render.com](https://dashboard.render.com) da **New → Blueprint** ni tanlang va repozitoriyni ulang.
   Render `render.yaml` ni o'zi o'qiydi.
3. So'ralganda `BOT_TOKEN` ga BotFather tokenini kiriting. `SESSION_SECRET` ni Render o'zi yaratadi.
4. Deploy tugagach, Render bergan `https://...onrender.com` manzilini oching.

Bepul rejimda sayt 15 daqiqa so'rov kelmasa uxlab qoladi, keyingi kirish taxminan 1 daqiqa
uyg'onishni talab qiladi. Kirish jarayonida sahifa so'rov yuborib turgani uchun server uyg'oq turadi.
Uzluksiz ishlashi kerak bo'lsa, pullik rejaga o'ting.

## Qanday ishlaydi

1. Foydalanuvchi «Telegram bilan kirish» tugmasini bosadi. Server bir martalik so'rov yaratadi
   va `t.me/bot?start=...` havolasini beradi.
2. Foydalanuvchi botni ochadi. Bot unga vaqt, IP va qurilma ko'rsatilgan xabar yuboradi:
   «✅ Ruxsat berish» / «❌ Rad etish».
3. Sahifa har 2 soniyada natijani so'raydi. Ruxsat berilsa, 7 kunlik `httpOnly` cookie beriladi.
   Rad etilsa yoki 5 daqiqa o'tsa, kirish bekor bo'ladi.

Bot xabarlarni `getUpdates` (long polling) orqali oladi, shuning uchun webhook yoki HTTPS shart emas.

## Xavfsizlik

- Havolani boshqa odamga yuborib, «Ruxsat berish» ni bosdirish mumkin. Shuning uchun
  xabarda IP va qurilma ko'rsatiladi: tanimagan so'rovni rad eting.
- So'rovlar xotirada saqlanadi, shuning uchun server qayta ishga tushsa, kutilayotganlari yo'qoladi.
  Bir nechta server nusxasi kerak bo'lsa, Redis kabi umumiy saqlash kerak.
- `.env` faylini GitHub'ga yuklamang: `BOT_TOKEN` maxfiy.
- Serverda ishlatganda `NODE_ENV=production` qo'ying (cookie faqat HTTPS orqali yuboriladi).
