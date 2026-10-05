const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const {
  BOT_TOKEN,
  SESSION_SECRET,
  PORT = 3000,
  NODE_ENV,
  DISPLAY_TZ = "Asia/Tashkent",
} = process.env;

if (!BOT_TOKEN || !SESSION_SECRET) {
  console.error(
    "BOT_TOKEN va SESSION_SECRET muhit o'zgaruvchilari kerak (.env.example ga qarang)."
  );
  process.exit(1);
}

const SESSION_COOKIE = "session";
const SECRET_COOKIE = "login_secret";
const SESSION_DAYS = 7;
const LOGIN_TTL_MS = 5 * 60 * 1000; // so'rov 5 daqiqa amal qiladi
const MAX_PENDING = 1000;
const MAX_PENDING_PER_IP = 10;
const secureCookie = NODE_ENV === "production";

// token -> { secret, ip, ua, status, createdAt, chatId, tgUser }
// Diqqat: xotirada saqlanadi, bitta server jarayoni uchun mo'ljallangan.
const logins = new Map();
let botUsername = null;

const expired = (l) => Date.now() - l.createdAt > LOGIN_TTL_MS;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

setInterval(() => {
  for (const [token, l] of logins) if (expired(l)) logins.delete(token);
}, 60 * 1000).unref();

/* ---------- Telegram Bot API ---------- */

async function tg(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

async function handleMessage(msg) {
  if (msg.chat.type !== "private" || !msg.from || msg.from.is_bot) return;

  const chatId = msg.chat.id;
  const match = (msg.text || "").match(/^\/start(?:@\w+)?\s+([\w-]{10,64})$/);

  if (!match) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Salom! Saytga kirish uchun saytdagi «Telegram bilan kirish» tugmasini bosing.",
    });
    return;
  }

  const token = match[1];
  const login = logins.get(token);

  if (!login || login.status !== "pending" || expired(login)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Bu so'rov eskirgan yoki ishlatilgan. Saytga qaytib, yangisini yuboring.",
    });
    return;
  }

  // Havola boshqa odamga o'tib ketgan bo'lsa, ikkinchisini rad etamiz
  if (login.tgUser && login.tgUser.id !== msg.from.id) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Bu so'rov boshqa akkaunt uchun ochilgan.",
    });
    return;
  }

  login.chatId = chatId;
  login.tgUser = {
    id: msg.from.id,
    first_name: msg.from.first_name || "",
    last_name: msg.from.last_name || "",
    username: msg.from.username || "",
  };

  const when = new Date(login.createdAt).toLocaleString("en-GB", {
    timeZone: DISPLAY_TZ,
  });

  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "Saytga kirish so'rovi\n\n" +
      `Vaqt: ${when}\n` +
      `IP: ${login.ip}\n` +
      `Qurilma: ${login.ua || "noma'lum"}\n\n` +
      "Bu siz bo'lsangiz, ruxsat bering. Aks holda rad eting.",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Ruxsat berish", callback_data: `a:${token}` },
          { text: "❌ Rad etish", callback_data: `d:${token}` },
        ],
      ],
    },
  });
}

async function handleCallback(cb) {
  const [action, token] = (cb.data || "").split(":");
  const login = logins.get(token);

  const invalid =
    (action !== "a" && action !== "d") ||
    !login ||
    login.status !== "pending" ||
    expired(login) ||
    !login.tgUser ||
    login.tgUser.id !== cb.from.id;

  if (invalid) {
    await tg("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "So'rov eskirgan.",
      show_alert: true,
    });
    return;
  }

  login.status = action === "a" ? "approved" : "denied";

  await tg("answerCallbackQuery", { callback_query_id: cb.id });
  if (cb.message) {
    await tg("editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text:
        login.status === "approved"
          ? "✅ Ruxsat berildi. Saytga qaytishingiz mumkin."
          : "❌ Rad etildi.",
    });
  }
}

async function pollUpdates() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await handleMessage(u.message);
          else if (u.callback_query) await handleCallback(u.callback_query);
        } catch (err) {
          console.error("Update xatosi:", err.message);
        }
      }
    } catch (err) {
      console.error("getUpdates xatosi:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/* ---------- Veb-server ---------- */

const app = express();
app.set("trust proxy", 1);
app.use(cookieParser());

function getUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, SESSION_SECRET).user;
  } catch {
    return null;
  }
}

// 1) Sayt yangi kirish so'rovini boshlaydi
app.post("/auth/start", async (req, res) => {
  for (let i = 0; i < 20 && !botUsername; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!botUsername) return res.status(503).json({ error: "bot_not_ready" });

  let pendingForIp = 0;
  for (const l of logins.values()) {
    if (l.ip === req.ip && l.status === "pending") pendingForIp++;
  }
  if (logins.size >= MAX_PENDING || pendingForIp >= MAX_PENDING_PER_IP) {
    return res.status(429).json({ error: "too_many" });
  }

  const token = crypto.randomBytes(16).toString("base64url"); // botga boradi
  const secret = crypto.randomBytes(32).toString("base64url"); // faqat shu brauzerda

  logins.set(token, {
    secret,
    ip: req.ip,
    ua: (req.get("user-agent") || "").slice(0, 100),
    status: "pending",
    createdAt: Date.now(),
    chatId: null,
    tgUser: null,
  });

  res.cookie(SECRET_COOKIE, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: LOGIN_TTL_MS,
  });
  res.json({ token, url: `https://t.me/${botUsername}?start=${token}` });
});

// 2) Sahifa natijani so'rab turadi
app.get("/auth/status", (req, res) => {
  res.set("Cache-Control", "no-store");

  const token = String(req.query.token || "");
  const secret = req.cookies[SECRET_COOKIE];
  const login = logins.get(token);

  if (!login || !secret || !safeEqual(login.secret, secret)) {
    return res.json({ status: "expired" });
  }
  if (expired(login)) {
    logins.delete(token);
    return res.json({ status: "expired" });
  }
  if (login.status === "pending") {
    return res.json({ status: "pending", opened: Boolean(login.chatId) });
  }

  logins.delete(token);
  res.clearCookie(SECRET_COOKIE);

  if (login.status === "denied") return res.json({ status: "denied" });

  const user = {
    id: String(login.tgUser.id),
    first_name: login.tgUser.first_name,
    last_name: login.tgUser.last_name,
    username: login.tgUser.username,
  };
  const session = jwt.sign({ user }, SESSION_SECRET, {
    expiresIn: `${SESSION_DAYS}d`,
  });
  res.cookie(SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
  res.json({ status: "approved" });
});

app.get("/healthz", (req, res) => res.send("ok"));

app.get("/api/me", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ user: getUser(req) });
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});

(async () => {
  const me = await tg("getMe");
  botUsername = me.username;
  await tg("deleteWebhook"); // getUpdates ishlashi uchun
  console.log(`Bot ulandi: @${botUsername}`);
  pollUpdates();
})().catch((err) => {
  console.error("Telegram'ga ulanib bo'lmadi:", err.message);
  process.exit(1);
});
