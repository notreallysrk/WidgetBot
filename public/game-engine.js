/* Ludo Arena — deterministic rules engine (Phase 03)
 * Pure game rules. The server must own the authoritative state and dice roll.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LudoEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLORS = ["red", "green", "yellow", "blue"];
  const START = { red: 0, green: 13, yellow: 26, blue: 39 };
  const FINISH = 57;
  const TRACK = [
    [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],
    [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
    [14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],
    [8,0],[7,0],[6,0]
  ];
  const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function assertGame(game) {
    if (!game || !Array.isArray(game.players) || game.players.length !== 4 ||
        !COLORS.every((c, i) => game.players[i].color === c)) throw new Error("Invalid game state");
  }
  function createGame(players) {
    if (!Array.isArray(players) || players.length !== 4) throw new Error("A classic game requires four players");
    const normalized = players.map((p, i) => ({
      id: String(p.id || COLORS[i]), name: String(p.name || COLORS[i] + " player").slice(0, 32),
      color: COLORS[i], type: p.type === "ai" ? "ai" : "human",
      difficulty: ["easy","medium","hard"].includes(p.difficulty) ? p.difficulty : "medium",
      tokens: [-1,-1,-1,-1]
    }));
    return {
      version: 1, id: null, status: "playing", players: normalized,
      currentPlayer: 0, dice: null, legalMoves: [], consecutiveSixes: 0,
      winner: null, turnNumber: 1, lastAction: "Game started", createdAt: Date.now()
    };
  }
  function globalPosition(color, progress) {
    if (progress < 0 || progress >= 52) return null;
    return (START[color] + progress) % 52;
  }
  function legalMoves(game, roll) {
    assertGame(game);
    if (!Number.isInteger(roll) || roll < 1 || roll > 6) throw new Error("Dice value must be 1–6");
    const player = game.players[game.currentPlayer];
    return player.tokens.map((progress, token) => {
      if (progress === FINISH) return null;
      if (progress === -1) return roll === 6 ? token : null;
      return progress + roll <= FINISH ? token : null;
    }).filter(v => v !== null);
  }
  function rollDice(game, roll) {
    assertGame(game);
    if (game.status !== "playing" || game.dice !== null) throw new Error("It is not time to roll");
    if (!Number.isInteger(roll) || roll < 1 || roll > 6) throw new Error("Invalid dice value");
    const next = clone(game);
    if (roll === 6) next.consecutiveSixes += 1;
    else next.consecutiveSixes = 0;
    if (next.consecutiveSixes >= 3) {
      next.dice = null; next.legalMoves = []; next.consecutiveSixes = 0;
      next.lastAction = next.players[next.currentPlayer].name + " rolled three sixes — turn forfeited";
      next.currentPlayer = (next.currentPlayer + 1) % 4; next.turnNumber += 1;
      return next;
    }
    next.dice = roll;
    next.legalMoves = legalMoves(next, roll);
    next.lastAction = next.players[next.currentPlayer].name + " rolled " + roll;
    if (!next.legalMoves.length) {
      if (roll === 6) {
        next.dice = null; next.lastAction += " — no legal move, roll again";
      } else {
        next.dice = null; next.currentPlayer = (next.currentPlayer + 1) % 4;
        next.turnNumber += 1; next.lastAction += " — no legal move";
      }
    }
    return next;
  }
  function moveToken(game, tokenIndex) {
    assertGame(game);
    if (game.status !== "playing" || game.dice === null) throw new Error("Roll the dice first");
    if (!Number.isInteger(tokenIndex) || !game.legalMoves.includes(tokenIndex)) throw new Error("That token cannot move");
    const next = clone(game), player = next.players[next.currentPlayer], roll = next.dice;
    let progress = player.tokens[tokenIndex];
    progress = progress === -1 ? 0 : progress + roll;
    player.tokens[tokenIndex] = progress;
    let captured = [];
    const landed = globalPosition(player.color, progress);
    if (landed !== null && !SAFE_CELLS.has(landed)) {
      next.players.forEach((opponent, pi) => {
        if (pi === next.currentPlayer) return;
        opponent.tokens.forEach((op, ti) => {
          if (globalPosition(opponent.color, op) === landed) {
            opponent.tokens[ti] = -1;
            captured.push({ player: opponent.name, token: ti });
          }
        });
      });
    }
    const finished = progress === FINISH;
    const won = player.tokens.every(p => p === FINISH);
    next.dice = null; next.legalMoves = [];
    next.lastAction = player.name + " moved token " + (tokenIndex + 1) +
      (captured.length ? " and captured " + captured.length + " token(s)" : "") +
      (finished ? " home" : "");
    if (won) {
      next.status = "finished"; next.winner = player.id;
      next.lastAction = player.name + " won the match!";
    } else if (roll !== 6 && captured.length === 0 && !finished) {
      next.currentPlayer = (next.currentPlayer + 1) % 4; next.turnNumber += 1;
      next.consecutiveSixes = 0;
    } else {
      next.lastAction += " — extra turn";
    }
    return next;
  }
  function tokenCell(color, progress) {
    if (progress < 0 || progress === FINISH) return null;
    if (progress >= 52) {
      const lane = {
        red: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
        green: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
        yellow: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
        blue: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]]
      }[color];
      return lane[progress - 52] || null;
    }
    return TRACK[globalPosition(color, progress)];
  }
  function chooseAiMove(game) {
    assertGame(game);
    const moves = game.legalMoves;
    if (!moves.length) return null;
    const player = game.players[game.currentPlayer], roll = game.dice;
    const ranked = moves.map(index => {
      const old = player.tokens[index], nextProgress = old < 0 ? 0 : old + roll;
      const landing = globalPosition(player.color, nextProgress);
      let score = nextProgress;
      if (old < 0) score += 18;
      if (nextProgress === FINISH) score += 1000;
      if (landing !== null && !SAFE_CELLS.has(landing)) {
        const canCapture = game.players.some((p, pi) => pi !== game.currentPlayer &&
          p.tokens.some(t => globalPosition(p.color, t) === landing));
        if (canCapture) score += 80;
      }
      if (landing !== null && SAFE_CELLS.has(landing)) score += 12;
      if (player.difficulty === "easy") score = Math.random() * 100 + (nextProgress === FINISH ? 100 : 0);
      if (player.difficulty === "hard" && nextProgress >= 52) score += 35;
      return { index, score };
    }).sort((a,b) => b.score - a.score);
    return ranked[0].index;
  }
  function snapshot(game) {
    assertGame(game);
    return clone(game);
  }
  return Object.freeze({
    COLORS, START, TRACK, SAFE_CELLS, FINISH, createGame, rollDice,
    legalMoves, moveToken, tokenCell, chooseAiMove, snapshot
  });
});
