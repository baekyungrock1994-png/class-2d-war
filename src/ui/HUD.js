import { WORLD_WIDTH, WEAPON_SLOTS, MEDKIT_SLOT } from "../utils/constants.js";

export class HUD {
  constructor() {
    this.root = document.getElementById("hud");
    this.healthFill = document.getElementById("health-bar-fill");
    this.healthText = document.getElementById("health-text");
    this.ammoText = document.getElementById("ammo-text");
    this.aliveText = document.getElementById("alive-text");
    this.zoneText = document.getElementById("zone-text");
    this.minimap = document.getElementById("minimap");
    this.minimapCtx = this.minimap.getContext("2d");
    this.medkitCountEl = document.getElementById("medkit-count");
    this.weaponSlotEls = WEAPON_SLOTS.map((s) => document.querySelector(`.inv-slot[data-slot="${s.slot}"]`));
    this.medkitSlotEl = document.querySelector(`.inv-slot[data-slot="${MEDKIT_SLOT.slot}"]`);
  }

  show() {
    this.root.classList.remove("hidden");
  }

  hide() {
    this.root.classList.add("hidden");
  }

  update(player, aliveCount, safeZone) {
    const pct = Math.max(0, player.health / player.maxHealth);
    this.healthFill.style.width = `${pct * 100}%`;
    this.healthText.textContent = Math.ceil(player.health);

    this.ammoText.textContent = player.weapon.melee
      ? `${player.weapon.name} · 무제한`
      : `${player.weapon.name} · ${player.mag} / ${player.reserveAmmo}`;
    this.aliveText.textContent = `생존자: ${aliveCount}`;

    const secs = Math.max(0, Math.ceil(safeZone.timeUntilNextShrinkMs() / 1000));
    this.zoneText.textContent = player.falling
      ? "낙하 중..."
      : safeZone.state === "shrink"
        ? "안전지대 축소 중!"
        : `안전지대 축소까지: ${secs}s`;

    this._updateInventory(player);
    this._drawMinimap(player, safeZone);
  }

  _updateInventory(player) {
    WEAPON_SLOTS.forEach((slotDef, i) => {
      const el = this.weaponSlotEls[i];
      if (!el) return;
      el.classList.toggle("owned", player.ownedWeapons.has(slotDef.weapon));
      el.classList.toggle("active", player.weaponKey === slotDef.weapon);
    });

    if (this.medkitSlotEl) {
      this.medkitSlotEl.classList.toggle("owned", player.medkitCount > 0);
    }
    if (this.medkitCountEl) {
      this.medkitCountEl.textContent = player.medkitCount;
    }
  }

  _drawMinimap(player, safeZone) {
    const ctx = this.minimapCtx;
    const size = this.minimap.width;
    ctx.clearRect(0, 0, size, size);

    const scale = size / WORLD_WIDTH;

    ctx.beginPath();
    ctx.arc(safeZone.centerX * scale, safeZone.centerY * scale, safeZone.currentRadius * scale, 0, Math.PI * 2);
    ctx.strokeStyle = "#7ec8ff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#3f8efc";
    ctx.beginPath();
    ctx.arc(player.x * scale, player.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
