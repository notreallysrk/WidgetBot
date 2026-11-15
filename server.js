require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { Telegraf, Markup } = require("telegraf");
const path = require("path");

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const DB_NAME = process.env.MONGODB_DB_NAME || "LudoArena";

let db = null;
let bot = null;

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isSafeInteger(user.id)) return null;
    return user;
  } catch {
    return null;
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "Ludo Arena" }));

app.post("/api/auth/telegram", async (req, res) => {
  const user = verifyTelegramInitData(req.body?.initData, BOT_TOKEN);
  if (!user) return res.status(401).json({ ok: false, error: "Invalid Telegram session" });

  const profile = {
    telegramId: user.id,
    firstName: user.first_name || "Player",
    lastName: user.last_name || "",
    username: user.username || null,
    photoUrl: user.photo_url || null,
    updatedAt: new Date()
  };

  try {
    if (db) {
      await db.collection("users").updateOne(
        { telegramId: user.id },
        { $set: profile, $setOnInsert: { createdAt: new Date(), level: 1, xp: 0, coins: 0, wins: 0, gamesPlayed: 0 } },
        { upsert: true }
      );
    }
    return res.json({ ok: true, user: profile });
  } catch (error) {
    console.error("Profile save failed:", error.message);
    return res.status(500).json({ ok: false, error: "Could not save profile" });
  }
});

app.get("/api/profile", async (req, res) => {
  const telegramId = Number(req.query.telegramId);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return res.status(400).json({ ok: false, error: "Valid Telegram ID required" });
  }
  if (!db) return res.json({ ok: true, profile: null });
  const profile = await db.collection("users").findOne(
    { telegramId },
    { projection: { _id: 0, telegramId: 1, firstName: 1, lastName: 1, username: 1, level: 1, xp: 1, coins: 1, wins: 1, gamesPlayed: 1 } }
  );
  return res.json({ ok: true, profile });
});

async function start() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection("users").createIndex({ telegramId: 1 }, { unique: true });
    await db.collection("matches").createIndex({ createdAt: -1 });
    await db.collection("rooms").createIndex({ roomCode: 1 }, { unique: true, sparse: true });
    console.log("MongoDB connected");
  } else {
    console.warn("MONGODB_URI not configured; profile persistence is disabled.");
  }

  if (BOT_TOKEN) {
    bot = new Telegraf(BOT_TOKEN);
    bot.start(async (ctx) => {
      const keyboard = WEB_APP_URL
        ? Markup.inlineKeyboard([[Markup.button.webApp("🎮 Open Ludo Arena", WEB_APP_URL)]])
        : Markup.inlineKeyboard([[Markup.button.url("Set up Mini App", "https://core.telegram.org/bots/webapps")]]);
      await ctx.reply(
        "👑 Welcome to Ludo Arena!\n\nYour premium Ludo experience starts here. Open the game to view your dashboard.",
        keyboard
      );
    });
    bot.catch((err) => console.error("Telegram bot error:", err.message));
    await bot.launch();
    console.log(`Bot started${BOT_USERNAME ? " @" + BOT_USERNAME : ""}`);
  } else {
    console.warn("BOT_TOKEN not configured; Telegram bot polling is disabled.");
  }

  app.listen(PORT, () => console.log(`Ludo Arena listening on ${PORT}`));
}

process.once("SIGINT", () => bot?.stop("SIGINT"));
process.once("SIGTERM", () => bot?.stop("SIGTERM"));

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
