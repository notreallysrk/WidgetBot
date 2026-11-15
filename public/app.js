(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor("#0c0715"); tg.setBackgroundColor("#0c0715"); } catch (_) {} }

  const screens = ["home", "play", "profile", "leaderboard", "settings", "help"];
  const toastEl = document.getElementById("toast");
  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2300);
    try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
  }
  function showScreen(name) {
    if (!screens.includes(name)) return;
    screens.forEach(id => document.getElementById(id).classList.toggle("active", id === name));
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.screen === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    try { tg?.HapticFeedback?.selectionChanged(); } catch (_) {}
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-screen]");
    if (button) showScreen(button.dataset.screen);
  });

  const initData = tg?.initData || "";
  let currentUser = tg?.initDataUnsafe?.user || null;
  function applyUser(user) {
    if (!user) return;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Arena Player";
    document.getElementById("player-name").textContent = name;
    document.getElementById("player-handle").textContent = user.username ? "@" + user.username : "Telegram Player";
    if (user.photo_url) {
      const avatar = document.getElementById("avatar");
      avatar.textContent = "";
      avatar.style.backgroundImage = `url("${user.photo_url}")`;
      avatar.style.backgroundSize = "cover";
      avatar.style.backgroundPosition = "center";
    }
  }
  applyUser(currentUser);

  async function authenticate() {
    if (!initData) {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        document.getElementById("player-name").textContent = "Preview Player";
        document.getElementById("player-handle").textContent = "Local preview";
      } else {
        toast("Open Ludo Arena from the Telegram bot to sign in.");
      }
      return;
    }
    try {
      const response = await fetch("/api/auth/telegram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Authentication failed");
      applyUser({
        first_name: result.user.firstName, last_name: result.user.lastName,
        username: result.user.username, photo_url: result.user.photoUrl
      });
      const p = await fetch(`/api/profile?telegramId=${encodeURIComponent(result.user.telegramId)}`);
      const data = await p.json();
      if (data.profile) {
        const profile = data.profile;
        document.getElementById("wins").textContent = profile.wins || 0;
        document.getElementById("games").textContent = profile.gamesPlayed || 0;
        document.getElementById("xp").textContent = profile.xp || 0;
        document.getElementById("profile-wins").textContent = profile.wins || 0;
        document.getElementById("profile-games").textContent = profile.gamesPlayed || 0;
      }
    } catch (error) { console.error(error); toast("Could not verify Telegram session. Please reopen the app."); }
  }
  authenticate();

  const defaults = { sound: true, vibration: true, reduceMotion: false };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem("ludoArenaSettings") || "{}") }; } catch (_) {}
  const sound = document.getElementById("sound-toggle");
  const vibration = document.getElementById("vibration-toggle");
  const motion = document.getElementById("motion-toggle");
  sound.checked = settings.sound; vibration.checked = settings.vibration; motion.checked = settings.reduceMotion;
  function saveSettings() {
    settings = { sound: sound.checked, vibration: vibration.checked, reduceMotion: motion.checked };
    try { localStorage.setItem("ludoArenaSettings", JSON.stringify(settings)); } catch (_) {}
    document.documentElement.style.scrollBehavior = settings.reduceMotion ? "auto" : "smooth";
    toast("Settings saved");
  }
  [sound, vibration, motion].forEach(el => el.addEventListener("change", saveSettings));
  document.getElementById("reset-settings").addEventListener("click", () => {
    sound.checked = defaults.sound; vibration.checked = defaults.vibration; motion.checked = defaults.reduceMotion;
    saveSettings(); toast("Settings restored");
  });
})();
