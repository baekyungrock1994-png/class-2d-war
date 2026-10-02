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

// How far outside the camera's edge a unit can still poke into view (name
// label above its head, weapon reach) before the per-frame draw loop skips
// it entirely. The map/loot renderers already cull this way (see GameMap.js,
// Loot.js) — this extends the same cheap camera check to units and bullets,
// which is where it matters most since their count scales with player count.
export const UNIT_CULL_MARGIN = 50;

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

// Crates are broken open by attacking them (any weapon, not just fists) —
// see Game.js's _tryBreakCrateNear — not stood-next-to-and-waited-out.
// CRATE_HP is deliberately divisible by each weapon's CRATE_DAMAGE_PER_HIT
// below so it pops on exactly the intended number of hits, no partial-hit
// ambiguity: fist 5, pistol 4, rifle 3, shotgun 2. A weapon's crate damage is
// its own separate number from its damage-to-units — shotgun's 6-pellet
// spread in particular makes per-pellet unit damage a bad fit for "2 shots
// breaks a crate", so this is resolved as one flat hit per trigger pull
// (see justAttacked) rather than simulating each pellet's own collision.
export const CRATE_HP = 60;
export const CRATE_DAMAGE_PER_HIT = { fist: 12, pistol: 15, rifle: 20, shotgun: 30 };
export const CRATE_MELEE_CONE_RADIANS = Math.PI / 2;
// A grenade landing within its normal damage radius destroys any crate there
// outright (one grenade = one crate, full stop), rather than chipping HP.

// "군사기지" (military base) POIs: high-value weapon/grenade loot, camo
// containers that hide like a bush, and a barbed-wire perimeter so the zone
// reads as visually distinct from open field. Two of these split the map so
// players don't all beeline for the same spot.
export const MILITARY_BASE_COUNT = 2;
export const MILITARY_BASE_RADIUS = 420;
export const MILITARY_BASE_MIN_SEPARATION = 1600; // keep the two bases apart
export const MILITARY_BASE_EDGE_MARGIN = 550; // keep bases off the world edge
export const MILITARY_CRATES_PER_BASE = 7;
export const MILITARY_CONTAINER_COUNT = 5; // standalone hide-capable containers per base
export const MILITARY_FENCE_POST_GAP = 46; // px between barbed-wire posts around the perimeter

// A bonus loot room reached through a single hatch on the surface, sitting
// directly beneath it — a small, fixed local offset in Y, not some far-off
// disconnected coordinate, so stepping in feels like "go underground right
// here" rather than teleporting somewhere unrecognizable. Walking back onto
// the same door (now the gap in the room's own ceiling) sends a unit back
// out to the exact surface spot they entered from.
//
// Its footprint is carved out of the rest of the map's generation (see
// GameMap.js) so nothing else overlaps it, but it otherwise shares the
// normal 0..WORLD_WIDTH/HEIGHT coordinate space with the surface — which
// means anything that resolves combat by distance/range (auto-aim, melee,
// bullets, grenades) has to also check both sides agree on inSpecialRoom,
// or a surface player standing near the door could reach into the room
// (and vice versa). Its safe-zone damage is judged by the door's own
// surface coordinates, not the room's, since being underground doesn't
// make the zone stop applying to you.
export const SPECIAL_ROOM_SIZE = 260; // square interior, in px
export const SPECIAL_ROOM_LOCAL_OFFSET_Y = 300; // how far below the door the room sits
export const SPECIAL_ROOM_WALL_THICKNESS = 24;
export const SPECIAL_ROOM_DOOR_GAP = 70; // opening in the room's ceiling, under the door
export const SPECIAL_ROOM_CRATE_COUNT = 6;
export const SPECIAL_ROOM_HATCH_RADIUS = 34; // walk within this of the door to trigger teleport
// Camera.follow()'s bounds override while inside the room — see Camera.js.
export const SPECIAL_ROOM_MARGIN = 60;

export const DROP_SELECT_TIMEOUT_SEC = 10;

export const DEATH_EFFECT_MS = 550;
export const DEATH_EFFECT_RADIUS = 64;
export const DEATH_EFFECT_DEBRIS_COUNT = 8;
export const DEATH_LOOT_SCATTER_RANGE = [16, 46]; // px from the death point
export const DEATH_MEDKIT_DROP_CAP = 3;

// Every hold/shrink duration doubled from the original pacing so a match
// takes roughly twice as long to play out.
export const ZONE_PHASES = [
  { holdMs: 24000, shrinkMs: 28000, radiusRatio: 1.0 },
  { holdMs: 20000, shrinkMs: 24000, radiusRatio: 0.68 },
  { holdMs: 18000, shrinkMs: 20000, radiusRatio: 0.45 },
  { holdMs: 16000, shrinkMs: 18000, radiusRatio: 0.28 },
  { holdMs: 14000, shrinkMs: 16000, radiusRatio: 0.15 },
  { holdMs: 12000, shrinkMs: 14000, radiusRatio: 0.06 },
  { holdMs: 10000, shrinkMs: 10000, radiusRatio: 0.0 },
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
export const HOST_STALE_MS = 10000; // no snapshot for this long => host presumed gone
export const HOST_WARN_MS = 3500; // show "waiting for host" banner if quiet this long

// Each snapshot broadcast fans out to every connected player.
export const SNAPSHOT_SEND_MS = 50; // base interval (20Hz)
export const SNAPSHOT_SCALE_START_PLAYERS = 4; // real players (host + guests) before backing off
export const SNAPSHOT_SEND_MS_PER_EXTRA_PLAYER = 10; // added per player beyond the threshold
export const SNAPSHOT_SEND_MS_MAX = 100; // never back off further than this

// How fast a guest's rendered view of remote entities (bots, other players)
// eases toward each new snapshot value, instead of jumping straight to it.
export const REMOTE_SMOOTHING_PER_SEC = 16;
// If the host's reported position for the guest's own predicted player drifts
// past this, snap immediately instead of easing (avoids a slow "rubber-band").
export const RECONCILE_SNAP_DISTANCE = 140;
