export const WORLD_WIDTH = 4000;
export const WORLD_HEIGHT = 4000;

export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 220; // px/sec
export const PLAYER_MAX_HEALTH = 100;

// Free-look camera speed once dead and spectating (WASD pans the view instead
// of moving a body — a bit faster than normal movement so scouting feels brisk).
export const SPECTATOR_SPEED = 340;

export const BOT_COUNT = 19; // + 1 human player = 20 total, like a small match

export const CAMERA_ZOOM = 1.8;

export const FALL_DURATION_MS = 3200;

export const WEAPONS = {
  fist: {
    name: "주먹",
    damage: 16,
    fireRateMs: 450,
    melee: true,
    range: 55,
  },
  pistol: {
    name: "권총",
    damage: 12,
    fireRateMs: 350,
    bulletSpeed: 900,
    magSize: 12,
    reserveAmmo: 36,
    spread: 0.05,
    range: 250, // px a bullet can travel before disappearing
  },
  rifle: {
    name: "돌격소총",
    damage: 20,
    fireRateMs: 140,
    bulletSpeed: 1300,
    magSize: 30,
    reserveAmmo: 90,
    spread: 0.03,
    range: 300,
  },
  shotgun: {
    name: "샷건",
    damage: 14,
    pellets: 6,
    fireRateMs: 800,
    bulletSpeed: 1000,
    magSize: 6,
    reserveAmmo: 18,
    spread: 0.18,
    range: 160, // pellets lose their punch fast — a close-range weapon
  },
};

export const BULLET_RADIUS = 3;
export const BULLET_LIFETIME_MS = 1500;

export const MELEE_SWING_MS = 220;

// Number-key inventory slots: 1-4 switch equipped weapon (if owned), 5 consumes a medkit.
export const WEAPON_SLOTS = [
  { slot: "1", code: "Digit1", weapon: "fist" },
  { slot: "2", code: "Digit2", weapon: "pistol" },
  { slot: "3", code: "Digit3", weapon: "rifle" },
  { slot: "4", code: "Digit4", weapon: "shotgun" },
];
export const MEDKIT_SLOT = { slot: "5", code: "Digit5" };
export const MEDKIT_HEAL_AMOUNT = 40;

// Most players on this game don't have a mouse, so aim is automatic (nearest
// visible enemy in range) and firing is a plain hold-to-shoot key.
export const AUTO_AIM_RANGE = 480;
export const FIRE_KEY_CODE = "Space";

// Throwing doesn't change the equipped weapon, so it's a standalone key
// rather than one of the WEAPON_SLOTS.
export const GRENADE_SLOT = { slot: "G", code: "KeyG" };
export const STARTING_GRENADE_COUNT = 1;
export const GRENADE_THROW_COOLDOWN_MS = 600;
export const GRENADE_THROW_DISTANCE = 260; // px, always thrown this far in the aim direction
export const GRENADE_FLIGHT_MS = 350; // time to travel from thrower to landing spot
export const GRENADE_FUSE_MS = 1000; // explodes this long after the throw, per the request
export const GRENADE_EXPLOSION_RADIUS = 110; // damage falls off linearly to 0 at this distance
export const GRENADE_MAX_DAMAGE = 85; // damage at the very center of the blast
export const GRENADE_EXPLOSION_VISUAL_RADIUS = 130;
export const GRENADE_EXPLOSION_EFFECT_MS = 700;
export const GRENADE_EXPLOSION_DEBRIS_COUNT = 16;

export const CRATE_INTERACT_RADIUS = 30;
export const CRATE_OPEN_MS = 2500;

export const DROP_SELECT_TIMEOUT_SEC = 10;

export const DEATH_EFFECT_MS = 550;
export const DEATH_EFFECT_RADIUS = 64;
export const DEATH_EFFECT_DEBRIS_COUNT = 8;
export const DEATH_LOOT_SCATTER_RANGE = [16, 46]; // px from the death point
export const DEATH_MEDKIT_DROP_CAP = 3;

export const ZONE_PHASES = [
  { holdMs: 12000, shrinkMs: 14000, radiusRatio: 1.0 },
  { holdMs: 10000, shrinkMs: 12000, radiusRatio: 0.68 },
  { holdMs: 9000, shrinkMs: 10000, radiusRatio: 0.45 },
  { holdMs: 8000, shrinkMs: 9000, radiusRatio: 0.28 },
  { holdMs: 7000, shrinkMs: 8000, radiusRatio: 0.15 },
  { holdMs: 6000, shrinkMs: 7000, radiusRatio: 0.06 },
  { holdMs: 5000, shrinkMs: 5000, radiusRatio: 0.0 },
];

export const ZONE_DAMAGE_PER_SEC = 4;

export const OBSTACLE_COUNT = 60;
export const LOOT_COUNT = 60;

export const BUSH_COUNT = 24;
export const BUSH_RADIUS_RANGE = [55, 90];
export const HIDDEN_REVEAL_RANGE = 70; // close enough to spot someone hiding in a bush anyway

export const CONTAINER_YARD_COUNT = 2;

// Online play (Firebase Realtime Database)
export const ONLINE_TOTAL_SLOTS = 10; // real players + bots filling the rest
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const INPUT_SEND_MS = 50; // guest -> host
export const HOST_STALE_MS = 4000; // no snapshot for this long => host presumed gone

// Each snapshot broadcast fans out to every connected player, and its payload
// grows with player/bot count — so total bandwidth scales roughly with the
// square of the room's headcount. Sending less often as more real players
// join keeps that from snowballing, at the cost of slightly choppier remote
// rendering (guests still smooth this out — see REMOTE_SMOOTHING_PER_SEC).
export const SNAPSHOT_SEND_MS = 70; // base interval, used at/below the scale threshold
export const SNAPSHOT_SCALE_START_PLAYERS = 4; // real players (host + guests) before backing off
export const SNAPSHOT_SEND_MS_PER_EXTRA_PLAYER = 15; // added per player beyond the threshold
export const SNAPSHOT_SEND_MS_MAX = 200; // never back off further than this

// How fast a guest's rendered view of remote entities (bots, other players,
// bullets) eases toward each new snapshot value, instead of jumping straight
// to it — smooths out the gaps between snapshots into a steady glide.
export const REMOTE_SMOOTHING_PER_SEC = 12;
// If the host's reported position for the guest's own predicted player drifts
// past this, snap immediately instead of easing (avoids a slow "rubber-band").
export const RECONCILE_SNAP_DISTANCE = 140;
