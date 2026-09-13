import { Game } from "./core/Game.js";
import { DropSelect } from "./ui/DropSelect.js";

const canvas = document.getElementById("game-canvas");
const startScreen = document.getElementById("start-screen");
const endScreen = document.getElementById("end-screen");
const endTitle = document.getElementById("end-title");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");

const game = new Game(canvas);
if (import.meta.env.DEV) window.__game = game; // debug hook for inspecting live state from the console

const dropSelect = new DropSelect();
dropSelect.onConfirm((x, y) => {
  dropSelect.close();
  game.beginDrop(x, y);
});

game.onGameOver = (didWin) => {
  endTitle.textContent = didWin ? "🏆 우승! 치킨 획득!" : "💀 사망";
  endScreen.classList.remove("hidden");
};

function openDropSelect() {
  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  game.prepareMatch();
  dropSelect.open(game.map, game.safeZone);
}

startBtn.addEventListener("click", openDropSelect);
restartBtn.addEventListener("click", openDropSelect);
