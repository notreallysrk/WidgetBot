(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor("#0c0715"); tg.setBackgroundColor("#0c0715"); } catch (_) {} }

  const screens = ["home", "play", "board", "profile", "leaderboard", "settings", "help"];
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

  // Phase 02: render a responsive four-colour board preview; rules are Phase 03.
  const boardEl = document.getElementById("ludo-board");
  if (boardEl) {
    const tokens = {red:[[2,2],[2,4],[4,2],[4,4]],green:[[2,10],[2,12],[4,10],[4,12]],blue:[[10,2],[10,4],[12,2],[12,4]],yellow:[[10,10],[10,12],[12,10],[12,12]]};
    const path = new Set();
    [[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]].forEach(([r,c])=>path.add(r+"-"+c));
    const safe=new Set(["6-1","2-6","1-8","6-13","8-13","12-8","13-6","8-1"]);
    const lanes={red:[[7,1],[7,2],[7,3],[7,4],[7,5]],green:[[1,7],[2,7],[3,7],[4,7],[5,7]],yellow:[[7,9],[7,10],[7,11],[7,12],[7,13]],blue:[[13,7],[12,7],[11,7],[10,7],[9,7]]};
    const laneMap=new Map();Object.entries(lanes).forEach(([color,cells])=>cells.forEach(([r,c])=>laneMap.set(r+"-"+c,color)));
    for(let r=0;r<15;r++)for(let c=0;c<15;c++){
      const cell=document.createElement("div");cell.className="board-cell";
      const quad=r<6&&c<6?"red":r<6&&c>8?"green":r>8&&c<6?"blue":r>8&&c>8?"yellow":null;
      if(quad)cell.classList.add(quad+"-home");
      if((r>=1&&r<=4&&c>=1&&c<=4&&quad==="red")||(r>=1&&r<=4&&c>=10&&c<=13&&quad==="green")||(r>=10&&r<=13&&c>=1&&c<=4&&quad==="blue")||(r>=10&&r<=13&&c>=10&&c<=13&&quad==="yellow"))cell.classList.add("yard");
      const lane=laneMap.get(r+"-"+c);if(lane)cell.classList.add("lane-"+lane);
      if(path.has(r+"-"+c))cell.classList.add("track");
      if(safe.has(r+"-"+c)){cell.classList.add("safe");cell.textContent="★";}
      if(r===7&&c===7){cell.classList.add("center-home");cell.textContent="♛";}
      Object.entries(tokens).forEach(([color,spots])=>spots.forEach(([tr,tc],i)=>{if(r===tr&&c===tc){const token=document.createElement("span");token.className="board-token token-"+color;token.textContent=String(i+1);cell.appendChild(token);}}));
      boardEl.appendChild(cell);
    }
  }
  const diceButton=document.getElementById("roll-dice");
  if(diceButton){const faces=["⚀","⚁","⚂","⚃","⚄","⚅"];let rolling=false;diceButton.addEventListener("click",()=>{if(rolling)return;rolling=true;diceButton.classList.add("rolling");const face=document.getElementById("dice-face");let ticks=0;const spin=setInterval(()=>{face.textContent=faces[Math.floor(Math.random()*6)];if(++ticks>=9){clearInterval(spin);rolling=false;diceButton.classList.remove("rolling");toast("Preview only — playable dice arrives in Phase 03");}},75);try{tg?.HapticFeedback?.impactOccurred("light");}catch(_){} });}

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
