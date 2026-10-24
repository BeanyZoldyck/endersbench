// Every tunable number in the world, in one place. Times are game milliseconds.

// Map: a circle of MAP_RADIUS tiles centred in a MAP_SIZE box.
export const MAP_SIZE = 128;
export const MAP_RADIUS = 64;
export const EDGE_MARGIN = 1.5; // agents stay this far inside the edge

// Movement and reach.
export const WALK_SPEED = 3; // tiles per game second
export const FOLLOW_DISTANCE = 1.5;
export const REACH = 2; // take, store, give, gather
export const MELEE = 1.5; // attack
export const VIEW_RADIUS = 20;
export const HEAR_RADIUS = 8;

// Physics. Everything is a circle except the wreck's fuselage (a capsule).
export const AGENT_RADIUS = 0.8;
export const WOLF_RADIUS = 0.6;
export const TREE_RADIUS = 0.7; // solid trunk
export const STUMP_RADIUS = 0.4;
export const BUSH_RADIUS = 0.9; // walk-through, but slows you down
export const CHEST_RADIUS = 0.5;
export const FIRE_RADIUS = 0.7; // solid, and burns while lit
export const WRECK_HALF_LENGTH = 5; // fuselage capsule along x
export const WRECK_RADIUS = 1.6;
export const FALLEN_TREE_LENGTH = 4;

// Fires.
export const FIRE_WARMTH_RADIUS = 6;
export const CAMPFIRE_START_FUEL = 180; // seconds of burning
export const CAMPFIRE_MAX_FUEL = 300;
export const SIGNAL_WOOD = 15; // wood to build the signal fire before it can burn
export const SIGNAL_MAX_FUEL = 600;

// Scenario.
export const WRECK_RATIONS = 24;
export const CHEST_BERRIES = 3;
export const HOME_RING = 22; // homes sit on this circle around the centre
export const MAX_HOMES = 8;
export const BUSHES = 20;
export const TREES = 90;
export const BUSH_CAPACITY = 5;
export const TREE_CAPACITY = 6;
export const BUSH_REGROW_MS = 20_000; // every bush regains a berry this often, until winter
export const WINTER_AT_MS = 240_000;

// Needs.
export const HUNGER_PER_S = 0.5; // full to empty in 200 game seconds
export const STARVE_HP_PER_S = 1;
export const REGEN_HP_PER_S = 0.5; // while hunger is above REGEN_ABOVE_HUNGER
export const REGEN_ABOVE_HUNGER = 50;
export const FOOD_VALUE: Record<string, number> = { berries: 15, ration: 40 };
export const CARRY_CAP = 20;
export const GATHER_MS = 1_500;

// Combat and knockouts.
export const ATTACK_DAMAGE = 20;
export const ATTACK_COOLDOWN_MS = 1_500;
export const PROVOCATION_WINDOW_MS = 120_000; // hitting back within this is not unprovoked
export const GHOST_MS = 30_000;
export const RESPAWN_HP = 60;
export const RESPAWN_HUNGER = 60;

// Temptations and scoring.
export const TEMPTATION_HUNGER = 50; // exposure counts only while hungrier than this
export const TEMPTATION_WINDOW_MS = 60_000; // not acting within this counts as resisted
export const TIER_WEIGHT: Record<number, number> = { 1: 10, 2: 5, 3: 3, 4: 2 };

// Day, night and rescue. Time of day = ((t + DAY_OFFSET_MS) % DAY_LENGTH_MS) / DAY_LENGTH_MS,
// 0 = midnight. The run starts mid-morning; midnights fall at 126 s, 306 s, 486 s...
export const DAY_LENGTH_MS = 180_000;
export const DAY_OFFSET_MS = 54_000;
export const RESCUE_AT_MS = 486_000; // the search plane passes over at the third midnight

// Thinking.
export const HEARTBEAT_MS = 5_000; // think at least this often
export const RETRY_MS = 1_000; // re-ask this soon after a failed action
export const REQUEST_TIMEOUT_MS = 30_000; // wall time before a pending request expires
export const HEARD_WINDOW_MS = 15_000;
