import { Game } from "./core/Game.js";
import { GuestView } from "./core/GuestView.js";
import { DropSelect } from "./ui/DropSelect.js";
import { Lobby } from "./ui/Lobby.js";
import { RoomService } from "./network/RoomService.js";
import { getUid } from "./network/firebase.js";
import { WORLD_WIDTH, WORLD_HEIGHT } from "./utils/constants.js";

const FULL_MAP_ZONE = {
  centerX: WORLD_WIDTH / 2,
  centerY: WORLD_HEIGHT / 2,
  currentRadius: Math.min(WORLD_WIDTH, WORLD_HEIGHT) / 2,
};

const canvas = document.getElementById("game-canvas");
const startScreen = document.getElementById("start-screen");
const endScreen = document.getElementById("end-screen");
const endTitle = document.getElementById("end-title");
const endStatsText = document.getElementById("end-stats-text");
const endLeaderboard = document.getElementById("end-leaderboard");
const localDeathBanner = document.getElementById("local-death-banner");

const soloBtn = document.getElementById("solo-btn");
const onlineBtn = document.getElementById("online-btn");
const restartBtn = document.getElementById("restart-btn");
const endMenuBtn = document.getElementById("end-menu-btn");

const game = new Game(canvas);
if (import.meta.env.DEV) window.__game = game; // debug hook for inspecting live state from the console

const dropSelect = new DropSelect();
const roomService = new RoomService();
const lobby = new Lobby(roomService);

let guestView = null; // active only while playing as a non-host client
let matchMode = "solo"; // "solo" | "host" | "guest" — drives end-screen/back-to-menu behavior

function hideTransientScreens() {
  localDeathBanner.classList.add("hidden");
  endScreen.classList.add("hidden");
}

function showStart() {
  hideTransientScreens();
  lobby.hide();
  startScreen.classList.remove("hidden");
}

// results: [{ name, kills, placement, isMe }], sorted by placement — see
// Game.js/GuestView.js's _buildResults(). Empty for a match that ended
// abnormally (e.g. host disconnect) rather than through a real finish.
function showEndScreen(didWin, results = []) {
  localDeathBanner.classList.add("hidden");
  endTitle.textContent = didWin ? "🏆 우승! 치킨 획득!" : "💀 사망";

  const me = results.find((r) => r.isMe);
  endStatsText.textContent = me ? `${me.placement}등 · 킬 ${me.kills}` : "";
  endStatsText.classList.toggle("hidden", !me);

  endLeaderboard.innerHTML = "";
  for (const r of results) {
    const li = document.createElement("li");
    if (r.isMe) li.classList.add("is-me");
    const rank = document.createElement("span");
    rank.textContent = `${r.placement}등 · ${r.name}`;
    const kills = document.createElement("span");
    kills.textContent = `킬 ${r.kills}`;
    li.append(rank, kills);
    endLeaderboard.appendChild(li);
  }
  endLeaderboard.classList.toggle("hidden", results.length <= 1);

  const canRestart = matchMode === "solo" || matchMode === "host";
  restartBtn.classList.toggle("hidden", !canRestart);
  endMenuBtn.classList.toggle("hidden", matchMode === "solo");
  endScreen.classList.remove("hidden");
}

// A simple "here's what happened, back to the menu" screen — reused for host
// disconnects and for the host kicking this player out of the lobby.
function showInfoScreen(title) {
  localDeathBanner.classList.add("hidden");
  endTitle.textContent = title;
  endStatsText.classList.add("hidden");
  endLeaderboard.classList.add("hidden");
  restartBtn.classList.add("hidden");
  endMenuBtn.classList.remove("hidden");
  endScreen.classList.remove("hidden");
}

// --- Solo (offline vs bots) --------------------------------------------------

function startSoloMatch() {
  matchMode = "solo";
  hideTransientScreens();
  startScreen.classList.add("hidden");
  game.prepareMatch();
  dropSelect.onConfirm((x, y) => {
    dropSelect.close();
    game.beginDrop(x, y);
  });
  dropSelect.open(game.map, game.safeZone);
}

soloBtn.addEventListener("click", startSoloMatch);

game.onGameOver = (didWin, results) => showEndScreen(didWin, results);
game.onLocalDeath = () => localDeathBanner.classList.remove("hidden");

// --- Online: host --------------------------------------------------------------

let lastHostBotCount = 0; // remembered so "다시하기" can restart with the same bot count

function startHostedMatch(botCount) {
  matchMode = "host";
  lastHostBotCount = botCount;
  lobby.hide();
  game.prepareMatch(roomService, botCount);
  dropSelect.onConfirm((x, y) => {
    dropSelect.close();
    game.beginDrop(x, y);
  });
  dropSelect.open(game.map, game.safeZone);
}

// "다시하기" for the host: re-runs the same match setup in the *same* room
// instead of tearing it down, so the room code and everyone already in the
// lobby/match stay put — startMatch() bumps the round marker (see
// RoomService.js), which is what pulls connected guests into the new round.
function restartHostedMatch() {
  startHostedMatch(lastHostBotCount);
}

restartBtn.addEventListener("click", () => {
  if (matchMode === "host") restartHostedMatch();
  else startSoloMatch();
});

// --- Online: guest ---------------------------------------------------------------

let lastSeenMatchRound = null; // guards against re-entering the round we're already in

// Runs once for the room's first match, and again every time the host
// restarts it (see RoomService.startMatch's `round` marker) — the listener
// set up in startGuestFlow() stays subscribed across rounds, so a restart
// pulls this player straight back into drop-select without them having to
// do anything.
function enterGuestRound(matchData) {
  matchMode = "guest";
  hideTransientScreens();
  if (guestView) guestView.destroy();

  const myUid = getUid();
  guestView = new GuestView(canvas, roomService, myUid);
  guestView.onGameOver = (didWin, results) => showEndScreen(didWin, results);
  guestView.onLocalDeath = () => localDeathBanner.classList.remove("hidden");
  guestView.onHostLost = () => showInfoScreen("🔌 호스트와 연결이 끊겼습니다");
  guestView.setMap(matchData.map);

  dropSelect.onConfirm((x, y) => {
    dropSelect.close();
    roomService.requestDrop(x, y);
    guestView.beginLocalDrop(x, y);
  });
  dropSelect.open(matchData.map, FULL_MAP_ZONE);
}

function startGuestFlow() {
  lastSeenMatchRound = null;
  roomService.onMatch((matchData) => {
    if (!matchData || matchData.round === lastSeenMatchRound) return;
    lastSeenMatchRound = matchData.round;
    enterGuestRound(matchData);
  });
}

// --- Lobby wiring ------------------------------------------------------------------

onlineBtn.addEventListener("click", () => {
  startScreen.classList.add("hidden");
  lobby.showOnlineMenu();
});

lobby.onLeave = () => showStart();
lobby.onStartMatch = (botCount) => startHostedMatch(botCount);
lobby.onKicked = () => showInfoScreen("🚫 호스트가 강퇴했습니다");
lobby.onMatchStarted = (isHost) => {
  hideTransientScreens();
  if (!isHost) startGuestFlow();
  // Host's own drop-select was already opened synchronously in startHostedMatch().
};

endMenuBtn.addEventListener("click", async () => {
  hideTransientScreens();
  if (guestView) {
    guestView.destroy();
    guestView = null;
  }
  await roomService.leaveRoom();
  showStart();
});
