// City layout constants. All distances are in metres.
// The playable city is a grid of GRID x GRID blocks separated by roads.

export const GRID = 8; // blocks per side
export const PITCH = 80; // distance between road centre lines
export const ROAD_HALF = 8; // half the road width (two lanes each way)
export const SIDEWALK = 4; // pavement width around each block
export const HALF = (GRID * PITCH) / 2; // 320: outermost road centre line
export const CURB_H = 0.15; // pavement height above the road

// Road centre lines (both axes use the same values)
export const ROAD_LINES = Array.from({ length: GRID + 1 }, (_, i) => -HALF + i * PITCH);

// South of the city is the waterfront
export const BOARDWALK_Z0 = HALF + ROAD_HALF + SIDEWALK; // 332
export const SAND_Z0 = BOARDWALK_Z0 + 8; // 340
export const SHORE_Z = 398;

// Hard limits of the playable area
export const BOUNDS = { minX: -342, maxX: 342, minZ: -342, maxZ: SHORE_Z };

export const SEED = 1987;

export const CITY_NAME = 'Port Solano';
