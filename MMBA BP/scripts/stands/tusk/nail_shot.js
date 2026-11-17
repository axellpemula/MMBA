import { world, system, MolangVariableMap } from "@minecraft/server";
import { applyHitscanDamage } from "../../damage/damage.js";
import { getSpecial, setSpecial, setSpecialCooldown } from "../../energy.js";
import { triggerTuskSpinCooldown } from "../special/spin.js";
import { Colors, buildBasis, spawnVFX, spawnImpactRing, spawnStarburst, spawnGlowFlash, spawnConeSparks } from "../../utils/vfx.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { raycastSolidBlock } from "../../utils/blocks.js";
import { consumeNails } from "./tusk.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "../tim/timHitboxState.js";


export function consumeSpinNailBuff(player, maxCap = 20, applyCooldown = true) {
    if (!player?.isValid) return 1.0;
    if (applyCooldown) triggerTuskSpinCooldown(player);
    const avail = Math.max(0, getSpecial(player));
    if (avail <= 0) return 1.0;
    const used = Math.min(avail, maxCap);
    setSpecial(player, avail - used);
    setSpecialCooldown(player, 20);
    return 1 + used * 0.01;
}

const NailEntity = "jjba:nail";
const ExcludeTypes = new Set([
    "minecraft:item", "minecraft:xp_orb", "minecraft:arrow",
    "minecraft:armor_stand", "xvoid:dmg", "jjba:steelball", "jjba:knife", "jjba:nail"
]);

const ActConfig = {
    1: {
        damage: 5.5,
        range: 26,
        speed: 3.75,
        color: Colors.cyan,
        bleed: false,
        wormhole: "none",
        kb: { barrage: true, barragePush: 1, barrageDown: 0 },
    },
    2: {
        damage: 9.5,
        range: 28,
        speed: 4.75,
        color: Colors.gold,
        bleed: false,
        wormhole: "hunt",
        kb: { barrage: true, barragePush: 1, barrageDown: 0 },
    },
    3: {
        damage: 6.5,
        range: 28,
        speed: 3.75,
        color: Colors.blue,
        bleed: false,
        wormhole: "trap",
        kb: { barrage: true, barragePush: 1, barrageDown: 0 },
    },
};

const TrailParticles = {
    0: "nail:trail_act1",
    1: "nail:trail_act2",
    2: "nail:trail_act3",
    3: "nail:trail_drill",
};

const activeNails = [];
const activeWormholes = [];
const MaxWormholesPerPlayer = 4;
let primaryOverrideFn = null;


system.runTimeout(() => {
    const activeIds = new Set(activeNails.map((b) => b.entity?.id).filter(Boolean));
    for (const dimId of ["overworld", "nether", "the_end"]) {
        try {
            const dim = world.getDimension(dimId);
            for (const e of dim.getEntities({ type: NailEntity })) {
                if (!activeIds.has(e.id)) {
                    try { e.triggerEvent("jjba:despawn"); } catch { }
                    try { if (e.isValid) e.remove(); } catch { }
                }
            }
        } catch { }
    }
}, 5);

export function registerPrimaryOverride(fn) {
    primaryOverrideFn = fn;
}

function getScore(player, obj) {
    try { return world.scoreboard.getObjective(obj)?.getScore(player) ?? 0; } catch { return 0; }
}

function safeNormal(n) {
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    const ux = n.x / l, uy = n.y / l, uz = n.z / l;
    if (Math.hypot(ux, uz) < 0.025) {
        return { x: 0.025, y: uy, z: 0.025 };
    }
    return { x: ux, y: uy, z: uz };
}

function faceToNormal(face) {
    switch (String(face).toLowerCase()) {
        case "up": return { x: 0, y: 1, z: 0 };
        case "down": return { x: 0, y: -1, z: 0 };
        case "north": return { x: 0, y: 0, z: -1 };
        case "south": return { x: 0, y: 0, z: 1 };
        case "west": return { x: -1, y: 0, z: 0 };
        case "east": return { x: 1, y: 0, z: 0 };
        default: return { x: 0, y: 1, z: 0 };
    }
}

export function isJohnnyCrawling(player) {
    try {
        if (player.getProperty("property:stand") !== 1) return false;
        const act = player.getProperty("property:act");
        if (act !== 0 && act !== 1 && act !== 2) return false;
        if (player.getComponent("minecraft:riding") !== undefined) return false;
        if (player.isGliding || player.isSwimming || player.isClimbing) return false;
        return true;
    } catch {
        return false;
    }
}

export function getTuskShootOrigin(player) {
    const head = player.getHeadLocation();
    if (isJohnnyCrawling(player)) {
        return { x: head.x, y: head.y - 0.82, z: head.z };
    }
    return head;
}

function isValidTarget(e, ownerId) {
    if (!e?.isValid || e.id === ownerId) return false;
    if (ExcludeTypes.has(e.typeId)) return false;
    if (e.hasTag("tusk_rotation") || e.hasTag("tusk_decoy")) return false;
    if (isOwnTimHitbox(ownerId, e)) return false;
    const resolved = e.typeId === TimHitboxType ? getTimHitboxOwner(e) : e;
    if (!resolved?.isValid || resolved.id === ownerId) return false;
    try {
        const hp = resolved.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) return false;
    } catch {
        return false;
    }
    return true;
}

export function spawnWormholeSpiral(dim, pos, normal, {
    radius = 0.85,
    life = 0.45,
    turn = 0,
    spin = 260,
    rim = { x: 1.0, y: 0.85, z: 0.25 },
    alpha = 0.92
} = {}) {
    if (!dim || !pos) return;
    try {
        const n = safeNormal(normal);
        const vars = new MolangVariableMap();
        vars.setFloat("variable.nx", n.x);
        vars.setFloat("variable.ny", n.y);
        vars.setFloat("variable.nz", n.z);
        vars.setFloat("variable.radius", radius);
        vars.setFloat("variable.life", life);
        vars.setFloat("variable.turn", turn);
        vars.setFloat("variable.spin", spin);
        vars.setFloat("variable.cr", rim.x);
        vars.setFloat("variable.cg", rim.y);
        vars.setFloat("variable.cb", rim.z);
        vars.setFloat("variable.alpha", alpha);
        dim.spawnParticle("tusk:wormhole_spiral", pos, vars);
    } catch { }
}

export function spawnPursuitWormhole(dim, pos, {
    radius = 0.13,
    life = 0.20,
    turn = 0,
    spin = 420,
    rim = { x: 1.0, y: 0.86, z: 0.22 },
    alpha = 0.96
} = {}) {
    if (!dim || !pos) return;
    try {
        const vars = new MolangVariableMap();
        vars.setFloat("variable.radius", radius);
        vars.setFloat("variable.life", life);
        vars.setFloat("variable.turn", turn);
        vars.setFloat("variable.spin", spin);
        vars.setFloat("variable.cr", rim.x);
        vars.setFloat("variable.cg", rim.y);
        vars.setFloat("variable.cb", rim.z);
        vars.setFloat("variable.alpha", alpha);
        dim.spawnParticle("tusk:wormhole_pursuit", pos, vars);
    } catch { }
}

export function spawnGoldenRatioVFX(dim, pos, normal, {
    size = 1.6,
    life = 0.55,
    turn = 0,
    spin = 80,
    alpha = 0.9
} = {}) {
    if (!dim || !pos) return;
    try {
        const n = safeNormal(normal);
        const vars = new MolangVariableMap();
        vars.setFloat("variable.nx", n.x);
        vars.setFloat("variable.ny", n.y);
        vars.setFloat("variable.nz", n.z);
        vars.setFloat("variable.size", size);
        vars.setFloat("variable.life", life);
        vars.setFloat("variable.turn", turn);
        vars.setFloat("variable.spin", spin);
        vars.setFloat("variable.alpha", alpha);
        dim.spawnParticle("tusk:golden_ratio", pos, vars);
    } catch { }
}

function trimOwnerWormholes(ownerId, kind) {
    const owned = activeWormholes.filter((w) => w.ownerId === ownerId && w.kind === kind);
    while (owned.length >= MaxWormholesPerPlayer) {
        const oldest = owned.shift();
        const idx = activeWormholes.indexOf(oldest);
        if (idx !== -1) activeWormholes.splice(idx, 1);
    }
}

const SurfaceEps = 0.06;
const VoidBlack = { x: 0.01, y: 0.01, z: 0.02 };

export function spawnVoidSpot(dim, pos, normal, size = 0.45, life = 0.24, alpha = 0.98) {
    if (!dim || !pos) return;
    try {
        const n = safeNormal(normal);
        const vars = new MolangVariableMap();
        vars.setFloat("variable.nx", n.x);
        vars.setFloat("variable.ny", n.y);
        vars.setFloat("variable.nz", n.z);
        vars.setFloat("variable.size", size);
        vars.setFloat("variable.life", life);
        vars.setFloat("variable.alpha", alpha);
        dim.spawnParticle("tusk:wormhole_trail", pos, vars);
    } catch { }
}


function spawnSpatialHitSpiralBurst(dim, hitGroundPos, targetPos, spinAngle) {
    if (!dim || !hitGroundPos) return;
    const up = { x: 0, y: 1, z: 0 };
    const cx = targetPos?.x ?? hitGroundPos.x;
    const cy = hitGroundPos.y;
    const cz = targetPos?.z ?? hitGroundPos.z;


    spawnWormholeSpiral(dim, { x: cx, y: cy, z: cz }, up, {
        radius: 4.2, life: 0.48, turn: -spinAngle, spin: -520, rim: Colors.blue, alpha: 0.90,
    });
    spawnWormholeSpiral(dim, { x: cx, y: cy + 0.03, z: cz }, up, {
        radius: 3.4, life: 0.44, turn: spinAngle, spin: 680, rim: VoidBlack, alpha: 0.98,
    });
    spawnWormholeSpiral(dim, { x: cx, y: cy + 0.06, z: cz }, up, {
        radius: 2.2, life: 0.40, turn: spinAngle + 90, spin: 820, rim: Colors.cyan, alpha: 0.88,
    });
    spawnPursuitWormhole(dim, targetPos ?? hitGroundPos, {
        radius: 1.55, life: 0.42, turn: -spinAngle, spin: -640, rim: VoidBlack, alpha: 0.96,
    });
    spawnPursuitWormhole(dim, targetPos ?? hitGroundPos, {
        radius: 0.95, life: 0.36, turn: spinAngle, spin: 780, rim: Colors.cyan, alpha: 0.92,
    });


    spawnImpactRing(dim, { x: cx, y: cy + 0.05, z: cz }, up, { radius: 4.6, time: 0.36, color: Colors.blue, alpha: 0.96 });
    spawnImpactRing(dim, targetPos ?? hitGroundPos, up, { radius: 3.2, time: 0.30, color: Colors.cyan, alpha: 0.95 });
    spawnGlowFlash(dim, targetPos ?? hitGroundPos, { size: 3.8, life: 0.28, color: Colors.blue, alpha: 0.94 });
    spawnGlowFlash(dim, targetPos ?? hitGroundPos, { size: 1.9, life: 0.20, color: Colors.white, alpha: 0.98 });
    spawnStarburst(dim, targetPos ?? hitGroundPos, { size: 3.0, life: 0.26 });
    spawnConeSparks(dim, { x: cx, y: cy + 0.15, z: cz }, up);


    for (let step = 0; step < 5; step++) {
        system.runTimeout(() => {
            try {
                const h = 0.25 + step * 0.65;
                const r = 1.6 + step * 0.55;
                const ringPos = { x: cx, y: cy + h, z: cz };
                spawnWormholeSpiral(dim, ringPos, up, {
                    radius: r,
                    life: 0.36,
                    turn: spinAngle + step * 72,
                    spin: step % 2 === 0 ? 720 : -720,
                    rim: step % 2 === 0 ? Colors.blue : Colors.cyan,
                    alpha: 0.88,
                });
                spawnWormholeSpiral(dim, ringPos, up, {
                    radius: r * 0.72,
                    life: 0.32,
                    turn: -(spinAngle + step * 72),
                    spin: -640,
                    rim: VoidBlack,
                    alpha: 0.95,
                });

                for (let arm = 0; arm < 2; arm++) {
                    const ang = ((spinAngle + step * 78 + arm * 180) * Math.PI) / 180;
                    const hx = cx + Math.cos(ang) * (r * 0.55);
                    const hz = cz + Math.sin(ang) * (r * 0.55);
                    spawnVFX(dim, "tusk:nail_mote", { x: hx, y: cy + h, z: hz }, {
                        size: 0.42,
                        life: 0.34,
                        color: arm === 0 ? Colors.cyan : Colors.blue,
                        alpha: 0.98,
                    });
                }
            } catch { }
        }, step);
    }
}

export function spawnWormholeTrail(dim, fromPos, toPos, normal, size = 0.22, life = 0.75, withSparks = false) {
    if (!dim || !fromPos || !toPos) return;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dz = toPos.z - fromPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const step = withSparks ? 0.14 : 0.10;
    const samples = dist < 0.02 ? 1 : Math.max(1, Math.min(10, Math.ceil(dist / step)));
    for (let s = 0; s <= samples; s++) {
        const t = samples === 0 ? 0 : s / samples;
        const p = {
            x: fromPos.x + dx * t,
            y: fromPos.y + dy * t,
            z: fromPos.z + dz * t,
        };
        spawnVoidSpot(dim, p, normal, size, life, 0.96);
    }
    if (withSparks && dist >= 0.05) {
        const mid = { x: fromPos.x + dx * 0.5, y: fromPos.y + dy * 0.5 + 0.08, z: fromPos.z + dz * 0.5 };
        spawnVFX(dim, "tusk:nail_mote", mid, {
            size: 0.20,
            life: 0.26,
            color: Colors.blue,
            alpha: 0.92,
        });
    }
}


function spawnSpatialPursuitVFX(dim, pos, normal, spinAngle, moveDir = null, tickAge = 0, isInitial = false) {

    spawnVoidSpot(dim, pos, normal, isInitial ? 1.05 : 0.95, isInitial ? 0.30 : 0.22, 0.98);

    spawnWormholeSpiral(dim, pos, normal, {
        radius: isInitial ? 2.15 : 1.95,
        life: isInitial ? 0.32 : 0.24,
        turn: -spinAngle,
        spin: -380,
        rim: Colors.blue,
        alpha: 0.78,
    });

    spawnWormholeSpiral(dim, pos, normal, {
        radius: isInitial ? 1.80 : 1.65,
        life: isInitial ? 0.30 : 0.22,
        turn: spinAngle,
        spin: 560,
        rim: VoidBlack,
        alpha: 0.98,
    });

    spawnPursuitWormhole(dim, pos, {
        radius: isInitial ? 0.95 : 0.85,
        life: isInitial ? 0.26 : 0.20,
        turn: -spinAngle,
        spin: -520,
        rim: VoidBlack,
        alpha: 0.98,
    });
    spawnPursuitWormhole(dim, pos, {
        radius: isInitial ? 0.48 : 0.40,
        life: isInitial ? 0.24 : 0.18,
        turn: spinAngle,
        spin: 640,
        rim: Colors.cyan,
        alpha: 0.90,
    });


    spawnVFX(dim, "tusk:nail_mote", { x: pos.x, y: pos.y + 0.12, z: pos.z }, {
        size: isInitial ? 0.32 : 0.24,
        life: 0.28,
        color: tickAge % 2 === 0 ? Colors.cyan : Colors.blue,
        alpha: 0.95,
    });


    if (isInitial || tickAge % 3 === 0) {
        spawnImpactRing(dim, pos, normal, {
            radius: isInitial ? 2.8 : 2.1,
            time: isInitial ? 0.28 : 0.22,
            color: Colors.blue,
            alpha: 0.88,
        });
        spawnGlowFlash(dim, { x: pos.x, y: pos.y + 0.15, z: pos.z }, {
            size: isInitial ? 2.4 : 1.45,
            life: 0.18,
            color: Colors.blue,
            alpha: 0.72,
        });
    }
    if (moveDir && (isInitial || tickAge % 2 === 0)) {
        spawnImpactRing(dim, { x: pos.x, y: pos.y + 0.38, z: pos.z }, moveDir, {
            radius: isInitial ? 1.85 : 1.35,
            time: 0.18,
            color: Colors.cyan,
            alpha: 0.82,
        });
    }
}

const PassableGridBlock = /(?:^|:)short_grass$|(?:^|:)tall_grass$|(?:^|:)grass$|air|water|lava|flower|double_plant|peony|rose_bush|lilac|sunflower|fern|vine|torch|snow_layer|sapling|bush|carpet|button|lever|sign|rail|redstone_wire|pressure_plate|tripwire|dead_bush|seagrass|kelp|light_block|structure_void/;

function isSolidGridBlock(dim, bx, by, bz, cache = null) {
    const key = cache ? `${bx},${by},${bz}` : null;
    if (cache && cache.has(key)) return cache.get(key);
    let solid = false;
    try {
        const b = dim.getBlock({ x: bx, y: by, z: bz });
        solid = Boolean(b && !b.isAir && !b.isLiquid && !PassableGridBlock.test(b.typeId));
    } catch {
        solid = false;
    }
    if (cache) cache.set(key, solid);
    return solid;
}

function getSurfaceCellAnchor(dim, bx, by, bz, cache = null) {
    if (isSolidGridBlock(dim, bx, by, bz, cache)) return null;
    if (isSolidGridBlock(dim, bx, by - 1, bz, cache)) {
        return {
            bx, by, bz,
            x: bx + 0.5,
            y: by + SurfaceEps,
            z: bz + 0.5,
            normal: { x: 0, y: 1, z: 0 },
        };
    }
    const walls = [
        [1, 0, -1, 0],
        [-1, 0, 1, 0],
        [0, 1, 0, -1],
        [0, -1, 0, 1],
    ];
    for (const [sx, sz, nx, nz] of walls) {
        if (isSolidGridBlock(dim, bx + sx, by, bz + sz, cache)) {
            return {
                bx, by, bz,
                x: bx + 0.5 + sx * (0.5 - SurfaceEps),
                y: by + 0.5,
                z: bz + 0.5 + sz * (0.5 - SurfaceEps),
                normal: { x: nx, y: 0, z: nz },
            };
        }
    }
    if (isSolidGridBlock(dim, bx, by + 1, bz, cache)) {
        return {
            bx, by, bz,
            x: bx + 0.5,
            y: by + 1 - SurfaceEps,
            z: bz + 0.5,
            normal: { x: 0, y: -1, z: 0 },
        };
    }
    return null;
}

function resolveStartSurfaceCell(dim, pos, normal, cache) {
    const candidates = [
        { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
        {
            x: Math.floor(pos.x + normal.x * 0.45),
            y: Math.floor(pos.y + normal.y * 0.45),
            z: Math.floor(pos.z + normal.z * 0.45),
        },
        { x: Math.floor(pos.x), y: Math.floor(pos.y) + 1, z: Math.floor(pos.z) },
    ];
    for (const c of candidates) {
        const anchor = getSurfaceCellAnchor(dim, c.x, c.y, c.z, cache);
        if (anchor) return anchor;
    }

    const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const anchor = getSurfaceCellAnchor(dim, cx + dx, cy + dy, cz + dz, cache);
                if (anchor) return anchor;
            }
        }
    }
    return null;
}

function findSurfacePath(dim, startPos, startNormal, targetLoc, maxExpansions = 260) {
    const cache = new Map();
    const startAnchor = resolveStartSurfaceCell(dim, startPos, startNormal, cache);
    if (!startAnchor) return [];

    const tx = targetLoc.x;
    const ty = targetLoc.y;
    const tz = targetLoc.z;
    const startKey = `${startAnchor.bx},${startAnchor.by},${startAnchor.bz}`;

    const heuristic = (ax, ay, az) => Math.hypot(tx - (ax + 0.5), (ty - ay) * 1.15, tz - (az + 0.5));

    const open = [{
        key: startKey,
        anchor: startAnchor,
        g: 0,
        f: heuristic(startAnchor.bx, startAnchor.by, startAnchor.bz),
    }];
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const anchors = new Map([[startKey, startAnchor]]);
    const closed = new Set();

    let bestKey = startKey;
    let bestH = heuristic(startAnchor.bx, startAnchor.by, startAnchor.bz);
    let goalKey = null;

    const Cardinal = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    const Diagonal = [
        [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    let expansions = 0;
    while (open.length > 0 && expansions < maxExpansions) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        const cur = open[bestIdx];
        open[bestIdx] = open[open.length - 1];
        open.pop();

        if (closed.has(cur.key)) continue;
        closed.add(cur.key);
        expansions++;

        const { bx, by, bz } = cur.anchor;
        const hCur = heuristic(bx, by, bz);
        if (hCur < bestH) {
            bestH = hCur;
            bestKey = cur.key;
        }
        if (Math.hypot(tx - (bx + 0.5), tz - (bz + 0.5)) <= 0.65 && Math.abs(ty - by) <= 1.5) {
            goalKey = cur.key;
            break;
        }

        const neighbors = [];


        for (const [dx, dz] of Cardinal) {
            const nx = bx + dx;
            const nz = bz + dz;
            if (!isSolidGridBlock(dim, nx, by, nz, cache)) {
                const flatAnchor = getSurfaceCellAnchor(dim, nx, by, nz, cache);
                if (flatAnchor) {
                    neighbors.push({ anchor: flatAnchor, cost: 1.0 });
                } else if (isSolidGridBlock(dim, bx, by - 1, bz, cache)) {

                    const dropAnchor = getSurfaceCellAnchor(dim, nx, by - 1, nz, cache);
                    if (dropAnchor) neighbors.push({ anchor: dropAnchor, cost: 1.25 });
                }
            } else if (!isSolidGridBlock(dim, bx, by + 1, bz, cache)) {

                const crestAnchor = getSurfaceCellAnchor(dim, nx, by + 1, nz, cache);
                if (crestAnchor) neighbors.push({ anchor: crestAnchor, cost: 1.35 });
            }
        }


        if (isSolidGridBlock(dim, bx, by - 1, bz, cache)) {
            for (const [dx, dz] of Diagonal) {
                const nx = bx + dx;
                const nz = bz + dz;
                if (
                    isSolidGridBlock(dim, nx, by - 1, nz, cache) &&
                    !isSolidGridBlock(dim, nx, by, nz, cache) &&
                    !isSolidGridBlock(dim, nx, by, bz, cache) &&
                    !isSolidGridBlock(dim, bx, by, nz, cache) &&
                    isSolidGridBlock(dim, nx, by - 1, bz, cache) &&
                    isSolidGridBlock(dim, bx, by - 1, nz, cache)
                ) {
                    const diagAnchor = getSurfaceCellAnchor(dim, nx, by, nz, cache);
                    if (diagAnchor) neighbors.push({ anchor: diagAnchor, cost: 1.414 });
                }
            }
        }


        for (const dy of [1, -1]) {
            const ny = by + dy;
            if (!isSolidGridBlock(dim, bx, ny, bz, cache)) {
                const climbAnchor = getSurfaceCellAnchor(dim, bx, ny, bz, cache);
                if (climbAnchor) neighbors.push({ anchor: climbAnchor, cost: 1.05 });
            }
        }

        for (const nb of neighbors) {
            const nk = `${nb.anchor.bx},${nb.anchor.by},${nb.anchor.bz}`;
            if (closed.has(nk)) continue;
            const tentG = cur.g + nb.cost;
            const prevG = gScore.get(nk);
            if (prevG === undefined || tentG < prevG) {
                cameFrom.set(nk, cur.key);
                gScore.set(nk, tentG);
                anchors.set(nk, nb.anchor);
                open.push({
                    key: nk,
                    anchor: nb.anchor,
                    g: tentG,
                    f: tentG + heuristic(nb.anchor.bx, nb.anchor.by, nb.anchor.bz),
                });
            }
        }
    }

    const endKey = goalKey ?? bestKey;
    if (!endKey || endKey === startKey) return [];

    const path = [];
    let walkKey = endKey;
    while (walkKey && walkKey !== startKey) {
        const a = anchors.get(walkKey);
        if (a) path.push(a);
        walkKey = cameFrom.get(walkKey);
    }
    path.reverse();
    return path;
}

function hasFlatFloorLOS(dim, x0, z0, x1, z1, cellY, cache = null) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist <= 0.05) return true;
    const steps = Math.min(80, Math.ceil(dist / 0.35));
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const bx = Math.floor(x0 + dx * t);
        const bz = Math.floor(z0 + dz * t);
        if (isSolidGridBlock(dim, bx, cellY, bz, cache)) return false;
        if (!isSolidGridBlock(dim, bx, cellY - 1, bz, cache)) return false;
    }
    return true;
}

function stepWormholePath(w, target) {
    const targetLoc = target.location;
    const speed = w.speed ?? 0.38;
    const losCache = new Map();
    const cellY = Math.floor(w.pos.y + 0.02);


    if (w.normal.y > 0.5 && Math.abs(targetLoc.y - cellY) <= 1.25) {
        const dx = targetLoc.x - w.pos.x;
        const dz = targetLoc.z - w.pos.z;
        const hDist = Math.hypot(dx, dz);
        if (hDist > 0.001 && hasFlatFloorLOS(w.dim, w.pos.x, w.pos.z, targetLoc.x, targetLoc.z, cellY, losCache)) {
            const step = Math.min(speed, hDist);
            w.pos = {
                x: w.pos.x + (dx / hDist) * step,
                y: cellY + SurfaceEps,
                z: w.pos.z + (dz / hDist) * step,
            };
            w.normal = { x: 0, y: 1, z: 0 };
            w.path = [];
            w.forwardDir = { x: dx / hDist, y: 0, z: dz / hDist };
            return true;
        }
    }

    if (w.repathTimer <= 0 || !w.path || w.path.length === 0) {
        w.path = findSurfacePath(w.dim, w.pos, w.normal, targetLoc);
        w.repathTimer = w.repathInterval ?? 4;
    } else {
        w.repathTimer--;
    }


    if (w.normal.y > 0.5 && w.path && w.path.length > 1) {
        for (let k = w.path.length - 1; k >= 1; k--) {
            const cand = w.path[k];
            if (cand.normal.y > 0.5 && cand.by === cellY &&
                hasFlatFloorLOS(w.dim, w.pos.x, w.pos.z, cand.x, cand.z, cellY, losCache)) {
                w.path.splice(0, k);
                break;
            }
        }
    }


    if (!w.path || w.path.length === 0) {
        const dx = targetLoc.x - w.pos.x;
        const dz = targetLoc.z - w.pos.z;
        const hDist = Math.hypot(dx, dz);
        if (hDist > 0.05 && hDist <= 2.4 && Math.abs(targetLoc.y - w.pos.y) <= 1.65) {
            const nx = w.pos.x + (dx / hDist) * Math.min(speed, hDist);
            const nz = w.pos.z + (dz / hDist) * Math.min(speed, hDist);
            const floorY = Math.floor(w.pos.y) - 1;
            if (isSolidGridBlock(w.dim, Math.floor(nx), floorY, Math.floor(nz), losCache)) {
                w.pos = { x: nx, y: w.pos.y, z: nz };
                w.forwardDir = { x: dx / hDist, y: 0, z: dz / hDist };
                return true;
            }
        }
        return false;
    }

    const wp = w.path[0];
    let goalX = wp.x;
    let goalY = wp.y;
    let goalZ = wp.z;


    if (w.path.length === 1 && wp.normal.y > 0.5 && Math.abs(targetLoc.y - wp.by) <= 1.1) {
        goalX = targetLoc.x;
        goalZ = targetLoc.z;
    }

    const dx = goalX - w.pos.x;
    const dy = goalY - w.pos.y;
    const dz = goalZ - w.pos.z;
    const dist = Math.hypot(dx, dy, dz);

    const hLen = Math.hypot(dx, dz);
    if (hLen > 0.01) {
        w.forwardDir = { x: dx / hLen, y: 0, z: dz / hLen };
    }

    if (dist <= speed) {
        w.pos = { x: goalX, y: goalY, z: goalZ };
        w.normal = wp.normal;
        w.path.shift();
    } else if (dist > 0.001) {
        const s = speed / dist;
        w.pos = {
            x: w.pos.x + dx * s,
            y: w.pos.y + dy * s,
            z: w.pos.z + dz * s,
        };
        w.normal = wp.normal;
    }
    return true;
}


function stepWormholeForward(w) {
    const speed = w.speed ?? 0.92;
    const f = w.forwardDir ?? { x: 0, y: 0, z: 1 };
    const fh = Math.hypot(f.x, f.z) || 1;
    const dirX = f.x / fh;
    const dirZ = f.z / fh;

    const nx = w.pos.x + dirX * speed;
    const nz = w.pos.z + dirZ * speed;
    const bx = Math.floor(nx);
    const bz = Math.floor(nz);
    const curY = Math.floor(w.pos.y - 0.05);


    if (!isSolidGridBlock(w.dim, bx, curY, bz) && isSolidGridBlock(w.dim, bx, curY - 1, bz)) {
        w.pos = { x: nx, y: curY + SurfaceEps, z: nz };
        w.normal = { x: 0, y: 1, z: 0 };
        return true;
    }

    if (isSolidGridBlock(w.dim, bx, curY, bz) && !isSolidGridBlock(w.dim, bx, curY + 1, bz)) {
        w.pos = { x: nx, y: curY + 1 + SurfaceEps, z: nz };
        w.normal = { x: 0, y: 1, z: 0 };
        return true;
    }

    if (!isSolidGridBlock(w.dim, bx, curY, bz) && !isSolidGridBlock(w.dim, bx, curY - 1, bz) && isSolidGridBlock(w.dim, bx, curY - 2, bz)) {
        w.pos = { x: nx, y: curY - 1 + SurfaceEps, z: nz };
        w.normal = { x: 0, y: 1, z: 0 };
        return true;
    }

    w.pos = { x: nx, y: w.pos.y, z: nz };
    return true;
}

function getTargetHitDistance(wPos, target) {
    const loc = target.location;
    const clampedY = Math.max(loc.y + 0.1, Math.min(loc.y + 1.65, wPos.y));
    return Math.hypot(loc.x - wPos.x, clampedY - wPos.y, loc.z - wPos.z);
}

export function spawnHuntingWormhole(owner, surfacePos, normal, spinMult = 1.0) {
    if (!owner?.isValid) return;
    trimOwnerWormholes(owner.id, "hunt");
    const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const n = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
    const pos = {
        x: surfacePos.x + n.x * SurfaceEps,
        y: surfacePos.y + n.y * SurfaceEps,
        z: surfacePos.z + n.z * SurfaceEps,
    };
    activeWormholes.push({
        kind: "hunt",
        ownerId: owner.id,
        dim: owner.dimension,
        pos,
        normal: n,
        path: [],
        repathTimer: 0,
        waitTicks: 0,
        pursueTicks: 160,
        spinAngle: Math.random() * 360,
        tickAge: 0,
        spinMult,
    });
    spawnVoidSpot(owner.dimension, pos, n, 0.32, 0.28, 0.98);
    spawnWormholeSpiral(owner.dimension, pos, n, {
        radius: 0.56,
        life: 0.26,
        turn: Math.random() * 360,
        spin: 420,
        rim: VoidBlack,
        alpha: 0.98,
    });
    spawnPursuitWormhole(owner.dimension, pos, {
        radius: 0.26,
        life: 0.22,
        turn: Math.random() * 360,
        spin: -420,
        rim: VoidBlack,
        alpha: 0.96,
    });
    try {
        owner.dimension.playSound("xvoid.steelball_turn", pos, { volume: 0.55, pitch: 1.35 });
    } catch { }
}


export function spawnSpatialPursuitWormhole(owner, surfacePos, normal, forwardDir, spinMult = 1.0, options = {}) {
    if (!owner?.isValid) return;
    trimOwnerWormholes(owner.id, "spatial_pursuit");
    const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const n = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
    const pos = {
        x: surfacePos.x + n.x * SurfaceEps,
        y: surfacePos.y + n.y * SurfaceEps,
        z: surfacePos.z + n.z * SurfaceEps,
    };
    const cache = new Map();
    const startAnchor = resolveStartSurfaceCell(owner.dimension, pos, n, cache);
    const snappedPos = startAnchor
        ? (startAnchor.normal.y > 0.5 && !isSolidGridBlock(owner.dimension, Math.floor(pos.x), startAnchor.by, Math.floor(pos.z), cache)
            ? { x: pos.x, y: startAnchor.y, z: pos.z }
            : { x: startAnchor.x, y: startAnchor.y, z: startAnchor.z })
        : pos;
    const snappedNormal = startAnchor ? startAnchor.normal : n;

    const fh = Math.hypot(forwardDir?.x ?? 0, forwardDir?.z ?? 1) || 1;
    const normFwd = { x: (forwardDir?.x ?? 0) / fh, y: 0, z: (forwardDir?.z ?? 1) / fh };
    const initAngle = Math.random() * 360;

    let aimOrigin = options.aimOrigin;
    if (!aimOrigin) {
        try { aimOrigin = owner.getHeadLocation(); } catch { aimOrigin = snappedPos; }
    }
    let aimDir = options.aimDir;
    if (!aimDir) {
        try { aimDir = owner.getViewDirection(); } catch { aimDir = normFwd; }
    }
    const { target: aimedTarget, lookPoint } = findAimedVictim(owner.dimension, aimOrigin, aimDir, 34, owner.id);

    activeWormholes.push({
        kind: "spatial_pursuit",
        ownerId: owner.id,
        dim: owner.dimension,
        pos: snappedPos,
        normal: snappedNormal,
        forwardDir: normFwd,
        targetId: aimedTarget?.id ?? null,
        aimPoint: lookPoint,
        speed: 0.92,
        repathInterval: 2,
        path: [],
        repathTimer: 0,
        pursueTicks: 60,
        spinAngle: initAngle,
        tickAge: 0,
        spinMult,
    });
    spawnSpatialPursuitVFX(owner.dimension, snappedPos, snappedNormal, initAngle, normFwd, 0, true);
    try {
        owner.dimension.playSound("xvoid.warp", snappedPos, { volume: 0.9, pitch: 1.3 });
    } catch { }
}

export function spawnTrapWormhole(owner, surfacePos, normal, spinMult = 1.0) {
    if (!owner?.isValid) return;
    trimOwnerWormholes(owner.id, "trap");
    const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const n = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
    const pos = {
        x: surfacePos.x + n.x * SurfaceEps,
        y: surfacePos.y + n.y * SurfaceEps,
        z: surfacePos.z + n.z * SurfaceEps
    };
    const cache = new Map();
    const startAnchor = resolveStartSurfaceCell(owner.dimension, pos, n, cache);
    const snappedPos = startAnchor ? { x: startAnchor.x, y: startAnchor.y, z: startAnchor.z } : pos;
    const snappedNormal = startAnchor ? startAnchor.normal : n;

    activeWormholes.push({
        kind: "trap",
        ownerId: owner.id,
        dim: owner.dimension,
        pos: snappedPos,
        normal: snappedNormal,
        remainingTicks: 120,
        spinAngle: Math.random() * 360,
        tickAge: 0,
        spinMult,
    });
    spawnVoidSpot(owner.dimension, snappedPos, snappedNormal, 0.52, 0.28, 0.98);
    spawnWormholeSpiral(owner.dimension, snappedPos, snappedNormal, {
        radius: 1.45,
        life: 0.28,
        turn: Math.random() * 360,
        spin: 420,
        rim: VoidBlack,
        alpha: 0.98,
    });
    spawnPursuitWormhole(owner.dimension, snappedPos, {
        radius: 0.58,
        life: 0.24,
        turn: Math.random() * 360,
        spin: -420,
        rim: VoidBlack,
        alpha: 0.96,
    });
    try {
        owner.dimension.playSound("xvoid.steelball_turn", snappedPos, { volume: 0.55, pitch: 0.9 });
    } catch { }
}

function spawnTrailSegment(b, fromPos, toPos) {
    if (!b?.dim || !fromPos || !toPos) return;
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dz = toPos.z - fromPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const particleId = TrailParticles[b.actProp] ?? "nail:trail_act1";
    const samples = dist < 0.02 ? 1 : Math.max(1, Math.min(36, Math.ceil(dist / 0.18)));
    const isCorkscrew = b.trailStyle === "corkscrew";
    const basis = isCorkscrew ? buildBasis(b.dir) : null;

    for (let s = 0; s <= samples; s++) {
        const t = samples === 0 ? 0 : s / samples;
        const px = fromPos.x + dx * t;
        const py = fromPos.y + dy * t;
        const pz = fromPos.z + dz * t;
        try {
            b.dim.spawnParticle(particleId, { x: px, y: py, z: pz });
        } catch { }

        if (isCorkscrew) {
            const dAlong = b.travelled + dist * t;
            const twistRate = 2.6;
            const theta = dAlong * twistRate;
            const r = 0.28;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const ox = (basis.right.x * cos + basis.up.x * sin) * r;
            const oy = (basis.right.y * cos + basis.up.y * sin) * r;
            const oz = (basis.right.z * cos + basis.up.z * sin) * r;


            const sw = r * twistRate;
            const sx = (-basis.right.x * sin + basis.up.x * cos) * sw;
            const sy = (-basis.right.y * sin + basis.up.y * cos) * sw;
            const sz = (-basis.right.z * sin + basis.up.z * cos) * sw;
            const taLen = Math.hypot(b.dir.x + sx, b.dir.y + sy, b.dir.z + sz) || 1;
            const tbLen = Math.hypot(b.dir.x - sx, b.dir.y - sy, b.dir.z - sz) || 1;
            const tanA = { x: (b.dir.x + sx) / taLen, y: (b.dir.y + sy) / taLen, z: (b.dir.z + sz) / taLen };
            const tanB = { x: (b.dir.x - sx) / tbLen, y: (b.dir.y - sy) / tbLen, z: (b.dir.z - sz) / tbLen };

            spawnVFX(b.dim, "tusk:nail_trail", { x: px + ox, y: py + oy, z: pz + oz }, {
                s_x: 0.22, s_y: 0.055, life: 0.28, alpha: 0.96, color: Colors.hot, dir: tanA,
            });
            spawnVFX(b.dim, "tusk:nail_trail", { x: px - ox, y: py - oy, z: pz - oz }, {
                s_x: 0.22, s_y: 0.05, life: 0.26, alpha: 0.94, color: Colors.gold, dir: tanB,
            });
            if (s % 2 === 0) {
                spawnVFX(b.dim, "tusk:nail_trail", { x: px, y: py, z: pz }, {
                    s_x: 0.16, s_y: 0.036, life: 0.20, alpha: 0.95, color: Colors.white, dir: b.dir,
                });
            }


            const collarSpacing = 1.85;
            const prevAlong = s > 0 ? (b.travelled + dist * ((s - 1) / samples)) : dAlong;
            if (s > 0 && Math.floor(prevAlong / collarSpacing) !== Math.floor(dAlong / collarSpacing)) {
                spawnImpactRing(b.dim, { x: px, y: py, z: pz }, b.dir, {
                    radius: 0.92, time: 0.20, color: Colors.hot, alpha: 0.90,
                });
                spawnWormholeSpiral(b.dim, { x: px, y: py, z: pz }, b.dir, {
                    radius: 0.56, life: 0.22, turn: (dAlong * 150) % 360, spin: 820, rim: Colors.gold, alpha: 0.95,
                });
            }
        }
    }
}

function despawnNail(b) {
    if (!b?.entity) return;
    try { if (b.entity.isValid) b.entity.triggerEvent("jjba:despawn"); } catch { }
    try { if (b.entity.isValid) b.entity.remove(); } catch { }
}

function isSolidPoint(dim, p) {
    if (!dim || !p) return false;
    return isSolidGridBlock(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
}

function ensureAirPos(dim, pos, normal, incomingDir) {
    if (!isSolidPoint(dim, pos)) return pos;
    const candidates = [
        { x: pos.x + normal.x * 0.18, y: pos.y + normal.y * 0.18, z: pos.z + normal.z * 0.18 },
        { x: pos.x - incomingDir.x * 0.22 + normal.x * 0.08, y: pos.y - incomingDir.y * 0.22 + normal.y * 0.08, z: pos.z - incomingDir.z * 0.22 + normal.z * 0.08 },
        { x: pos.x - incomingDir.x * 0.4, y: pos.y - incomingDir.y * 0.4, z: pos.z - incomingDir.z * 0.4 },
    ];
    for (const c of candidates) {
        if (!isSolidPoint(dim, c)) return c;
    }
    return pos;
}


function sweepBlockHit(dim, pos, dir, step) {
    if (!dim || !pos || !dir || step <= 0) return null;
    let rayStart = pos;
    let backDist = 0;
    if (isSolidPoint(dim, pos)) {
        for (const d of [0.15, 0.3, 0.5, 0.7]) {
            const p = { x: pos.x - dir.x * d, y: pos.y - dir.y * d, z: pos.z - dir.z * d };
            if (!isSolidPoint(dim, p)) {
                rayStart = p;
                backDist = d;
                break;
            }
        }
    }

    try {
        const bh = raycastSolidBlock(dim, rayStart, dir, backDist + step + 0.03, {
            passableRe: PassableGridBlock,
        });
        if (bh) {
            const f = bh.faceLocation;
            const hitBlockPos = {
                x: bh.block.x + f.x,
                y: bh.block.y + f.y,
                z: bh.block.z + f.z,
            };
            const proj = (hitBlockPos.x - pos.x) * dir.x + (hitBlockPos.y - pos.y) * dir.y + (hitBlockPos.z - pos.z) * dir.z;
            if (proj <= step + 0.02) {
                return {
                    hitBlockPos,
                    blockDist: Math.max(0, proj),
                    hitNormal: faceToNormal(bh.face),
                };
            }
        }
    } catch { }


    const endT = backDist + step + 0.02;
    let vx = Math.floor(rayStart.x);
    let vy = Math.floor(rayStart.y);
    let vz = Math.floor(rayStart.z);

    const stepX = dir.x > 0 ? 1 : (dir.x < 0 ? -1 : 0);
    const stepY = dir.y > 0 ? 1 : (dir.y < 0 ? -1 : 0);
    const stepZ = dir.z > 0 ? 1 : (dir.z < 0 ? -1 : 0);

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    let tMaxX = stepX > 0 ? ((vx + 1 - rayStart.x) * tDeltaX) : (stepX < 0 ? ((rayStart.x - vx) * tDeltaX) : Infinity);
    let tMaxY = stepY > 0 ? ((vy + 1 - rayStart.y) * tDeltaY) : (stepY < 0 ? ((rayStart.y - vy) * tDeltaY) : Infinity);
    let tMaxZ = stepZ > 0 ? ((vz + 1 - rayStart.z) * tDeltaZ) : (stepZ < 0 ? ((rayStart.z - vz) * tDeltaZ) : Infinity);

    let t = 0;
    const maxIters = Math.ceil(endT) * 3 + 6;
    for (let it = 0; it < maxIters; it++) {
        let normal;
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
            t = tMaxX;
            tMaxX += tDeltaX;
            vx += stepX;
            normal = { x: -stepX, y: 0, z: 0 };
        } else if (tMaxY <= tMaxZ) {
            t = tMaxY;
            tMaxY += tDeltaY;
            vy += stepY;
            normal = { x: 0, y: -stepY, z: 0 };
        } else {
            t = tMaxZ;
            tMaxZ += tDeltaZ;
            vz += stepZ;
            normal = { x: 0, y: 0, z: -stepZ };
        }
        if (t > endT) break;
        if (isSolidGridBlock(dim, vx, vy, vz)) {
            const distFromPos = Math.max(0, t - backDist);
            if (distFromPos > step + 0.02) break;
            return {
                hitBlockPos: {
                    x: rayStart.x + dir.x * t,
                    y: rayStart.y + dir.y * t,
                    z: rayStart.z + dir.z * t,
                },
                blockDist: distFromPos,
                hitNormal: normal,
            };
        }
    }
    return null;
}

function pointToSegDist(px, py, pz, ax, ay, az, ux, uy, uz, segLen) {
    const dx = px - ax;
    const dy = py - ay;
    const dz = pz - az;
    const proj = Math.max(0, Math.min(segLen, dx * ux + dy * uy + dz * uz));
    const cx = ax + ux * proj;
    const cy = ay + uy * proj;
    const cz = az + uz * proj;
    return {
        dist: Math.hypot(px - cx, py - cy, pz - cz),
        proj,
        hitPos: { x: cx, y: cy, z: cz },
    };
}

function findHitEntitiesAlongSegment(dim, pos, dir, maxDist, ownerId, piercedIds) {
    const hitsMap = new Map();
    try {
        for (const hit of dim.getEntitiesFromRay(pos, dir, { maxDistance: maxDist + 0.15 })) {
            const e = hit.entity;
            if (!isValidTarget(e, ownerId) || piercedIds.has(e.id)) continue;
            hitsMap.set(e.id, {
                entity: e,
                proj: hit.distance,
                hitPos: {
                    x: pos.x + dir.x * hit.distance,
                    y: pos.y + dir.y * hit.distance,
                    z: pos.z + dir.z * hit.distance,
                },
            });
        }
    } catch { }


    try {
        const mid = {
            x: pos.x + dir.x * (maxDist * 0.5),
            y: pos.y + dir.y * (maxDist * 0.5),
            z: pos.z + dir.z * (maxDist * 0.5),
        };
        for (const e of dim.getEntities({ location: mid, maxDistance: maxDist * 0.5 + 1.2 })) {
            if (!isValidTarget(e, ownerId) || piercedIds.has(e.id) || hitsMap.has(e.id)) continue;
            const loc = e.location;
            let best = null;
            for (const yOff of [0.35, 0.9, 1.45]) {
                const res = pointToSegDist(loc.x, loc.y + yOff, loc.z, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, maxDist);
                if (!best || res.dist < best.dist) best = res;
            }
            if (best && best.dist <= 0.55) {
                hitsMap.set(e.id, { entity: e, proj: best.proj, hitPos: best.hitPos });
            }
        }
    } catch { }

    return Array.from(hitsMap.values()).sort((a, b) => a.proj - b.proj);
}

function applyNailImpact(b, hit) {
    const owner = world.getEntity(b.ownerId);
    const attacker = owner?.isValid ? owner : null;
    const { entity: target, hitPos: impactPos } = hit;
    applyHitscanDamage(attacker, target, b.dmg, {
        ...b.hitOpts,
        originPos: b.pos,
        originViewDir: b.dir,
    });
    spawnImpactRing(b.dim, impactPos, b.dir, { radius: b.actNum === 2 ? 1.55 : 1.25, time: 0.24, color: b.trailColor, alpha: 0.92 });
    spawnGlowFlash(b.dim, impactPos, { size: b.actNum === 2 ? 1.4 : 1.0, life: 0.18, color: b.trailColor, alpha: 0.85 });
    spawnStarburst(b.dim, impactPos, { size: b.actNum === 2 ? 1.2 : 0.95, life: 0.18 });
    try {
        b.dim.playSound("xvoid.hit_slash_S", impactPos, { volume: 0.75, pitch: b.actNum === 2 ? 1.0 : 1.25 });
    } catch { }
    if (b.onHitEntity) b.onHitEntity(target, impactPos);
}


export function fireNailRay(shooter, actNum, options = {}) {
    const {
        origin = getTuskShootOrigin(shooter),
        dir = shooter.getViewDirection(),
        muzzle = null,
        damage = null,
        range = null,
        speed = null,
        unblockable = false,
        allowWormhole = true,
        pierce = false,
        maxPierce = 1,
        applyModifiers = null,
        onHitEntity = null,
        trailColor = null,
        trailStyle = "standard",
        actOverride = null,
        spinMult = null,
        triggerSpinCd = true,
        maxBounces = 0,
        bounceAimRadius = 12,
    } = options;

    if (!shooter?.isValid) return { hitEntity: null, endPos: origin };
    const cfg = ActConfig[actNum] ?? ActConfig[1];
    const dim = shooter.dimension;
    const maxRange = range ?? cfg.range;
    const mult = spinMult ?? consumeSpinNailBuff(shooter, 20, triggerSpinCd);
    const dmg = (damage ?? cfg.damage) * mult;
    const nailSpeed = speed ?? cfg.speed ?? 1.75;
    const tColor = trailColor ?? cfg.color;


    const dLen = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const udir = { x: dir.x / dLen, y: dir.y / dLen, z: dir.z / dLen };


    let aimBlockDist = Infinity;
    let aimEntityDist = Infinity;
    if (!muzzle) {
        try {
            const bHit = raycastSolidBlock(dim, origin, udir, maxRange, {
                passableRe: PassableGridBlock,
            });
            if (bHit) {
                const f = bHit.faceLocation;
                aimBlockDist = Math.hypot(bHit.block.x + f.x - origin.x, bHit.block.y + f.y - origin.y, bHit.block.z + f.z - origin.z);
            }
            const eHits = dim.getEntitiesFromRay(origin, udir, { maxDistance: maxRange });
            for (const eh of eHits) {
                if (isValidTarget(eh.entity, shooter.id)) {
                    aimEntityDist = eh.distance;
                    break;
                }
            }
        } catch { }
    }


    let startVfx = muzzle;
    if (!startVfx) {
        const h = Math.hypot(udir.x, udir.z) || 1;
        const rightX = -udir.z / h;
        const rightZ = udir.x / h;
        const offsetScale = Number.isFinite(aimBlockDist)
            ? Math.max(0, Math.min(1, (aimBlockDist - 0.18) / 1.0))
            : 1.0;
        const fwdOff = Number.isFinite(aimBlockDist)
            ? Math.min(0.55, Math.max(0.0, aimBlockDist * 0.45))
            : 0.55;
        const sideOff = 0.28 * offsetScale;
        const downOff = 0.14 * offsetScale;
        startVfx = {
            x: origin.x + udir.x * fwdOff - rightX * sideOff,
            y: origin.y - downOff + udir.y * fwdOff,
            z: origin.z + udir.z * fwdOff - rightZ * sideOff,
        };
    }


    let spawnPos = startVfx;
    try {
        const mdx = startVfx.x - origin.x;
        const mdy = startVfx.y - origin.y;
        const mdz = startVfx.z - origin.z;
        const mDist = Math.hypot(mdx, mdy, mdz);
        if (mDist > 0.05) {
            const mDir = { x: mdx / mDist, y: mdy / mDist, z: mdz / mDist };
            const wallCheck = raycastSolidBlock(dim, origin, mDir, mDist + 0.05, {
                passableRe: PassableGridBlock,
            });
            if (wallCheck) {
                const wf = wallCheck.faceLocation;
                const wDist = Math.hypot(wallCheck.block.x + wf.x - origin.x, wallCheck.block.y + wf.y - origin.y, wallCheck.block.z + wf.z - origin.z);
                const safeT = Math.max(0, Math.min(mDist, wDist - 0.14));
                spawnPos = {
                    x: origin.x + mDir.x * safeT,
                    y: origin.y + mDir.y * safeT,
                    z: origin.z + mDir.z * safeT,
                };
            }
        }
        if (isSolidPoint(dim, spawnPos)) {
            spawnPos = !isSolidPoint(dim, origin)
                ? { x: origin.x, y: origin.y, z: origin.z }
                : { x: origin.x - udir.x * 0.15, y: origin.y - udir.y * 0.15, z: origin.z - udir.z * 0.15 };
        }
    } catch { }


    let projDir = udir;
    if (!muzzle) {
        let convergeDist = Math.min(maxRange, 18);
        if (aimEntityDist < aimBlockDist && Number.isFinite(aimEntityDist)) {
            convergeDist = Math.max(0.4, aimEntityDist);
        } else if (Number.isFinite(aimBlockDist)) {
            convergeDist = Math.max(0.08, aimBlockDist + 0.02);
        }
        const aimPt = {
            x: origin.x + udir.x * convergeDist,
            y: origin.y + udir.y * convergeDist,
            z: origin.z + udir.z * convergeDist,
        };
        const ax = aimPt.x - spawnPos.x;
        const ay = aimPt.y - spawnPos.y;
        const az = aimPt.z - spawnPos.z;
        const forwardDot = ax * udir.x + ay * udir.y + az * udir.z;
        if (forwardDot > 0.05) {
            const al = Math.hypot(ax, ay, az) || 1;
            projDir = { x: ax / al, y: ay / al, z: az / al };
        }
    }

    let entity = null;
    const actProp = actOverride ?? Math.max(0, Math.min(2, actNum - 1));
    const tsActiveNow = isTimeStopped() || (() => {
        try { return dim.getEntities({ tags: ["ts"] }).length > 0; } catch { return false; }
    })();
    try {
        entity = dim.spawnEntity(NailEntity, spawnPos);
        entity.addTag("spin");
        entity.addTag(`owner:${shooter.id}`);
        entity.setProperty("property:act", actProp);
        entity.setProperty("property:trail", 0);
        entity.setProperty("property:stopped", tsActiveNow ? 1 : 0);
        try { entity.clearVelocity(); } catch { }
        entity.teleport(spawnPos, {
            keepVelocity: false,
            facingLocation: {
                x: spawnPos.x + projDir.x,
                y: spawnPos.y + projDir.y,
                z: spawnPos.z + projDir.z,
            },
        });
    } catch { }

    spawnGlowFlash(dim, spawnPos, { size: actNum === 2 ? 1.15 : 0.9, life: 0.14, color: tColor, alpha: 0.85 });

    if (entity?.isValid) {
        activeNails.push({
            entity,
            dim,
            ownerId: shooter.id,
            actNum,
            actProp,
            pos: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
            dir: projDir,
            speed: nailSpeed,
            range: maxRange,
            travelled: 0,
            tickAge: 0,
            frozenInTs: tsActiveNow,
            dmg,
            spinMult: mult,
            cfg,
            allowWormhole,
            pierce,
            maxPierce,
            piercedIds: new Set(),
            trailColor: tColor,
            trailStyle,
            onHitEntity,
            bouncesLeft: maxBounces,
            maxBounces,
            bounceAimRadius,
            hitOpts: {
                unblockable,
                modifiers: applyModifiers ?? cfg.kb,
            },
        });
    }

    return { entity, endPos: spawnPos, hitEntity: null };
}

function findNearestVictim(dim, pos, radius, ownerId) {
    let best = null;
    let bestDist = radius;
    try {
        for (const e of dim.getEntities({ location: pos, maxDistance: radius + 1.5 })) {
            if (!isValidTarget(e, ownerId)) continue;
            const c = { x: e.location.x, y: e.location.y + 0.95, z: e.location.z };
            const d = Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z);
            if (d < bestDist) {
                bestDist = d;
                best = e;
            }
        }
    } catch { }
    return best;
}

function findAimedVictim(dim, origin, viewDir, maxRange, ownerId) {
    if (!dim || !origin || !viewDir) return { target: null, lookPoint: null };
    const vLen = Math.hypot(viewDir.x, viewDir.y, viewDir.z) || 1;
    const dir = { x: viewDir.x / vLen, y: viewDir.y / vLen, z: viewDir.z / vLen };

    let blockDist = maxRange;
    let lookPoint = {
        x: origin.x + dir.x * maxRange,
        y: origin.y + dir.y * maxRange,
        z: origin.z + dir.z * maxRange,
    };
    try {
        const bh = raycastSolidBlock(dim, origin, dir, maxRange, {
            passableRe: PassableGridBlock,
        });
        if (bh?.block) {
            const f = bh.faceLocation ?? { x: 0.5, y: 0.5, z: 0.5 };
            const hx = bh.block.x + f.x;
            const hy = bh.block.y + f.y;
            const hz = bh.block.z + f.z;
            blockDist = Math.hypot(hx - origin.x, hy - origin.y, hz - origin.z);
            lookPoint = { x: hx, y: hy, z: hz };
        }
    } catch { }


    try {
        const rayDist = Math.min(maxRange, blockDist + 0.75);
        for (const h of dim.getEntitiesFromRay(origin, dir, { maxDistance: rayDist })) {
            if (isValidTarget(h.entity, ownerId)) {
                return { target: h.entity, lookPoint };
            }
        }
    } catch { }


    let best = null;
    let bestScore = -Infinity;
    try {
        for (const e of dim.getEntities({ location: origin, maxDistance: maxRange })) {
            if (!isValidTarget(e, ownerId)) continue;
            const ex = e.location.x;
            const ez = e.location.z;
            const t = Math.max(0.1, Math.min(maxRange,
                (ex - origin.x) * dir.x + (e.location.y + 0.9 - origin.y) * dir.y + (ez - origin.z) * dir.z
            ));
            const rayY = origin.y + dir.y * t;
            const targetY = Math.max(e.location.y + 0.15, Math.min(e.location.y + 1.65, rayY));
            const dx = ex - origin.x;
            const dy = targetY - origin.y;
            const dz = ez - origin.z;
            const dist = Math.hypot(dx, dy, dz) || 1;
            if (dist > blockDist + 2.0) continue;

            const dot = (dx / dist) * dir.x + (dy / dist) * dir.y + (dz / dist) * dir.z;
            const lookPtDist = Math.hypot(ex - lookPoint.x, (e.location.y + 0.9) - lookPoint.y, ez - lookPoint.z);
            if (dot < 0.84 && lookPtDist > 2.5) continue;

            const score = dot >= 0.84
                ? dot - dist * 0.002
                : 0.75 - lookPtDist * 0.03;
            if (score > bestScore) {
                bestScore = score;
                best = e;
            }
        }
    } catch { }
    return { target: best, lookPoint };
}

function findSpatialPursuitTarget(w) {

    if (w.targetId) {
        try {
            const locked = world.getEntity(w.targetId);
            if (isValidTarget(locked, w.ownerId) && locked.dimension?.id === w.dim.id) {
                const d = Math.hypot(
                    locked.location.x - w.pos.x,
                    locked.location.y - w.pos.y,
                    locked.location.z - w.pos.z
                );
                if (d <= 38) return locked;
            }
        } catch { }
        w.targetId = null;
    }


    const f = w.forwardDir ?? { x: 0, y: 0, z: 1 };
    const fh = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / fh;
    const fz = f.z / fh;

    let bestForward = null;
    let bestForwardScore = -Infinity;
    try {
        for (const e of w.dim.getEntities({ location: w.pos, maxDistance: 29.5 })) {
            if (!isValidTarget(e, w.ownerId)) continue;
            const dx = e.location.x - w.pos.x;
            const dy = (e.location.y + 0.9) - w.pos.y;
            const dz = e.location.z - w.pos.z;
            const dist3 = Math.hypot(dx, dy, dz);
            if (dist3 > 28) continue;

            const hDist = Math.hypot(dx, dz) || 0.001;
            const hDot = (dx / hDist) * fx + (dz / hDist) * fz;
            const aimDist = w.aimPoint
                ? Math.hypot(e.location.x - w.aimPoint.x, e.location.z - w.aimPoint.z)
                : Infinity;

            if (hDot < 0.35 && aimDist > 3.5) continue;

            const aimBonus = aimDist <= 3.5 ? (4.0 - aimDist) * 1.5 : 0;
            const score = hDot * 10 - dist3 * 0.4 + aimBonus;
            if (score > bestForwardScore) {
                bestForwardScore = score;
                bestForward = e;
            }
        }
    } catch { }

    if (bestForward) {
        w.targetId = bestForward.id;
        return bestForward;
    }


    if (w.tickAge >= 10) {
        const fallback = findNearestVictim(w.dim, w.pos, 28, w.ownerId);
        if (fallback) {
            w.targetId = fallback.id;
            return fallback;
        }
    }
    return null;
}


system.runInterval(() => {
    const globalStopped = isTimeStopped();
    const dimStoppedCache = new Map();
    const isDimStopped = (dim) => {
        if (globalStopped) return true;
        if (!dim) return false;
        const cached = dimStoppedCache.get(dim.id);
        if (cached !== undefined) return cached;
        let hasTs = false;
        try {
            hasTs = dim.getEntities({ tags: ["ts"] }).length > 0;
        } catch { }
        dimStoppedCache.set(dim.id, hasTs);
        return hasTs;
    };


    for (let i = activeNails.length - 1; i >= 0; i--) {
        try {
            const b = activeNails[i];
            if (!b.entity?.isValid || !b.dim) {
                activeNails.splice(i, 1);
                continue;
            }
            const owner = world.getEntity(b.ownerId);
            if (b.entity.hasTag("tsed") || isDimStopped(b.dim)) {
                b.frozenInTs = true;
                try {
                    b.entity.setProperty("property:stopped", 1);
                    b.entity.clearVelocity();
                    b.entity.teleport(b.pos, {
                        keepVelocity: false,
                        facingLocation: {
                            x: b.pos.x + b.dir.x,
                            y: b.pos.y + b.dir.y,
                            z: b.pos.z + b.dir.z,
                        },
                    });
                } catch { }
                continue;
            }
            if (b.frozenInTs) {
                b.frozenInTs = false;
                try { b.entity.clearVelocity(); } catch { }
            }
            try { b.entity.setProperty("property:stopped", 0); } catch { }

            const step = Math.min(b.speed, b.range - b.travelled);
            if (step <= 0.01) {
                despawnNail(b);
                activeNails.splice(i, 1);
                continue;
            }


            const blockSweep = sweepBlockHit(b.dim, b.pos, b.dir, step);
            const blockHit = Boolean(blockSweep);
            const blockDist = blockSweep ? blockSweep.blockDist : step;
            const hitBlockPos = blockSweep ? blockSweep.hitBlockPos : null;
            const hitNormal = blockSweep ? blockSweep.hitNormal : { x: 0, y: 1, z: 0 };


            const hits = findHitEntitiesAlongSegment(b.dim, b.pos, b.dir, blockDist, b.ownerId, b.piercedIds);
            let removed = false;
            for (const h of hits) {
                b.piercedIds.add(h.entity.id);
                applyNailImpact(b, h);
                if (!b.pierce || b.piercedIds.size >= b.maxPierce) {
                    spawnTrailSegment(b, b.pos, h.hitPos);
                    despawnNail(b);
                    activeNails.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            if (removed) continue;


            if (blockHit && hitBlockPos) {
                spawnTrailSegment(b, b.pos, hitBlockPos);
                const bounceOffset = b.bouncesLeft > 0 ? 0.14 : 0.08;
                const rawSurfPos = {
                    x: hitBlockPos.x + hitNormal.x * bounceOffset,
                    y: hitBlockPos.y + hitNormal.y * bounceOffset,
                    z: hitBlockPos.z + hitNormal.z * bounceOffset,
                };
                const surfPos = b.bouncesLeft > 0
                    ? ensureAirPos(b.dim, rawSurfPos, hitNormal, b.dir)
                    : rawSurfPos;
                if (b.bouncesLeft > 0) {
                    b.bouncesLeft--;
                    const dn = b.dir.x * hitNormal.x + b.dir.y * hitNormal.y + b.dir.z * hitNormal.z;
                    let rx = b.dir.x - 2 * dn * hitNormal.x;
                    let ry = b.dir.y - 2 * dn * hitNormal.y;
                    let rz = b.dir.z - 2 * dn * hitNormal.z;
                    const rLen = Math.hypot(rx, ry, rz) || 1;
                    rx /= rLen; ry /= rLen; rz /= rLen;


                    if (b.bounceAimRadius > 0) {
                        const victim = findNearestVictim(b.dim, surfPos, b.bounceAimRadius, b.ownerId);
                        if (victim) {
                            const vx = victim.location.x - surfPos.x;
                            const vy = (victim.location.y + 0.5) - surfPos.y;
                            const vz = victim.location.z - surfPos.z;
                            const vLen = Math.hypot(vx, vy, vz) || 1;
                            const tx = vx / vLen, ty = vy / vLen, tz = vz / vLen;
                            const tDot = tx * hitNormal.x + ty * hitNormal.y + tz * hitNormal.z;
                            if (tDot > 0.08) {
                                rx = rx * 0.35 + tx * 0.65;
                                ry = ry * 0.35 + ty * 0.65;
                                rz = rz * 0.35 + tz * 0.65;
                                const bLen = Math.hypot(rx, ry, rz) || 1;
                                rx /= bLen; ry /= bLen; rz /= bLen;
                            }
                        }
                    }


                    const outDot = rx * hitNormal.x + ry * hitNormal.y + rz * hitNormal.z;
                    if (outDot < 0.12) {
                        const push = 0.12 - outDot;
                        rx += hitNormal.x * push;
                        ry += hitNormal.y * push;
                        rz += hitNormal.z * push;
                        const oLen = Math.hypot(rx, ry, rz) || 1;
                        rx /= oLen; ry /= oLen; rz /= oLen;
                    }

                    b.dir = { x: rx, y: ry, z: rz };
                    b.pos = surfPos;
                    b.travelled += blockDist;
                    b.tickAge++;
                    b.dmg += 1.0 * (b.spinMult ?? 1);

                    spawnImpactRing(b.dim, surfPos, hitNormal, { radius: 1.15, time: 0.24, color: Colors.hot, alpha: 0.92 });
                    spawnGlowFlash(b.dim, surfPos, { size: 1.05, life: 0.14, color: b.trailColor, alpha: 0.9 });
                    spawnConeSparks(b.dim, surfPos, b.dir, 6, { spread: 0.55, speed: 3.2, life: 0.22, color: Colors.hot, alpha: 0.9 });
                    try {
                        b.dim.playSound("xvoid.steelball_hit_S", surfPos, { volume: 0.85, pitch: 1.35 + (b.maxBounces - b.bouncesLeft) * 0.12 });
                        b.dim.playSound("xvoid.steelball_turn2", surfPos, { volume: 0.7, pitch: 1.3 });
                        b.entity.clearVelocity();
                        b.entity.teleport(b.pos, {
                            keepVelocity: false,
                            facingLocation: {
                                x: b.pos.x + b.dir.x,
                                y: b.pos.y + b.dir.y,
                                z: b.pos.z + b.dir.z,
                            },
                        });
                    } catch { }
                    continue;
                }

                spawnImpactRing(b.dim, surfPos, hitNormal, { radius: 0.95, time: 0.22, color: b.trailColor, alpha: 0.85 });
                if (b.trailStyle === "corkscrew") {
                    spawnWormholeSpiral(b.dim, surfPos, hitNormal, {
                        radius: 0.78, life: 0.30, turn: Math.random() * 360, spin: 860, rim: Colors.hot, alpha: 0.95,
                    });
                    spawnGlowFlash(b.dim, surfPos, { size: 1.45, life: 0.20, color: Colors.gold, alpha: 0.92 });
                    try { b.dim.spawnParticle("tusk2:drill_burst", surfPos); } catch { }
                }
                if (b.allowWormhole && owner?.isValid) {
                    if (b.cfg.wormhole === "hunt") {
                        spawnHuntingWormhole(owner, hitBlockPos, hitNormal, b.spinMult ?? 1);
                    } else if (b.cfg.wormhole === "trap") {
                        spawnTrapWormhole(owner, hitBlockPos, hitNormal, b.spinMult ?? 1);
                    }
                }
                despawnNail(b);
                activeNails.splice(i, 1);
                continue;
            }


            const nextPos = {
                x: b.pos.x + b.dir.x * step,
                y: b.pos.y + b.dir.y * step,
                z: b.pos.z + b.dir.z * step,
            };
            spawnTrailSegment(b, b.pos, nextPos);
            b.pos = nextPos;
            b.travelled += step;
            b.tickAge++;

            try {
                b.entity.clearVelocity();
                b.entity.teleport(b.pos, {
                    keepVelocity: false,
                    facingLocation: {
                        x: b.pos.x + b.dir.x,
                        y: b.pos.y + b.dir.y,
                        z: b.pos.z + b.dir.z,
                    },
                });
            } catch { }

            if (b.travelled >= b.range) {
                despawnNail(b);
                activeNails.splice(i, 1);
            }
        } catch {
            activeNails.splice(i, 1);
        }
    }


    if (activeWormholes.length === 0) return;
    if (globalStopped) return;

    for (let i = activeWormholes.length - 1; i >= 0; i--) {
        try {
            const w = activeWormholes[i];
            if (isDimStopped(w.dim)) continue;
            const owner = world.getEntity(w.ownerId);
            if (!owner?.isValid || !w.dim) {
                activeWormholes.splice(i, 1);
                continue;
            }
            w.tickAge++;

            if (w.kind === "hunt") {
                if (w.waitTicks > 0) {
                    w.waitTicks--;
                    w.spinAngle = (w.spinAngle + 70) % 360;
                    spawnVoidSpot(w.dim, w.pos, w.normal, 0.48, 0.22, 0.98);
                    if (w.tickAge % 2 === 0) {
                        spawnWormholeSpiral(w.dim, w.pos, w.normal, {
                            radius: 0.56,
                            life: 0.28,
                            turn: w.spinAngle,
                            spin: 380,
                            rim: VoidBlack,
                            alpha: 0.98,
                        });
                    }
                    continue;
                }

                w.pursueTicks--;
                if (w.pursueTicks <= 0) {
                    activeWormholes.splice(i, 1);
                    continue;
                }

                const prevPos = { x: w.pos.x, y: w.pos.y, z: w.pos.z };
                const prevNormal = w.normal;


                const target = findNearestVictim(w.dim, w.pos, 24, w.ownerId);
                if (target) {
                    const targetPos = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
                    const hitDist = getTargetHitDistance(w.pos, target);

                    if (hitDist <= 1.15) {
                        const dx = targetPos.x - w.pos.x;
                        const dy = targetPos.y - w.pos.y;
                        const dz = targetPos.z - w.pos.z;
                        const d = Math.hypot(dx, dy, dz) || 1;
                        const dh = Math.hypot(dx, dz) || 1;
                        const sMult = w.spinMult ?? 1;
                        applyHitscanDamage(owner, target, 7.5 * sMult, {
                            originPos: w.pos,
                            originViewDir: { x: dx / d, y: dy / d, z: dz / d },
                            modifiers: { staggerType: "stagger" },
                        });
                        if (!target.hasTag("tusk_detached") && !target.hasTag("tusk_spatial")) {
                            try {
                                target.applyKnockback({ x: (dx / dh) * 0.12, z: (dz / dh) * 0.12 }, 0.1);
                            } catch { }
                        }
                        spawnWormholeSpiral(w.dim, w.pos, w.normal, {
                            radius: 0.72,
                            life: 0.30,
                            turn: w.spinAngle,
                            spin: 480,
                            rim: VoidBlack,
                            alpha: 0.98,
                        });
                        spawnImpactRing(w.dim, targetPos, { x: 0, y: 1, z: 0 }, { radius: 1.9, time: 0.26, color: Colors.gold, alpha: 0.92 });
                        spawnGlowFlash(w.dim, targetPos, { size: 1.4, life: 0.18, color: Colors.gold, alpha: 0.85 });
                        spawnStarburst(w.dim, targetPos, { size: 1.2, life: 0.18 });
                        try {
                            w.dim.playSound("xvoid.steelball_hit_S", targetPos, { volume: 0.85, pitch: 1.15 });
                        } catch { }
                        activeWormholes.splice(i, 1);
                        continue;
                    }

                    if (stepWormholePath(w, target)) {
                        spawnWormholeTrail(w.dim, prevPos, w.pos, prevNormal);
                    }
                }

                w.spinAngle = (w.spinAngle + 85) % 360;

                spawnVoidSpot(w.dim, w.pos, w.normal, 0.28, 0.20, 0.98);
                spawnWormholeSpiral(w.dim, w.pos, w.normal, {
                    radius: 0.54,
                    life: 0.22,
                    turn: w.spinAngle,
                    spin: 440,
                    rim: VoidBlack,
                    alpha: 0.98,
                });
                spawnPursuitWormhole(w.dim, w.pos, {
                    radius: 0.26,
                    life: 0.18,
                    turn: -w.spinAngle,
                    spin: -420,
                    rim: VoidBlack,
                    alpha: 0.96,
                });
            } else if (w.kind === "spatial_pursuit") {

                w.pursueTicks--;
                if (w.pursueTicks <= 0) {
                    activeWormholes.splice(i, 1);
                    continue;
                }

                const prevPos = { x: w.pos.x, y: w.pos.y, z: w.pos.z };
                const prevNormal = w.normal;

                const target = findSpatialPursuitTarget(w);
                if (target) {
                    const targetPos = { x: target.location.x, y: target.location.y + 0.9, z: target.location.z };
                    const hitDist = getTargetHitDistance(w.pos, target);

                    if (hitDist <= 1.75) {
                        const dx = targetPos.x - w.pos.x;
                        const dy = targetPos.y - w.pos.y;
                        const dz = targetPos.z - w.pos.z;
                        const d = Math.hypot(dx, dy, dz) || 1;
                        const dh = Math.hypot(dx, dz) || 1;
                        const sMult = w.spinMult ?? 1;


                        try {
                            target.removeTag("blocking");
                            target.removeTag("parry");
                            target.triggerEvent("block:no");
                        } catch { }

                        applyHitscanDamage(owner, target, 10.5 * sMult, {
                            originPos: w.pos,
                            originViewDir: { x: dx / d, y: dy / d, z: dz / d },
                            unblockable: true,
                        });


                        if (!target.hasTag("tusk_detached") && !target.hasTag("tusk_spatial")) {
                            try {
                                target.applyKnockback({ x: (dx / dh) * 0.18, z: (dz / dh) * 0.18 }, 0.45);
                            } catch { }
                        }

                        spawnSpatialHitSpiralBurst(w.dim, w.pos, targetPos, w.spinAngle);
                        try {
                            w.dim.playSound("xvoid.steelball_hit_L", targetPos, { volume: 1.0, pitch: 1.15 });
                            w.dim.playSound("xvoid.warp", targetPos, { volume: 0.9, pitch: 1.3 });
                        } catch { }
                        activeWormholes.splice(i, 1);
                        continue;
                    }

                    if (stepWormholePath(w, target)) {
                        spawnWormholeTrail(w.dim, prevPos, w.pos, prevNormal);
                    }
                } else {
                    if (stepWormholeForward(w)) {
                        spawnWormholeTrail(w.dim, prevPos, w.pos, prevNormal);
                    }
                }

                w.spinAngle = (w.spinAngle + 95) % 360;
                spawnSpatialPursuitVFX(w.dim, w.pos, w.normal, w.spinAngle, w.forwardDir, w.tickAge, false);
            } else {

                w.remainingTicks--;
                if (w.remainingTicks <= 0) {
                    activeWormholes.splice(i, 1);
                    continue;
                }

                w.spinAngle = (w.spinAngle + 85) % 360;
                spawnVoidSpot(w.dim, w.pos, w.normal, 0.48, 0.20, 0.98);
                spawnWormholeSpiral(w.dim, w.pos, w.normal, {
                    radius: 1.45,
                    life: 0.24,
                    turn: w.spinAngle,
                    spin: 440,
                    rim: VoidBlack,
                    alpha: 0.98,
                });
                spawnPursuitWormhole(w.dim, w.pos, {
                    radius: 0.58,
                    life: 0.20,
                    turn: -w.spinAngle,
                    spin: -420,
                    rim: VoidBlack,
                    alpha: 0.96,
                });

                const victim = findNearestVictim(w.dim, w.pos, 3.0, w.ownerId);
                if (victim) {
                    const vLoc = victim.location;
                    const dx = w.pos.x - vLoc.x;
                    const dy = w.pos.y - (vLoc.y + 0.5);
                    const dz = w.pos.z - vLoc.z;
                    const dh = Math.hypot(dx, dz) || 1;
                    const d3 = Math.hypot(dx, dy, dz) || 1;
                    applyHitscanDamage(owner, victim, 6.5 * (w.spinMult ?? 1), {
                        originPos: w.pos,
                        originViewDir: { x: dx / d3, y: dy / d3, z: dz / d3 },
                    });
                    if (!victim.hasTag("tusk_detached") && !victim.hasTag("tusk_spatial")) {
                        try {

                            const pullX = vLoc.x + dx * 0.65;
                            const pullY = vLoc.y + Math.max(-0.2, Math.min(0.6, dy * 0.45));
                            const pullZ = vLoc.z + dz * 0.65;
                            victim.teleport({ x: pullX, y: pullY, z: pullZ });
                            const pullStrength = Math.min(1.65, Math.max(0.95, dh * 0.75));
                            victim.applyKnockback({ x: (dx / dh) * pullStrength, z: (dz / dh) * pullStrength }, 0.28);
                        } catch { }
                    }
                    spawnWormholeSpiral(w.dim, w.pos, w.normal, {
                        radius: 1.75,
                        life: 0.32,
                        turn: w.spinAngle,
                        spin: 520,
                        rim: VoidBlack,
                        alpha: 0.98,
                    });
                    spawnImpactRing(w.dim, w.pos, w.normal, { radius: 2.1, time: 0.26, color: Colors.blue, alpha: 0.92 });
                    spawnGlowFlash(w.dim, w.pos, { size: 1.5, life: 0.18, color: Colors.blue, alpha: 0.85 });
                    spawnStarburst(w.dim, w.pos, { size: 1.25, life: 0.18 });
                    try {
                        w.dim.playSound("xvoid.steelball_hit_S", w.pos, { volume: 0.85, pitch: 0.85 });
                    } catch { }
                    activeWormholes.splice(i, 1);
                    continue;
                }
            }
        } catch {
            activeWormholes.splice(i, 1);
        }
    }
}, 1);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "xvoid:tusk_shot") return;
    const player = ev.sourceEntity;
    if (!player?.isValid) return;

    const parts = (ev.message || "").trim().split(/\s+/);
    if (parts[0] === "primary") {
        if (player.hasTag("tusk_wormhole_barrage") || player.hasTag("tusk_rotation") || player.hasTag("tusk_detached") || player.hasTag("tusk_spatial")) return;
        const actNum = parseInt(parts[1], 10) || 1;
        if (primaryOverrideFn && primaryOverrideFn(player, actNum)) return;
        if (!consumeNails(player, 1)) return;
        fireNailRay(player, actNum);
    }
});
