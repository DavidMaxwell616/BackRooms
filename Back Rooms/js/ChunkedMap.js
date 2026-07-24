export function hash32(x) {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    x = x ^ (x >>> 16);
    return x | 0;
}
export function hash2i(x, y, seed = 1337) {
    return hash32(hash32((x | 0) + seed) ^ hash32((y | 0) - seed));
}
export function rand01FromI(i) { return ((i >>> 0) / 4294967296); }
export function rand01(x, y, seed = 1337) { return rand01FromI(hash2i(x, y, seed)); }
// Tile geometry:
// 0 = empty, 1 = full wall
// 2/3 = vertical half wall on the left/right side of the tile
// 4/5 = horizontal half wall on the top/bottom side of the tile
// 6 = open square hole in the floor
export const TILE = Object.freeze({
    EMPTY: 0,
    WALL: 1,
    HALF_VERTICAL_LEFT: 2,
    HALF_VERTICAL_RIGHT: 3,
    HALF_HORIZONTAL_TOP: 4,
    HALF_HORIZONTAL_BOTTOM: 5,
    HOLE: 6
});
export const HALF_WALL_THICKNESS = 0.25;
export const HOLE_INSET = 0.1;

const PREFABS = {
    HALL_NS: [
        "11111",
        "10001",
        "10001",
        "10001",
        "11111"
    ],
    HALL_EW: [
        "11111",
        "11111",
        "10001",
        "11111",
        "11111"
    ],
    CORNER_NE: [
        "11111",
        "10001",
        "10011",
        "11111",
        "11111"
    ],
    TJUNC_N: [
        "11111",
        "10001",
        "10001",
        "10001",
        "11111"
    ],
    CROSS: [
        "11111",
        "10001",
        "10001",
        "10001",
        "11111"
    ],
    ROOM: [
        "11111",
        "10001",
        "10101",
        "10001",
        "11111"
    ]
};

export function prefabToCells(p) {
    return p.map(r => r.split('').map(c => c === '1' ? 1 : 0));
}

export class ChunkedMap {
    constructor(opts = {}) {
        this.chunkSize = opts.chunkSize ?? 24;
        this.keepRadius = opts.keepRadius ?? 3;
        this.seed = opts.seed ?? 1337;

        this.cache = new Map(); // key -> { data: Uint8Array, touched: number }
        this.roomCache = new Map();
        this.exitLocation = null;
        this.tick = 0;

        // knobs
        this.wallFill = 0.72;     // lower -> more open
        this.pillarChance = 0.08; // higher -> more clutter
    }

    /* =========================================================
       Chunked infinite map (cell grid)
    ========================================================= */
    key(cx, cy) { return cx + "," + cy; }

    worldToChunkCell(wx, wy) {
        const cs = this.chunkSize;
        const cx = Math.floor(wx / cs);
        const cy = Math.floor(wy / cs);
        let lx = wx - cx * cs;
        let ly = wy - cy * cs;
        lx = ((lx % cs) + cs) % cs;
        ly = ((ly % cs) + cs) % cs;
        return { cx, cy, lx: lx | 0, ly: ly | 0 };
    }

    ensureAround(posX, posY) {
        this.tick++;
        const cs = this.chunkSize;
        const pcx = Math.floor(posX / cs);
        const pcy = Math.floor(posY / cs);

        for (let dy = -this.keepRadius; dy <= this.keepRadius; dy++) {
            for (let dx = -this.keepRadius; dx <= this.keepRadius; dx++) {
                const cx = pcx + dx, cy = pcy + dy;
                const k = this.key(cx, cy);
                if (!this.cache.has(k)) {
                    this.cache.set(k, { data: this.generateChunk(cx, cy), touched: this.tick });
                } else {
                    this.cache.get(k).touched = this.tick;
                }
            }
        }

        // evict far
        for (const [k, v] of this.cache) {
            if (this.tick - v.touched > 3) this.cache.delete(k);
        }
    }

    getCell(wx, wy) {
        const tile = this.getTile(wx, wy);
        return tile === TILE.EMPTY || tile === TILE.HOLE ? 0 : 1;
    }

    getTile(wx, wy) {
        const { cx, cy, lx, ly } = this.worldToChunkCell(wx, wy);
        const k = this.key(cx, cy);
        let chunk = this.cache.get(k);
        if (!chunk) {
            chunk = { data: this.generateChunk(cx, cy), touched: this.tick };
            this.cache.set(k, chunk);
        }
        return chunk.data[ly * this.chunkSize + lx];
    }

    isSolidAt(wx, wy) {
        const cellX = Math.floor(wx);
        const cellY = Math.floor(wy);
        const tile = this.getTile(cellX, cellY);
        if (tile === TILE.EMPTY || tile === TILE.HOLE) return false;
        if (tile === TILE.WALL) return true;

        const localX = wx - cellX;
        const localY = wy - cellY;
        switch (tile) {
            case TILE.HALF_VERTICAL_LEFT: return localX < HALF_WALL_THICKNESS;
            case TILE.HALF_VERTICAL_RIGHT: return localX >= 1 - HALF_WALL_THICKNESS;
            case TILE.HALF_HORIZONTAL_TOP: return localY < HALF_WALL_THICKNESS;
            case TILE.HALF_HORIZONTAL_BOTTOM: return localY >= 1 - HALF_WALL_THICKNESS;
            default: return false;
        }
    }

    isHoleAt(wx, wy, inset = HOLE_INSET) {
        const cellX = Math.floor(wx);
        const cellY = Math.floor(wy);
        if (this.getTile(cellX, cellY) !== TILE.HOLE) return false;
        const localX = wx - cellX;
        const localY = wy - cellY;
        return localX >= inset && localX <= 1 - inset &&
            localY >= inset && localY <= 1 - inset;
    }

    getExit() {
        if (this.exitLocation) return this.exitLocation;

        const directions = [
            [1, 0], [1, 1], [0, 1], [-1, 1],
            [-1, 0], [-1, -1], [0, -1], [1, -1]
        ];
        const exitHash = hash32(this.seed ^ 0x45584954);
        const [directionX, directionY] = directions[(exitHash >>> 0) % directions.length];
        const distance = 2 + ((exitHash >>> 5) & 1);
        const chunkX = directionX * distance;
        const chunkY = directionY * distance;
        const rooms = this.getLargeRooms(chunkX, chunkY);
        const room = rooms[(exitHash >>> 8) % rooms.length];
        const candidates = [
            [
                Math.floor((room.left + room.right) * 0.5) + 0.5,
                Math.floor((room.top + room.bottom) * 0.5) + 0.5
            ],
            [room.left + 1.5, room.top + 1.5],
            [room.right - 0.5, room.bottom - 0.5]
        ];

        let localX = (this.chunkSize / 2 | 0) + 0.5;
        let localY = (this.chunkSize / 2 | 0) + 0.5;
        for (const [candidateX, candidateY] of candidates) {
            const worldX = chunkX * this.chunkSize + candidateX;
            const worldY = chunkY * this.chunkSize + candidateY;
            if (!this.isSolidAt(worldX, worldY) && !this.isHoleAt(worldX, worldY)) {
                localX = candidateX;
                localY = candidateY;
                break;
            }
        }

        this.exitLocation = {
            x: chunkX * this.chunkSize + localX,
            y: chunkY * this.chunkSize + localY,
            chunkX,
            chunkY
        };
        return this.exitLocation;
    }

    isExitAt(wx, wy, radius = 0.62) {
        const exit = this.getExit();
        return Math.hypot(wx - exit.x, wy - exit.y) <= radius;
    }

    getExitSignsAround(posX, posY, radius = 34) {
        const cs = this.chunkSize;
        const minChunkX = Math.floor((posX - radius) / cs);
        const maxChunkX = Math.floor((posX + radius) / cs);
        const minChunkY = Math.floor((posY - radius) / cs);
        const maxChunkY = Math.floor((posY + radius) / cs);
        const exit = this.getExit();
        const signs = [];

        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
            for (let cx = minChunkX; cx <= maxChunkX; cx++) {
                const signHash = hash2i(cx, cy, this.seed ^ 0x5349474E);
                const offset = 2 + ((signHash >>> 8) % (cs - 4));
                const vertical = (signHash & 1) === 0;
                const localX = vertical ? (cs / 2 | 0) + 0.5 : offset + 0.5;
                const localY = vertical ? offset + 0.5 : (cs / 2 | 0) + 0.5;
                const x = cx * cs + localX;
                const y = cy * cs + localY;

                if (Math.hypot(x - posX, y - posY) > radius) continue;
                if (Math.hypot(x - exit.x, y - exit.y) < 2) continue;
                if (this.isSolidAt(x, y) || this.isHoleAt(x, y)) continue;
                signs.push({
                    id: `${cx},${cy}:exit-sign`,
                    x, y,
                    targetX: exit.x,
                    targetY: exit.y,
                    scale: 0.95
                });
            }
        }
        return signs;
    }

    getLargeRooms(cx, cy) {
        const cacheKey = this.key(cx, cy);
        const cached = this.roomCache.get(cacheKey);
        if (cached) return cached;

        const cs = this.chunkSize;
        const cell = 5;
        const gridW = Math.floor(cs / cell);
        const gridH = Math.floor(cs / cell);
        const seed = hash2i(cx, cy, this.seed);
        const rng = (n) => rand01FromI(hash32(seed ^ n));
        const rooms = [];
        const roomCount = 1 + (rng(0x4C415247) < 0.22 ? 1 : 0);

        for (let roomIndex = 0; roomIndex < roomCount; roomIndex++) {
            const roomSeed = 0x524F4F4D ^ Math.imul(roomIndex + 1, 0x45d9f3b);
            const horizontal = rng(roomSeed) < 0.5;
            const spanW = horizontal ? Math.min(3, gridW) : Math.min(2, gridW);
            const spanH = horizontal ? Math.min(2, gridH) : Math.min(3, gridH);
            const maxGridX = Math.max(0, gridW - spanW);
            const maxGridY = Math.max(0, gridH - spanH);
            const roomGridX = Math.floor(rng(roomSeed ^ 0x13579BDF) * (maxGridX + 1));
            const roomGridY = Math.floor(rng(roomSeed ^ 0x2468ACE0) * (maxGridY + 1));

            rooms.push({
                left: roomGridX * cell + 1,
                top: roomGridY * cell + 1,
                right: Math.min(cs - 2, (roomGridX + spanW) * cell - 2),
                bottom: Math.min(cs - 2, (roomGridY + spanH) * cell - 2),
                horizontal,
                type: rng(roomSeed ^ 0x0FF1CE1A) < 0.52 ? 'office' : 'lab',
                index: roomIndex
            });
        }
        if (this.roomCache.size > 512) this.roomCache.clear();
        this.roomCache.set(cacheKey, rooms);
        return rooms;
    }

    isInLargeRoom(wx, wy, margin = 0) {
        const { cx, cy, lx, ly } = this.worldToChunkCell(wx, wy);
        return this.getLargeRooms(cx, cy).some(room =>
            lx >= room.left - margin && lx <= room.right + margin &&
            ly >= room.top - margin && ly <= room.bottom + margin
        );
    }

    getDecorationsAround(posX, posY, radius = 26) {
        const cs = this.chunkSize;
        const minChunkX = Math.floor((posX - radius) / cs);
        const maxChunkX = Math.floor((posX + radius) / cs);
        const minChunkY = Math.floor((posY - radius) / cs);
        const maxChunkY = Math.floor((posY + radius) / cs);
        const exit = this.getExit();
        const decorations = [];

        for (let cy = minChunkY; cy <= maxChunkY; cy++) {
            for (let cx = minChunkX; cx <= maxChunkX; cx++) {
                for (const room of this.getLargeRooms(cx, cy)) {
                    const count = room.type === 'office' ? 3 : 2;
                    for (let item = 0; item < count; item++) {
                        const t = (item + 1) / (count + 1);
                        const centerX = (room.left + room.right + 1) * 0.5;
                        const centerY = (room.top + room.bottom + 1) * 0.5;
                        const localX = room.horizontal
                            ? (room.left + 1.5) + (room.right - room.left - 2) * t
                            : centerX + (item % 2 === 0 ? -0.75 : 0.75);
                        const localY = room.horizontal
                            ? centerY + (item % 2 === 0 ? -0.65 : 0.65)
                            : (room.top + 1.5) + (room.bottom - room.top - 2) * t;
                        const x = cx * cs + localX;
                        const y = cy * cs + localY;
                        if (Math.hypot(x - exit.x, y - exit.y) < 1.35) continue;
                        if (Math.hypot(x - posX, y - posY) <= radius + 3) {
                            decorations.push({
                                id: `${cx},${cy}:${room.index}:${item}`,
                                x, y,
                                type: room.type,
                                radius: room.type === 'office' ? 0.72 : 0.82,
                                scale: room.type === 'office' ? 0.72 : 0.78
                            });
                        }
                    }
                }
            }
        }
        return decorations;
    }

    generateChunk(cx, cy) {
        const cs = this.chunkSize;
        const data = new Uint8Array(cs * cs);
        data.fill(1); // start solid

        const seed = hash2i(cx, cy, this.seed);
        const rng = (n) => rand01FromI(hash32(seed ^ n));

        // grid of prefab placements
        const cell = 5; // prefab size
        const gridW = Math.floor(cs / cell);
        const gridH = Math.floor(cs / cell);

        //const prefabKeys = Object.keys(PREFABS);
        const prefabKeys = ["HALL_NS", "HALL_EW", "CORNER_NE", "ROOM"];
        //const prefabKeys = ["CORNER_NE", "TJUNC_N", "CROSS"];

        for (let gy = 0; gy < gridH; gy++) {
            for (let gx = 0; gx < gridW; gx++) {

                // pick prefab deterministically
                const pick = prefabKeys[
                    (hash32(seed ^ (gx * 73856093 ^ gy * 19349663)) >>> 0) % prefabKeys.length
                ];

                const prefab = prefabToCells(PREFABS[pick]);

                // paste prefab into chunk
                for (let py = 0; py < cell; py++) {
                    for (let px = 0; px < cell; px++) {
                        const wx = gx * cell + px;
                        const wy = gy * cell + py;
                        if (wx < cs && wy < cs) {
                            data[wy * cs + wx] = prefab[py][px];
                        }
                    }
                }
            }
        }

        const carveHorizontal = (y, fromX, toX) => {
            const start = Math.max(0, Math.min(fromX, toX));
            const end = Math.min(cs - 1, Math.max(fromX, toX));
            for (let x = start; x <= end; x++) data[y * cs + x] = 0;
        };
        const carveVertical = (x, fromY, toY) => {
            const start = Math.max(0, Math.min(fromY, toY));
            const end = Math.min(cs - 1, Math.max(fromY, toY));
            for (let y = start; y <= end; y++) data[y * cs + x] = 0;
        };

        // Merge groups of prefab cells into broad open rooms. Their exterior
        // walls remain intact until the hallway pass below cuts entrances into
        // them, guaranteeing that each large room stays reachable.
        for (const room of this.getLargeRooms(cx, cy)) {
            for (let y = room.top; y <= room.bottom; y++) {
                carveHorizontal(y, room.left, room.right);
            }

            // Cut one doorway through a horizontal wall and one through a
            // vertical wall. Each opening is one tile wide and has no door.
            const roomSeed = hash32(seed ^ Math.imul(room.index + 1, 0x45d9f3b));
            const doorX = Math.min(
                room.right - 1,
                room.left + 1 + ((roomSeed >>> 0) % Math.max(1, room.right - room.left - 1))
            );
            const doorY = Math.min(
                room.bottom - 1,
                room.top + 1 + ((hash32(roomSeed ^ 0x444F4F52) >>> 0) %
                    Math.max(1, room.bottom - room.top - 1))
            );
            const opensTop = (roomSeed & 1) === 0;
            const opensLeft = (roomSeed & 2) === 0;
            const horizontalWallY = opensTop ? room.top - 1 : room.bottom + 1;
            const verticalWallX = opensLeft ? room.left - 1 : room.right + 1;
            carveVertical(
                doorX,
                opensTop ? horizontalWallY - 1 : horizontalWallY,
                opensTop ? horizontalWallY : horizontalWallY + 1
            );
            carveHorizontal(
                doorY,
                opensLeft ? verticalWallX - 1 : verticalWallX,
                opensLeft ? verticalWallX : verticalWallX + 1
            );
        }

        // Join every prefab cell with a continuous, snake-shaped hallway.
        // Cutting through each cell's center also opens prefabs whose doorway
        // orientation would otherwise leave them isolated from a neighbor.
        const firstCenterX = (cell / 2) | 0;
        const lastCenterX = (gridW - 1) * cell + firstCenterX;
        const firstCenterY = (cell / 2) | 0;
        for (let gy = 0; gy < gridH; gy++) {
            const centerY = gy * cell + firstCenterY;
            carveHorizontal(centerY, firstCenterX, lastCenterX);

            if (gy < gridH - 1) {
                const nextCenterY = (gy + 1) * cell + firstCenterY;
                const joinOnRight = ((gy + (seed & 1)) & 1) === 0;
                carveVertical(joinOnRight ? lastCenterX : firstCenterX, centerY, nextCenterY);
            }
        }

        // Every chunk uses the same centered edge portals, so hallways continue
        // seamlessly when the player crosses into any neighboring chunk.
        const mid = (cs / 2) | 0;
        carveHorizontal(mid, 0, cs - 1);
        carveVertical(mid, 0, cs - 1);

        // Turn selected exposed full-wall cells into half-tile walls. The
        // occupied half remains attached to its solid neighbor, preventing
        // isolated floating slivers while adding both wall orientations.
        const source = data.slice();
        const verticalCandidates = [];
        const horizontalCandidates = [];
        const sourceAt = (x, y) => source[y * cs + x];
        for (let y = 1; y < cs - 1; y++) {
            for (let x = 1; x < cs - 1; x++) {
                if (sourceAt(x, y) !== TILE.WALL) continue;

                const leftWall = sourceAt(x - 1, y) === TILE.WALL;
                const rightWall = sourceAt(x + 1, y) === TILE.WALL;
                const topWall = sourceAt(x, y - 1) === TILE.WALL;
                const bottomWall = sourceAt(x, y + 1) === TILE.WALL;

                if (leftWall !== rightWall) {
                    verticalCandidates.push({
                        x, y,
                        tile: leftWall ? TILE.HALF_VERTICAL_LEFT : TILE.HALF_VERTICAL_RIGHT
                    });
                }
                if (topWall !== bottomWall) {
                    horizontalCandidates.push({
                        x, y,
                        tile: topWall ? TILE.HALF_HORIZONTAL_TOP : TILE.HALF_HORIZONTAL_BOTTOM
                    });
                }
            }
        }

        const placeHalfWalls = (candidates, salt) => {
            candidates.sort((a, b) =>
                (hash32(seed ^ salt ^ (a.x * 73856093 ^ a.y * 19349663)) >>> 0) -
                (hash32(seed ^ salt ^ (b.x * 73856093 ^ b.y * 19349663)) >>> 0)
            );
            const count = Math.min(candidates.length, Math.max(1, Math.floor(candidates.length * 0.12)));
            let placed = 0;
            for (const candidate of candidates) {
                const index = candidate.y * cs + candidate.x;
                if (data[index] !== TILE.WALL) continue;
                data[index] = candidate.tile;
                if (++placed >= count) break;
            }
        };
        placeHalfWalls(verticalCandidates, 0x56455254);
        placeHalfWalls(horizontalCandidates, 0x484F5249);

        // Place one square floor opening in a clear corner of a large room.
        // Keeping a full floor tile around it makes the edge readable and
        // leaves enough room for the player to approach from every side.
        const holeCandidates = [];
        for (const room of this.getLargeRooms(cx, cy)) {
            const corners = [
                [room.left + 1, room.top + 1],
                [room.right - 1, room.top + 1],
                [room.right - 1, room.bottom - 1],
                [room.left + 1, room.bottom - 1]
            ];
            const start = hash32(seed ^ 0x484F4C45 ^ room.index) & 3;
            for (let offset = 0; offset < corners.length; offset++) {
                const [x, y] = corners[(start + offset) & 3];
                let clear = true;
                for (let oy = -1; oy <= 1 && clear; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        if (data[(y + oy) * cs + x + ox] !== TILE.EMPTY) {
                            clear = false;
                            break;
                        }
                    }
                }
                if (clear) {
                    holeCandidates.push({ x, y, roomIndex: room.index });
                    break;
                }
            }
        }
        if (holeCandidates.length) {
            const hole = holeCandidates[
                (hash32(seed ^ 0x0B07704D) >>> 0) % holeCandidates.length
            ];
            data[hole.y * cs + hole.x] = TILE.HOLE;
        }

        return data;
    }

}
