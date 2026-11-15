require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const { Telegraf, Markup } = require("telegraf");
const path = require("path");
const LudoEngine = require("./public/game-engine");

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const DB_NAME = process.env.MONGODB_DB_NAME || "LudoArena";

let db = null;
let mongoClient = null;
let bot = null;
let httpServer = null;
let shuttingDown = false;
let mongoStatus = "disabled";
let botStatus = "disabled";

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

app.get("/health", (_req, res) => {
  const ready = mongoStatus === "connected" || mongoStatus === "disabled";
  res.status(200).json({
    ok: true,
    service: "Ludo Arena",
    server: "listening",
    mongodb: mongoStatus,
    telegramBot: botStatus,
    profilePersistence: Boolean(db),
    ready
  });
});

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
    return res.json({ ok: true, user: profile, persistence: Boolean(db) });
  } catch (error) {
    console.error("Profile save failed:", error.message);
    return res.status(503).json({ ok: false, error: "Profile storage is temporarily unavailable" });
  }
});

app.get("/api/profile", async (req, res) => {
  const telegramId = Number(req.query.telegramId);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return res.status(400).json({ ok: false, error: "Valid Telegram ID required" });
  }
  if (!db) return res.status(503).json({ ok: false, error: "Profile storage is not ready" });

  try {
    const profile = await db.collection("users").findOne(
      { telegramId },
      { projection: { _id: 0, telegramId: 1, firstName: 1, lastName: 1, username: 1, level: 1, xp: 1, coins: 1, wins: 1, gamesPlayed: 1 } }
    );
    return res.json({ ok: true, profile });
  } catch (error) {
    console.error("Profile read failed:", error.message);
    return res.status(503).json({ ok: false, error: "Profile storage is temporarily unavailable" });
  }
});


function getAuthenticatedUser(req) {
  const initData = req.body?.initData || req.headers["x-telegram-init-data"] || "";
  return verifyTelegramInitData(initData, BOT_TOKEN);
}

async function runAiTurns(state) {
  for (let step = 0; step < 64 && state.status === "playing"; step += 1) {
    const player = state.players[state.currentPlayer];
    if (!player || player.type !== "ai") break;
    if (state.dice === null) state = LudoEngine.rollDice(state, crypto.randomInt(1, 7));
    if (state.dice !== null && state.legalMoves.length) {
      const token = LudoEngine.chooseAiMove(state);
      state = LudoEngine.moveToken(state, token);
    }
  }
  return state;
}

async function persistGameAction(req, res, action) {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Invalid Telegram session" });
  if (!db) return res.status(503).json({ ok: false, error: "Game service is starting. Please try again." });
  const gameId = String(req.params.gameId || "");
  if (!/^[a-f0-9-]{20,40}$/i.test(gameId)) return res.status(400).json({ ok: false, error: "Invalid game ID" });
  try {
    const games = db.collection("games");
    const doc = await games.findOne({ gameId, telegramId: user.id });
    if (!doc) return res.status(404).json({ ok: false, error: "Game not found" });
    let state = doc.state;
    if (action === "roll") {
      if (state.players[state.currentPlayer]?.type !== "human") {
        return res.status(409).json({ ok: false, error: "Wait for your turn", state });
      }
      state = LudoEngine.rollDice(state, crypto.randomInt(1, 7));
    } else {
      const tokenIndex = Number(req.body?.tokenIndex);
      if (!Number.isInteger(tokenIndex)) return res.status(400).json({ ok: false, error: "Select a valid token" });
      if (state.players[state.currentPlayer]?.type !== "human") {
        return res.status(409).json({ ok: false, error: "Wait for your turn", state });
      }
      state = LudoEngine.moveToken(state, tokenIndex);
    }
    state = await runAiTurns(state);
    const saved = await games.updateOne(
      { _id: doc._id, revision: doc.revision },
      { $set: { state, updatedAt: new Date() }, $inc: { revision: 1 } }
    );
    if (saved.modifiedCount !== 1) return res.status(409).json({ ok: false, error: "Game changed. Refreshing the latest state.", conflict: true });
    if (state.status === "finished" && !doc.completedAt) {
      const won = state.winner === String(user.id);
      await db.collection("users").updateOne(
        { telegramId: user.id },
        { $inc: { gamesPlayed: 1, ...(won ? { wins: 1, xp: 25 } : { xp: 5 }) } }
      );
      await games.updateOne({ _id: doc._id, completedAt: { $exists: false } }, { $set: { completedAt: new Date() } });
    }
    return res.json({ ok: true, state, revision: doc.revision + 1 });
  } catch (error) {
    console.error("Game action failed:", error.message);
    return res.status(400).json({ ok: false, error: error.message || "Game action failed" });
  }
}

app.post("/api/game/solo", async (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ ok: false, error: "Invalid Telegram session" });
  if (!db) return res.status(503).json({ ok: false, error: "Game service is starting. Please try again." });
  const difficulty = ["easy", "medium", "hard"].includes(req.body?.difficulty) ? req.body.difficulty : "medium";
  try {
    const state = LudoEngine.createGame([
      { id: String(user.id), name: user.first_name || "You", type: "human" },
      { id: "ai-green", name: "Arena AI", type: "ai", difficulty },
      { id: "ai-yellow", name: "Royal Bot", type: "ai", difficulty },
      { id: "ai-blue", name: "Shadow Bot", type: "ai", difficulty }
    ]);
    state.id = crypto.randomUUID();
    await db.collection("games").insertOne({
      gameId: state.id, telegramId: user.id, state, revision: 0,
      createdAt: new Date(), updatedAt: new Date()
    });
    return res.json({ ok: true, state, revision: 0 });
  } catch (error) {
    console.error("Create solo game failed:", error.message);
    return res.status(500).json({ ok: false, error: "Could not start a game" });
  }
});

app.post("/api/game/:gameId/roll", (req, res) => persistGameAction(req, res, "roll"));
app.post("/api/game/:gameId/move", (req, res) => persistGameAction(req, res, "move"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectMongo() {
  if (!process.env.MONGODB_URI) {
    mongoStatus = "disabled";
    console.warn("MONGODB_URI not configured; profile persistence is disabled.");
    return;
  }

  let attempt = 0;
  while (!shuttingDown) {
    attempt += 1;
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10
    });

    try {
      await client.connect();
      const database = client.db(DB_NAME);
      await database.collection("users").createIndex({ telegramId: 1 }, { unique: true });
      await database.collection("matches").createIndex({ createdAt: -1 });
      await database.collection("rooms").createIndex({ roomCode: 1 }, { unique: true, sparse: true });
      await database.collection("games").createIndex({ gameId: 1, telegramId: 1 }, { unique: true });
      await database.collection("games").createIndex({ updatedAt: 1 }, { expireAfterSeconds: 604800 });
      mongoClient = client;
      db = database;
      mongoStatus = "connected";
      console.log("MongoDB connected");
      return;
    } catch (error) {
      console.error(`MongoDB connection attempt ${attempt} failed:`, error.message);
      await client.close().catch(() => {});
      mongoStatus = "retrying";
      if (!shuttingDown) {
        console.warn("MongoDB will retry in 15 seconds; web server remains available.");
        await sleep(15000);
      }
    }
  }
}

function startTelegramBot() {
  if (!BOT_TOKEN) {
    botStatus = "disabled";
    console.warn("BOT_TOKEN not configured; Telegram bot polling is disabled.");
    return;
  }

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

  botStatus = "starting";
  bot.launch()
    .then(() => {
      botStatus = "running";
      console.log(`Bot started${BOT_USERNAME ? " @" + BOT_USERNAME : ""}`);
    })
    .catch((error) => {
      botStatus = "error";
      console.error("Telegram bot failed to start; web server will remain available:", error.message);
    });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully.`);

  if (bot) {
    try {
      bot.stop(signal);
    } catch (error) {
      console.error("Telegram bot shutdown error:", error.message);
    }
  }

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  if (mongoClient) {
    await mongoClient.close().catch((error) => console.error("MongoDB shutdown error:", error.message));
  }
  process.exit(0);
}

// Bind the Heroku web port immediately. External services must never block web startup.
httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ludo Arena listening on ${PORT}`);
  startTelegramBot();
  connectMongo().catch((error) => {
    mongoStatus = "error";
    console.error("Unexpected MongoDB initialization error:", error.message);
  });
});

httpServer.on("error", (error) => {
  console.error("HTTP server error:", error);
  process.exit(1);
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
