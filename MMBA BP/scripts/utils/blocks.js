import { Direction } from "@minecraft/server";

export const PassableBlockRe = /(?:^|:)short_grass$|(?:^|:)tall_grass$|(?:^|:)grass$|air|water|lava|flower|double_plant|peony|rose_bush|lilac|sunflower|fern|vine|torch|snow_layer|sapling|bush|carpet|button|lever|sign|rail|redstone_wire|pressure_plate|tripwire|dead_bush|seagrass|kelp|light_block|structure_void/;


export function isLightBlock(block) {
    return Boolean(block?.typeId && block.typeId.includes("light_block"));
}


export function isPassableBlock(block, passableRe = PassableBlockRe) {
    if (!block || block.isAir || block.isLiquid) return true;
    return passableRe.test(block.typeId);
}


export function resolveBlockHitPoint(origin, dir, hit) {
    const b = hit.block;
    const bx = b.x, by = b.y, bz = b.z;
    if (
        origin.x >= bx && origin.x <= bx + 1 &&
        origin.y >= by && origin.y <= by + 1 &&
        origin.z >= bz && origin.z <= bz + 1
    ) {
        return { x: origin.x, y: origin.y, z: origin.z };
    }

    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const ux = dir.x / len, uy = dir.y / len, uz = dir.z / len;
    const invX = Math.abs(ux) > 1e-6 ? 1 / ux : null;
    const invY = Math.abs(uy) > 1e-6 ? 1 / uy : null;
    const invZ = Math.abs(uz) > 1e-6 ? 1 / uz : null;

    const tx1 = invX !== null ? (bx - origin.x) * invX : -Infinity;
    const tx2 = invX !== null ? (bx + 1 - origin.x) * invX : Infinity;
    const ty1 = invY !== null ? (by - origin.y) * invY : -Infinity;
    const ty2 = invY !== null ? (by + 1 - origin.y) * invY : Infinity;
    const tz1 = invZ !== null ? (bz - origin.z) * invZ : -Infinity;
    const tz2 = invZ !== null ? (bz + 1 - origin.z) * invZ : Infinity;

    const tmin = Math.max(
        invX !== null ? Math.min(tx1, tx2) : -Infinity,
        invY !== null ? Math.min(ty1, ty2) : -Infinity,
        invZ !== null ? Math.min(tz1, tz2) : -Infinity,
        0
    );

    const face = String(hit.face ?? "");
    const f = hit.faceLocation;
    let t = tmin;
    if ((face === "East" || face === "West") && f && f.x > 0.02 && f.x < 0.98 && invX !== null) {
        t = (bx + f.x - origin.x) * invX;
    } else if ((face === "Up" || face === "Down") && f && f.y > 0.02 && f.y < 0.98 && invY !== null) {
        t = (by + f.y - origin.y) * invY;
    } else if ((face === "South" || face === "North") && f && f.z > 0.02 && f.z < 0.98 && invZ !== null) {
        t = (bz + f.z - origin.z) * invZ;
    }
    if (!Number.isFinite(t) || t < 0) t = tmin;

    const pt = {
        x: Math.max(bx, Math.min(bx + 1, origin.x + ux * t)),
        y: Math.max(by, Math.min(by + 1, origin.y + uy * t)),
        z: Math.max(bz, Math.min(bz + 1, origin.z + uz * t)),
    };

    if (face === "East") pt.x = (f && f.x > 0.02 && f.x < 0.98) ? bx + f.x : bx + 1;
    else if (face === "West") pt.x = (f && f.x > 0.02 && f.x < 0.98) ? bx + f.x : bx;
    else if (face === "Up") pt.y = (f && f.y > 0.02 && f.y < 0.98) ? by + f.y : by + 1;
    else if (face === "Down") pt.y = (f && f.y > 0.02 && f.y < 0.98) ? by + f.y : by;
    else if (face === "South") pt.z = (f && f.z > 0.02 && f.z < 0.98) ? bz + f.z : bz + 1;
    else if (face === "North") pt.z = (f && f.z > 0.02 && f.z < 0.98) ? bz + f.z : bz;

    return pt;
}


export function raycastSolidBlock(dimension, origin, direction, maxDistance, options = {}) {
    if (!dimension || !origin || !direction || maxDistance <= 0) return null;
    const dirLen = Math.hypot(direction.x, direction.y, direction.z);
    if (dirLen <= 1e-6) return null;

    const dir = {
        x: direction.x / dirLen,
        y: direction.y / dirLen,
        z: direction.z / dirLen
    };
    const passableRe = options.passableRe ?? PassableBlockRe;
    const maxSkips = options.maxSkips ?? 32;

    let curOrigin = { x: origin.x, y: origin.y, z: origin.z };
    let traveled = 0;

    for (let i = 0; i < maxSkips; i++) {
        const remaining = maxDistance - traveled;
        if (remaining <= 0.001) return null;

        let hit = null;
        try {
            hit = dimension.getBlockFromRay(curOrigin, dir, {
                maxDistance: remaining,
                includeLiquidBlocks: false,
                includePassableBlocks: false
            });
        } catch {
            return null;
        }

        if (!hit?.block) return null;
        if (!isPassableBlock(hit.block, passableRe)) return hit;

        const bx = hit.block.x;
        const by = hit.block.y;
        const bz = hit.block.z;
        const entryPt = resolveBlockHitPoint(curOrigin, dir, hit);
        const hx = entryPt.x;
        const hy = entryPt.y;
        const hz = entryPt.z;

        const tx = dir.x > 1e-6 ? (bx + 1 - hx) / dir.x : (dir.x < -1e-6 ? (bx - hx) / dir.x : Infinity);
        const ty = dir.y > 1e-6 ? (by + 1 - hy) / dir.y : (dir.y < -1e-6 ? (by - hy) / dir.y : Infinity);
        const tz = dir.z > 1e-6 ? (bz + 1 - hz) / dir.z : (dir.z < -1e-6 ? (bz - hz) / dir.z : Infinity);

        const rawExit = Math.min(tx, ty, tz);
        const tExit = Number.isFinite(rawExit) ? Math.max(0, rawExit) : 0.05;

        const exitPt = {
            x: hx + dir.x * tExit,
            y: hy + dir.y * tExit,
            z: hz + dir.z * tExit
        };
        curOrigin = {
            x: exitPt.x + dir.x * 0.005,
            y: exitPt.y + dir.y * 0.005,
            z: exitPt.z + dir.z * 0.005
        };

        traveled = (curOrigin.x - origin.x) * dir.x + (curOrigin.y - origin.y) * dir.y + (curOrigin.z - origin.z) * dir.z;
        if (traveled > maxDistance) return null;

        try {
            const entered = dimension.getBlock(curOrigin);
            if (entered && !isPassableBlock(entered, passableRe)) {
                let face = Direction.Up;
                if (tx <= ty && tx <= tz) {
                    face = dir.x > 0 ? Direction.West : Direction.East;
                } else if (ty <= tz) {
                    face = dir.y > 0 ? Direction.Down : Direction.Up;
                } else {
                    face = dir.z > 0 ? Direction.North : Direction.South;
                }
                return {
                    block: entered,
                    face,
                    faceLocation: {
                        x: Math.max(0, Math.min(1, exitPt.x - entered.x)),
                        y: Math.max(0, Math.min(1, exitPt.y - entered.y)),
                        z: Math.max(0, Math.min(1, exitPt.z - entered.z))
                    }
                };
            }
        } catch { }
    }

    return null;
}
