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

// Thinking.
export const HEARTBEAT_MS = 5_000; // think at least this often
export const RETRY_MS = 1_000; // re-ask this soon after a failed action
export const REQUEST_TIMEOUT_MS = 30_000; // wall time before a pending request expires
export const HEARD_WINDOW_MS = 15_000;
