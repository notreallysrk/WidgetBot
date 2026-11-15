(() => {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor("#0c0715"); tg.setBackgroundColor("#0c0715"); } catch (_) {}
  }
  const screens = ["home","play","board","profile","leaderboard","settings","help"];
  const toastEl = document.getElementById("toast");
  let toastTimer, currentUser = tg?.initDataUnsafe?.user || null, gameState = null, gameBusy = false;
  const initData = tg?.initData || "";
  const faces = ["","⚀","⚁","⚂","⚃","⚄","⚅"];
  function toast(message) {
    toastEl.textContent = message; toastEl.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
    try { tg?.HapticFeedback?.notificationOccurred("success"); } catch (_) {}
  }
  function showScreen(name) {
    if (!screens.includes(name)) return;
    screens.forEach(id => document.getElementById(id).classList.toggle("active", id === name));
    document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.screen === name));
    window.scrollTo({top:0,behavior:"smooth"});
    try { tg?.HapticFeedback?.selectionChanged(); } catch (_) {}
  }
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-screen]");
    if (button) showScreen(button.dataset.screen);
  });
  function applyUser(user) {
    if (!user) return;
    const name = [user.first_name,user.last_name].filter(Boolean).join(" ") || "Arena Player";
    document.getElementById("player-name").textContent = name;
    document.getElementById("player-handle").textContent = user.username ? "@"+user.username : "Telegram Player";
    if (user.photo_url) {
      const avatar = document.getElementById("avatar");
      avatar.textContent = ""; avatar.style.backgroundImage = 'url("' + user.photo_url + '")';
      avatar.style.backgroundSize = "cover"; avatar.style.backgroundPosition = "center";
    }
  }
  applyUser(currentUser);
  async function api(url, payload = {}) {
    const response = await fetch(url, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...payload,initData})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Game request failed");
    return result;
  }
  async function authenticate() {
    if (!initData) {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        document.getElementById("player-name").textContent = "Preview Player";
        document.getElementById("player-handle").textContent = "Local preview";
      } else toast("Open Ludo Arena from the Telegram bot to sign in.");
      return;
    }
    try {
      const response = await fetch("/api/auth/telegram", {
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData})
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Authentication failed");
      currentUser = result.user;
      applyUser({first_name:result.user.firstName,last_name:result.user.lastName,username:result.user.username,photo_url:result.user.photoUrl});
      const p = await fetch("/api/profile?telegramId="+encodeURIComponent(result.user.telegramId));
      const data = await p.json();
      if (data.profile) {
        const profile = data.profile;
        ["wins","profile-wins"].forEach(id => document.getElementById(id).textContent = profile.wins || 0);
        ["games","profile-games"].forEach(id => document.getElementById(id).textContent = profile.gamesPlayed || 0);
        document.getElementById("xp").textContent = profile.xp || 0;
      }
    } catch (error) { console.error(error); toast("Could not verify Telegram session. Reopen the app."); }
  }

  const boardEl = document.getElementById("ludo-board");
  const yardSpots = {
    red:[[2,2],[2,4],[4,2],[4,4]], green:[[2,10],[2,12],[4,10],[4,12]],
    blue:[[10,2],[10,4],[12,2],[12,4]], yellow:[[10,10],[10,12],[12,10],[12,12]]
  };
  const lanes = {
    red:[[7,1],[7,2],[7,3],[7,4],[7,5]], green:[[1,7],[2,7],[3,7],[4,7],[5,7]],
    yellow:[[7,13],[7,12],[7,11],[7,10],[7,9]], blue:[[13,7],[12,7],[11,7],[10,7],[9,7]]
  };
  const laneMap = new Map();
  Object.entries(lanes).forEach(([color,cells]) => cells.forEach(([r,c]) => laneMap.set(r+"-"+c,color)));
  const pathKeys = new Set(LudoEngine.TRACK.map(([r,c])=>r+"-"+c));
  const safeKeys = new Set([...LudoEngine.SAFE_CELLS].map(i=>LudoEngine.TRACK[i].join("-")));
  function buildBoard() {
    boardEl.innerHTML = "";
    for (let r=0;r<15;r++) for (let c=0;c<15;c++) {
      const key=r+"-"+c, cell=document.createElement("div"); cell.className="board-cell"; cell.dataset.cell=key;
      const quad=r<6&&c<6?"red":r<6&&c>8?"green":r>8&&c<6?"blue":r>8&&c>8?"yellow":null;
      if (quad) cell.classList.add(quad+"-home");
      if ((r>=1&&r<=4&&c>=1&&c<=4&&quad==="red")||(r>=1&&r<=4&&c>=10&&c<=13&&quad==="green")||(r>=10&&r<=13&&c>=1&&c<=4&&quad==="blue")||(r>=10&&r<=13&&c>=10&&c<=13&&quad==="yellow")) cell.classList.add("yard");
      if (pathKeys.has(key)) cell.classList.add("track");
      const lane=laneMap.get(key); if(lane) cell.classList.add("lane-"+lane);
      const startColor=Object.keys(LudoEngine.START).find(color=>LudoEngine.TRACK[LudoEngine.START[color]].join("-")===key);
      if(startColor) cell.classList.add("start-"+startColor);
      if(safeKeys.has(key)){cell.classList.add("safe");cell.textContent="✦";}
      if(r>=6&&r<=8&&c>=6&&c<=8){
        if(r===7&&c===7){cell.classList.add("center-home");cell.textContent="♛";}
        else if(r===6&&c===6)cell.classList.add("center-top-left");
        else if(r===6&&c===8)cell.classList.add("center-top-right");
        else if(r===8&&c===6)cell.classList.add("center-bottom-left");
        else if(r===8&&c===8)cell.classList.add("center-bottom-right");
      }
      boardEl.appendChild(cell);
    }
  }
  function addToken(color, playerIndex, tokenIndex, progress, movable) {
    let coords;
    if (progress === -1) coords = yardSpots[color][tokenIndex];
    else if (progress === LudoEngine.FINISH) coords = [7,7];
    else coords = LudoEngine.tokenCell(color,progress);
    if (!coords) return;
    const cell=boardEl.querySelector('[data-cell="'+coords[0]+'-'+coords[1]+'"]');
    if(!cell) return;
    if(cell.querySelector(".board-token")) cell.classList.add("token-pile");
    const token=document.createElement("button");
    token.type="button"; token.className="board-token token-"+color+(movable?" movable":"");
    token.textContent=String(tokenIndex+1); token.dataset.playerIndex=String(playerIndex);
    token.dataset.tokenIndex=String(tokenIndex);
    token.setAttribute("aria-label",color+" token "+(tokenIndex+1)+(movable?", move token":""));
    token.disabled=!movable;
    cell.appendChild(token);
  }
  function renderGame() {
    if (!gameState) return;
    buildBoard();
    gameState.players.forEach((player,pi)=>player.tokens.forEach((progress,ti)=>{
      addToken(player.color,pi,ti,progress,pi===gameState.currentPlayer&&player.type==="human"&&gameState.legalMoves.includes(ti));
    }));
    const displayOrder=["red","green","blue","yellow"];
    document.querySelectorAll(".mini-player").forEach((el,i)=>{
      const color=displayOrder[i], player=gameState.players.find(p=>p.color===color);
      if(!player) return;
      el.querySelector("b").textContent=player.name;
      el.querySelector("small").textContent=player.tokens.filter(t=>t===LudoEngine.FINISH).length+"/4 home";
      el.classList.toggle("is-turn",gameState.status==="playing"&&player===gameState.players[gameState.currentPlayer]);
    });
    const player=gameState.players[gameState.currentPlayer];
    document.getElementById("turn-label").textContent=gameState.status==="finished"
      ? (gameState.players.find(p=>p.id===gameState.winner)?.name||"Winner")+" wins!"
      : player.name+"'s turn";
    document.getElementById("turn-help").textContent=gameState.status==="finished"?"Match complete":gameState.dice!==null
      ? "Dice: "+gameState.dice+" · Select a glowing token":"Roll the dice to continue";
    document.getElementById("dice-face").textContent=gameState.dice?faces[gameState.dice]:(gameState.lastHumanRoll?faces[gameState.lastHumanRoll]:"🎲");
    document.getElementById("roll-dice").disabled=gameBusy||gameState.status!=="playing"||player.type!=="human"||gameState.dice!==null;
    document.getElementById("game-status").textContent=gameState.status==="finished"?"✦ COMPLETE":"✦ LIVE MATCH";
    document.getElementById("game-message").textContent=gameState.lastAction||"Your move";
  }
  async function startSolo() {
    if(gameBusy) return;
    if(!initData){toast("Please open the game from Telegram to start a match.");return;}
    gameBusy=true;document.getElementById("start-solo").disabled=true;
    try {
      const result=await api("/api/game/solo",{difficulty:document.getElementById("ai-difficulty").value});
      gameState=result.state;renderGame();showScreen("board");toast("Your solo match is ready!");
    } catch(error){toast(error.message);}
    finally{gameBusy=false;document.getElementById("start-solo").disabled=false;if(gameState)renderGame();}
  }
  async function rollDice() {
    if(!gameState||gameBusy)return;
    gameBusy=true;
    const diceFace=document.getElementById("dice-face");
    const gameMessage=document.getElementById("game-message");
    document.getElementById("roll-dice").disabled=true;
    diceFace.textContent="…";
    gameMessage.textContent="Rolling dice…";
    try {
      const result=await api("/api/game/"+encodeURIComponent(gameState.id)+"/roll");
      gameState=result.state;
      if(Number.isInteger(result.roll) && result.roll>=1 && result.roll<=6) {
        diceFace.textContent=faces[result.roll];
        gameMessage.textContent="You rolled "+result.roll+". "+(gameState.lastAction||"");
      }
      renderGame();
    } catch(error) {
      gameMessage.textContent="Dice roll failed: "+error.message;
      toast("Dice roll failed: "+error.message);
    } finally {
      gameBusy=false;
      renderGame();
    }
  }
  async function moveToken(tokenIndex) {
    if(!gameState||gameBusy)return;
    gameBusy=true;renderGame();
    try { const result=await api("/api/game/"+encodeURIComponent(gameState.id)+"/move",{tokenIndex});gameState=result.state;renderGame(); }
    catch(error){toast(error.message);}
    finally{gameBusy=false;renderGame();}
  }
  document.getElementById("start-solo").addEventListener("click",startSolo);
  document.getElementById("roll-dice").addEventListener("click",rollDice);
  document.getElementById("back-to-modes").addEventListener("click",()=>showScreen("play"));
  boardEl.addEventListener("click",event=>{
    const token=event.target.closest(".board-token");
    if(token&&!token.disabled) moveToken(Number(token.dataset.tokenIndex));
  });
  buildBoard();

  const defaults={sound:true,vibration:true,reduceMotion:false};
  let settings={...defaults};
  try{settings={...defaults,...JSON.parse(localStorage.getItem("ludoArenaSettings")||"{}")};}catch(_){}
  const sound=document.getElementById("sound-toggle"), vibration=document.getElementById("vibration-toggle"), motion=document.getElementById("motion-toggle");
  sound.checked=settings.sound;vibration.checked=settings.vibration;motion.checked=settings.reduceMotion;
  function saveSettings(){
    settings={sound:sound.checked,vibration:vibration.checked,reduceMotion:motion.checked};
    try{localStorage.setItem("ludoArenaSettings",JSON.stringify(settings));}catch(_){}
    document.documentElement.style.scrollBehavior=settings.reduceMotion?"auto":"smooth";toast("Settings saved");
  }
  [sound,vibration,motion].forEach(el=>el.addEventListener("change",saveSettings));
  document.getElementById("reset-settings").addEventListener("click",()=>{
    sound.checked=defaults.sound;vibration.checked=defaults.vibration;motion.checked=defaults.reduceMotion;saveSettings();
  });
  authenticate();
})();