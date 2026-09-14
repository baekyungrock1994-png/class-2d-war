import { Game } from "./core/Game.js";
import { GuestView } from "./core/GuestView.js";
import { DropSelect } from "./ui/DropSelect.js";
import { Lobby } from "./ui/Lobby.js";
import { RoomService } from "./network/RoomService.js";
import { getUid, getCurrentUser, onAuthChange, signInWithGoogle, signOutUser } from "./network/firebase.js";
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
const localDeathBanner = document.getElementById("local-death-banner");

const soloBtn = document.getElementById("solo-btn");
const onlineBtn = document.getElementById("online-btn");
const restartBtn = document.getElementById("restart-btn");
const endMenuBtn = document.getElementById("end-menu-btn");

const loginScreen = document.getElementById("login-screen");
const googleLoginBtn = document.getElementById("google-login-btn");
const loginBackBtn = document.getElementById("login-back-btn");
const loginErrorText = document.getElementById("login-error-text");
const userBadge = document.getElementById("user-badge");
const userNameText = document.getElementById("user-name-text");
const logoutBtn = document.getElementById("logout-btn");

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
  loginScreen.classList.add("hidden");
  lobby.hide();
  startScreen.classList.remove("hidden");
}

function showEndScreen(didWin) {
  localDeathBanner.classList.add("hidden");
  endTitle.textContent = didWin ? "🏆 우승! 치킨 획득!" : "💀 사망";
  const isSolo = matchMode === "solo";
  restartBtn.classList.toggle("hidden", !isSolo);
  endMenuBtn.classList.toggle("hidden", isSolo);
  endScreen.classList.remove("hidden");
}

// A simple "here's what happened, back to the menu" screen — reused for host
// disconnects and for the host kicking this player out of the lobby.
function showInfoScreen(title) {
  localDeathBanner.classList.add("hidden");
  endTitle.textContent = title;
  restartBtn.classList.add("hidden");
  endMenuBtn.classList.remove("hidden");
  endScreen.classList.remove("hidden");
}

// --- Login (Google) -----------------------------------------------------------

function updateUserBadge() {
  const user = getCurrentUser();
  if (user) {
    userNameText.textContent = user.displayName || "플레이어";
    userBadge.classList.remove("hidden");
  } else {
    userBadge.classList.add("hidden");
  }
}

onAuthChange(updateUserBadge);
updateUserBadge();

function showLoginScreen() {
  hideTransientScreens();
  startScreen.classList.add("hidden");
  loginErrorText.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}

googleLoginBtn.addEventListener("click", async () => {
  loginErrorText.classList.add("hidden");
  try {
    await signInWithGoogle();
    loginScreen.classList.add("hidden");
    lobby.showOnlineMenu();
  } catch (err) {
    loginErrorText.textContent = err.message || "로그인에 실패했습니다.";
    loginErrorText.classList.remove("hidden");
  }
});

loginBackBtn.addEventListener("click", () => showStart());

logoutBtn.addEventListener("click", async () => {
  if (roomService.roomId) await roomService.leaveRoom();
  await signOutUser();
  showStart();
});

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
restartBtn.addEventListener("click", startSoloMatch);

game.onGameOver = (didWin) => showEndScreen(didWin);
game.onLocalDeath = () => localDeathBanner.classList.remove("hidden");

// --- Online: host --------------------------------------------------------------

function startHostedMatch(botCount) {
  matchMode = "host";
  lobby.hide();
  game.prepareMatch(roomService, botCount);
  dropSelect.onConfirm((x, y) => {
    dropSelect.close();
    game.beginDrop(x, y);
  });
  dropSelect.open(game.map, game.safeZone);
}

// --- Online: guest ---------------------------------------------------------------

function startGuestFlow() {
  matchMode = "guest";
  const myUid = getUid();
  guestView = new GuestView(canvas, roomService, myUid);
  guestView.onGameOver = (didWin) => showEndScreen(didWin);
  guestView.onLocalDeath = () => localDeathBanner.classList.remove("hidden");
  guestView.onHostLost = () => showInfoScreen("🔌 호스트와 연결이 끊겼습니다");

  let mapReceived = false;
  roomService.onMap((mapData) => {
    if (mapReceived) return;
    mapReceived = true;
    guestView.setMap(mapData);

    dropSelect.onConfirm((x, y) => {
      dropSelect.close();
      roomService.requestDrop(x, y);
      guestView.beginLocalDrop(x, y);
    });
    dropSelect.open(mapData, FULL_MAP_ZONE);
  });
}

// --- Lobby wiring ------------------------------------------------------------------

onlineBtn.addEventListener("click", () => {
  if (getCurrentUser()) {
    startScreen.classList.add("hidden");
    lobby.showOnlineMenu();
  } else {
    showLoginScreen();
  }
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
