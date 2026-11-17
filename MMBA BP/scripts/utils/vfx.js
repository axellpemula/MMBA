import { BlockPermutation, MolangVariableMap, system } from "@minecraft/server";
import { BlockRenderer } from "../bedrockblockrender/index.js";
import { isPassableBlock, raycastSolidBlock, resolveBlockHitPoint } from "./blocks.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "../stands/tim/timHitboxState.js";

const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const ImpactOffsetY = 31.25;

let blockRenderer = null;
export function getBlockRenderer() {
    if (!blockRenderer) blockRenderer = new BlockRenderer();
    return blockRenderer;
}

export const Colors = Object.freeze({
    white: Object.freeze({ x: 1.0, y: 0.98, z: 0.94 }),
    gold: Object.freeze({ x: 1.0, y: 0.78, z: 0.22 }),
    hot: Object.freeze({ x: 1.0, y: 0.55, z: 0.15 }),
    crimson: Object.freeze({ x: 1.0, y: 0.18, z: 0.22 }),
    cyan: Object.freeze({ x: 0.25, y: 0.88, z: 1.0 }),
    blue: Object.freeze({ x: 0.22, y: 0.58, z: 1.0 }),
    pink: Object.freeze({ x: 1.0, y: 0.38, z: 0.82 }),
    steel: Object.freeze({ x: 0.96, y: 0.96, z: 0.96 })
});


export function buildBasis(dir = UP) {
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const fwd = len > 1e-6 ? { x: dir.x / len, y: dir.y / len, z: dir.z / len } : { x: 0, y: 0, z: 1 };
    const h = Math.hypot(fwd.x, fwd.z);
    if (h < 1e-6) {
        return {
            fwd,
            right: { x: 1, y: 0, z: 0 },
            up: { x: 0, y: 0, z: -Math.sign(fwd.y) || -1 }
        };
    }
    const right = { x: fwd.z / h, y: 0, z: -fwd.x / h };
    const up = {
        x: (fwd.x / h) * -fwd.y,
        y: h,
        z: (fwd.z / h) * -fwd.y
    };
    return { fwd, right, up };
}


function safeNormal(n = UP) {
    const len = Math.hypot(n.x, n.y, n.z);
    const u = len > 1e-6 ? { x: n.x / len, y: n.y / len, z: n.z / len } : UP;
    return Math.hypot(u.x, u.z) < 0.02 ? { x: 0.02, y: u.y, z: 0.02 } : u;
}


export function makeVars(params = {}, map = new MolangVariableMap()) {
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        const key = k.startsWith("variable.") ? k : `variable.${k}`;
        if (typeof v === "number") {
            map.setFloat(key, v);
        } else if (typeof v === "object" && "x" in v && "y" in v && "z" in v) {
            map.setVector3(key, v);
        }
    }
    return map;
}

export function spawnVFX(dimension, id, location, params) {
    if (!dimension || !location) return false;
    try {
        dimension.spawnParticle(id, location, params ? makeVars(params) : undefined);
        return true;
    } catch {
        return false;
    }
}

export function spawnImpactRing(dimension, location, normal = UP, {
    radius = 2.4,
    time = 0.28,
    color = Colors.steel,
    alpha = 0.85,
    soft = false
} = {}) {
    return spawnVFX(dimension, "xvoid:impact_ring", location, {
        radius,
        time,
        alpha,
        soft: soft ? 1 : 0,
        turn: Math.random() * 360,
        normal: safeNormal(normal),
        color
    });
}

export function spawnBlockShield(dimension, location, normal = UP, {
    size = 1.8,
    color = Colors.cyan,
    alpha = 0.75
} = {}) {
    return spawnVFX(dimension, "xvoid:block_shield", location, {
        size,
        alpha,
        normal: safeNormal(normal),
        color
    });
}

export function spawnGlowFlash(dimension, location, {
    size = 2.0,
    life = 0.3,
    color = Colors.hot,
    alpha = 0.7
} = {}) {
    return spawnVFX(dimension, "xvoid:glow_flash", location, {
        size,
        life,
        alpha,
        color
    });
}

export function spawnStarburst(dimension, location, {
    size = 1.4,
    life = 0.22
} = {}) {
    return spawnVFX(dimension, "xvoid:starburst", location, {
        size,
        life,
        turn: Math.random() * 90
    });
}

export function spawnPunchShockwave(dimension, location, dir = UP) {
    return spawnVFX(dimension, "xvoid:punch_shockwave", location, {
        plane: safeNormal(dir)
    });
}

export function spawnVortexRing(dimension, location, dir = UP, {
    radius = 1.3,
    thickness = 0.22,
    id = "xvoid:vortex_ring"
} = {}) {
    const { fwd, right, up } = buildBasis(dir);
    return spawnVFX(dimension, id, location, {
        fwd,
        right,
        up,
        radius,
        thickness
    });
}

export function spawnConeSparks(dimension, location, dir = UP) {
    const { fwd, right, up } = buildBasis(dir);
    return spawnVFX(dimension, "xvoid:cone_sparks", location, {
        fwd,
        right,
        up
    });
}


export function spawnBezierSlash(dimension, origin, dir, {
    rollAngle = (Math.random() - 0.5) * 110,
    reach = 2.0,
    span = 1.45,
    color = Colors.cyan,
    width = 0.24,
    flight = 0.12,
    lag = 0.32
} = {}) {
    if (!dimension || !origin) return;
    const { fwd, right, up } = buildBasis(dir);
    const rad = (rollAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const swingAxis = {
        x: right.x * cos + up.x * sin,
        y: right.y * cos + up.y * sin,
        z: right.z * cos + up.z * sin
    };

    const start = {
        x: origin.x + swingAxis.x * span,
        y: origin.y + swingAxis.y * span,
        z: origin.z + swingAxis.z * span
    };
    const p1 = {
        x: fwd.x * reach - swingAxis.x * span,
        y: fwd.y * reach - swingAxis.y * span,
        z: fwd.z * reach - swingAxis.z * span
    };
    const p2 = {
        x: -swingAxis.x * (span * 2),
        y: -swingAxis.y * (span * 2),
        z: -swingAxis.z * (span * 2)
    };


    spawnVFX(dimension, "xvoid:bezier_slash", start, {
        flight,
        lag,
        width,
        alpha: 0.65,
        color,
        p1,
        p2
    });

    spawnVFX(dimension, "xvoid:bezier_slash", start, {
        flight,
        lag: lag * 0.65,
        width: width * 0.38,
        alpha: 0.95,
        color: Colors.white,
        p1,
        p2
    });
}


export function spawnTracer(dimension, startPos, endPos, {
    color = Colors.gold,
    coreColor = Colors.white,
    width = 0.20,
    lag = 0.24
} = {}) {
    if (!dimension || !startPos || !endPos) return;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.08) return;

    const dir = { x: dx / length, y: dy / length, z: dz / length };

    const segments = Math.max(1, Math.min(20, Math.ceil(length / 2.0)));
    const segLen = length / segments;
    const halfLen = segLen * 0.52;

    for (let i = 0; i < segments; i++) {
        const center = {
            x: startPos.x + dir.x * (segLen * (i + 0.5)),
            y: startPos.y + dir.y * (segLen * (i + 0.5)),
            z: startPos.z + dir.z * (segLen * (i + 0.5))
        };
        spawnVFX(dimension, "tusk:nail_trail", center, {
            s_x: halfLen,
            s_y: width * 0.5,
            life: lag,
            alpha: 0.88,
            color,
            dir
        });
        spawnVFX(dimension, "tusk:nail_trail", center, {
            s_x: halfLen,
            s_y: width * 0.22,
            life: lag * 0.68,
            alpha: 1.0,
            color: coreColor,
            dir
        });
    }
}


export function triggerImpactFrame(dimension, location, ticks = 2) {
    if (!dimension || !location) return;
    let entity;
    try {
        const minH = dimension.heightRange?.min ?? -64;
        const y = Math.max(location.y - ImpactOffsetY, minH);
        entity = dimension.spawnEntity("xvoid:impact_frame", { x: location.x, y, z: location.z });
    } catch {
        return;
    }
    system.runTimeout(() => {
        try {
            if (entity?.isValid) entity.remove();
        } catch { }
    }, ticks);
}

const MaxBlockJump = 1;
const DefaultWaveSpread = 6.4;
const DefaultWaveJump = 1;

function buildBlockWaveRings(spread = DefaultWaveSpread, jump = DefaultWaveJump) {
    const safeSpread = Math.max(0.5, Math.min(32, Number.isFinite(spread) ? spread : DefaultWaveSpread));
    const maxJump = Math.max(0, Math.min(MaxBlockJump, Number.isFinite(jump) ? jump : DefaultWaveJump));
    const ringCount = Math.max(1, Math.round(safeSpread));

    const rings = [];
    for (let k = 0; k < ringCount; k++) {
        const t = ringCount === 1 ? 0 : k / (ringCount - 1);
        const radius = ringCount === 1 ? safeSpread : 1 + t * (safeSpread - 1);
        rings.push({
            radius,
            points: Math.max(8, Math.ceil(2 * Math.PI * radius * 1.25)),
            delay: k * 2,
            scale: 1.0,
            jump: Math.min(MaxBlockJump, maxJump * (1 - 0.6 * t)),
            soundPitch: Math.max(0.5, 1.25 - k * 0.15)
        });
    }
    return rings;
}

function isFoliageOrPassable(typeId = "") {
    return (
        typeId.includes("air") ||
        typeId.includes("light_block") ||
        typeId.includes("structure_void") ||
        (typeId.includes("grass") && !typeId.includes("grass_block")) ||
        typeId.includes("flower") ||
        typeId.includes("fern") ||
        typeId.includes("sapling") ||
        typeId.includes("leaves") ||
        typeId.includes("bush") ||
        typeId.includes("torch") ||
        typeId.includes("carpet") ||
        typeId.includes("snow_layer") ||
        typeId.includes("vine")
    );
}


export function triggerBlockWave(
    dimension,
    location,
    { isTarget = false, spread = DefaultWaveSpread, jump = DefaultWaveJump, rings = null, impactFrame = false } = {}
) {
    if (!dimension || !location) return;
    const center = { x: location.x, y: location.y, z: location.z };
    const safeSpread = Math.max(0.5, Math.min(32, Number.isFinite(spread) ? spread : DefaultWaveSpread));
    const waveRings = rings ?? buildBlockWaveRings(safeSpread, jump);
    const seenBlocks = new Set();


    if (impactFrame) {
        triggerImpactFrame(dimension, center, 2);
    }


    spawnGlowFlash(dimension, { x: center.x, y: center.y + 0.4, z: center.z }, {
        size: Math.min(4.8, Math.max(1.8, safeSpread * 0.75)),
        life: 0.35,
        color: Colors.hot,
        alpha: 0.9
    });
    spawnStarburst(dimension, { x: center.x, y: center.y + 0.4, z: center.z }, {
        size: Math.min(3.0, Math.max(1.2, safeSpread * 0.45)),
        life: 0.28
    });


    spawnImpactRing(dimension, { x: center.x, y: center.y + 0.15, z: center.z }, UP, {
        radius: Math.max(1.5, safeSpread * 0.7),
        time: 0.28,
        color: Colors.gold,
        alpha: 0.95
    });
    spawnImpactRing(dimension, { x: center.x, y: center.y + 0.15, z: center.z }, UP, {
        radius: Math.max(2.5, safeSpread * 1.15),
        time: 0.46,
        color: Colors.steel,
        alpha: 0.85
    });


    try {
        dimension.spawnParticle("sfx:impact", { x: center.x, y: center.y + 0.1, z: center.z });
    } catch { }


    spawnPunchShockwave(dimension, { x: center.x, y: center.y + 0.35, z: center.z }, UP);
    spawnConeSparks(dimension, { x: center.x, y: center.y + 0.2, z: center.z }, UP);
    spawnVortexRing(dimension, { x: center.x, y: center.y + 0.3, z: center.z }, UP, {
        radius: Math.min(2.2, Math.max(1.0, safeSpread * 0.4)),
        thickness: 0.35
    });


    if (isTarget) {
        try {
            dimension.spawnParticle("xvoid:blood", { x: center.x, y: center.y + 0.8, z: center.z });
            dimension.spawnParticle("xvoid:parry_sparks", { x: center.x, y: center.y + 0.8, z: center.z });
        } catch { }
    }


    try {
        dimension.playSound("random.explode", center, { volume: 1.25, pitch: 0.95 });
        dimension.playSound("dig.stone", center, { volume: 1.4, pitch: 0.7 });
        dimension.playSound("dig.gravel", center, { volume: 1.1, pitch: 0.8 });
        dimension.playSound("ambient.weather.thunder", center, { volume: 1.1, pitch: 1.35 });
        dimension.playSound("random.anvil_land", center, { volume: 0.9, pitch: 0.55 });
        dimension.runCommand(`camerashake add @a[x=${center.x},y=${center.y},z=${center.z},r=28] 0.55 0.35 positional`);
    } catch { }

    for (let rIndex = 0; rIndex < waveRings.length; rIndex++) {
        const ring = waveRings[rIndex];
        system.runTimeout(() => {
            if (rIndex > 0) {
                try {
                    dimension.playSound("dig.stone", center, { volume: 0.85, pitch: ring.soundPitch });
                    dimension.playSound("dig.gravel", center, { volume: 0.65, pitch: ring.soundPitch });
                    dimension.runCommand(`camerashake add @a[x=${center.x},y=${center.y},z=${center.z},r=18] 0.18 0.2 positional`);
                } catch { }
            }

            const renderer = getBlockRenderer();
            const baseY = Math.floor(center.y);

            for (let i = 0; i < ring.points; i++) {
                const theta = (i / ring.points) * Math.PI * 2;
                const bx = Math.floor(center.x + Math.cos(theta) * ring.radius);
                const bz = Math.floor(center.z + Math.sin(theta) * ring.radius);
                const key = `${bx},${bz}`;
                if (seenBlocks.has(key)) continue;
                seenBlocks.add(key);

                const { perm, groundY } = sampleGroundPermutation(dimension, bx, baseY, bz);
                if (!perm) continue;

                const blockJump = Math.min(MaxBlockJump, Math.max(0, ring.jump) * (0.92 + Math.random() * 0.16));
                const surfaceY = groundY + 1.0;
                try {

                    renderer.drawBlock(
                        { permutation: perm },
                        {
                            dimension,
                            location: { x: bx, y: groundY + 0.25, z: bz },
                            lifetimeSeconds: 0.5,
                            scale: ring.scale,
                            jumpHeight: blockJump
                        }
                    );
                } catch { }


                try {
                    dimension.spawnParticle("xvoid:dust_puff", {
                        x: bx + 0.5,
                        y: surfaceY + 0.15,
                        z: bz + 0.5
                    });
                } catch { }
            }
        }, ring.delay);
    }
}

export function sampleGroundPermutation(dimension, bx, baseY, bz) {
    let groundBlock = null;
    let groundY = baseY - 1;
    for (let dy = 3; dy >= -6; dy--) {
        let b;
        try {
            b = dimension.getBlock({ x: bx, y: baseY + dy, z: bz });
        } catch {
            continue;
        }
        if (!b || b.isAir || b.isLiquid) continue;
        if (isFoliageOrPassable(b.typeId)) continue;
        groundBlock = b;
        groundY = baseY + dy;
        break;
    }

    let perm = groundBlock?.permutation;
    if (!perm) {
        try {
            perm = BlockPermutation.resolve("minecraft:dirt");
        } catch { }
    }
    return { perm, groundY };
}


export function triggerWaveShards(dimension, location, { intensity = 1 } = {}) {
    if (!dimension || !location) return;
    const rawIntensity = Number.isFinite(intensity) ? intensity : 1;
    if (rawIntensity <= 0) return;

    const safeIntensity = Math.max(0.1, Math.min(10, rawIntensity));
    const minCount = Math.max(1, Math.round(6 * safeIntensity));
    const maxCount = Math.max(minCount + 2, Math.round(12 * safeIntensity));
    const shardCount = minCount + Math.floor(Math.random() * (maxCount - minCount + 1));

    const center = { x: location.x, y: location.y, z: location.z };
    const baseY = Math.floor(center.y);
    const renderer = getBlockRenderer();

    try {
        dimension.playSound("dig.stone", center, { volume: Math.min(1.4, 0.75 + safeIntensity * 0.12), pitch: 0.95 });
        dimension.playSound("dig.gravel", center, { volume: Math.min(1.2, 0.65 + safeIntensity * 0.1), pitch: 1.05 });
    } catch { }

    for (let i = 0; i < shardCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const spawnR = 0.25 + Math.random() * 1.4;
        const sx = center.x + Math.cos(theta) * spawnR;
        const sz = center.z + Math.sin(theta) * spawnR;

        const { perm, groundY } = sampleGroundPermutation(dimension, Math.floor(sx), baseY, Math.floor(sz));
        if (!perm) continue;

        const horizSpeed = 2.8 + Math.random() * 4.8;
        const vy = 4.4 + Math.random() * 4.4;
        const scale = 0.2 + Math.random() * 0.15;
        const lifetimeSeconds = Math.min(0.95, Math.max(0.42, (2 * vy) / 19.6 + 0.05));
        const startY = groundY + 0.82;
        const tiltX = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);
        const tiltZ = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 24);
        const spin = (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 360);

        try {
            renderer.drawBlock(
                { permutation: perm },
                {
                    dimension,
                    location: { x: sx - 0.5, y: startY - 0.5, z: sz - 0.5 },
                    lifetimeSeconds,
                    scale,
                    rotation: {
                        x: tiltX,
                        y: Math.random() * 360,
                        z: tiltZ
                    },
                    velocity: {
                        x: Math.cos(theta) * horizSpeed,
                        y: vy,
                        z: Math.sin(theta) * horizSpeed
                    },
                    spin
                }
            );
        } catch { }

        if (i % 3 === 0) {
            try {
                dimension.spawnParticle("xvoid:dust_puff", { x: sx, y: groundY + 1.05, z: sz });
            } catch { }
        }
    }
}

const downSlamWatchers = new Map();

function isEntityGrounded(entity) {
    if (!entity?.isValid) return false;
    try {
        if (entity.isOnGround) return true;
    } catch { }
    try {
        const loc = entity.location;
        const b = entity.dimension.getBlock({
            x: Math.floor(loc.x),
            y: Math.floor(loc.y - 0.3),
            z: Math.floor(loc.z)
        });
        if (b && !b.isAir && !b.isLiquid && !isFoliageOrPassable(b.typeId)) {
            return true;
        }
    } catch { }
    return false;
}


export function trackDownSlamLanding(entity, isTarget = false, waveOptions = {}) {
    if (!entity?.isValid) return;
    downSlamWatchers.set(entity.id, {
        entity,
        isTarget,
        waveOptions,
        ticks: 0,
        maxTicks: 60
    });
}

system.runInterval(() => {
    if (downSlamWatchers.size === 0) return;
    for (const [id, state] of downSlamWatchers.entries()) {
        const { entity } = state;
        if (!entity?.isValid) {
            downSlamWatchers.delete(id);
            continue;
        }
        state.ticks++;
        if (state.ticks >= 1 && isEntityGrounded(entity)) {
            downSlamWatchers.delete(id);
            triggerBlockWave(entity.dimension, entity.location, { isTarget: state.isTarget, ...state.waveOptions });
            continue;
        }
        if (state.ticks >= state.maxTicks) {
            downSlamWatchers.delete(id);
            triggerBlockWave(entity.dimension, entity.location, { isTarget: state.isTarget, ...state.waveOptions });
        }
    }
}, 1);

const AimIgnoreTypes = new Set([
    "jjba:nail",
    "jjba:steelball",
    "xvoid:dmg",
    "xvoid:impact_frame",
    "xvoid:frozen_rain",
    "xvoid:tim_arm",
    "minecraft:item",
    "minecraft:xp_orb",
]);

function isValidAimEntity(e, player) {
    if (!e?.isValid || e.id === player.id) return false;
    if (AimIgnoreTypes.has(e.typeId) || e.hasTag("non_target")) return false;
    if (isOwnTimHitbox(player, e)) return false;
    if (e.typeId === TimHitboxType && !getTimHitboxOwner(e)?.isValid) return false;
    return true;
}

function faceToNormal(face, fallback) {
    if (face === "Up") return { x: 0, y: 1, z: 0 };
    if (face === "Down") return { x: 0, y: -1, z: 0 };
    if (face === "North") return { x: 0, y: 0, z: -1 };
    if (face === "South") return { x: 0, y: 0, z: 1 };
    if (face === "East") return { x: 1, y: 0, z: 0 };
    if (face === "West") return { x: -1, y: 0, z: 0 };
    return fallback;
}


export function resolveDetachedArmAim(player, armOrigin, view, camPos, maxRange = 28, aimAssistRadius = 1.15) {
    const dim = player.dimension;
    const vLen = Math.hypot(view.x, view.y, view.z) || 1;
    const vNorm = { x: view.x / vLen, y: view.y / vLen, z: view.z / vLen };
    const rayStart = camPos ?? armOrigin;

    let hitKind = "sky";
    let hitDist = maxRange;
    let targetPoint = {
        x: rayStart.x + vNorm.x * maxRange,
        y: rayStart.y + vNorm.y * maxRange,
        z: rayStart.z + vNorm.z * maxRange,
    };
    let hitNormal = { x: -vNorm.x, y: -vNorm.y, z: -vNorm.z };
    let hitEntity = null;

    try {
        const blockHit = raycastSolidBlock(dim, rayStart, vNorm, maxRange);
        if (blockHit?.block && !isPassableBlock(blockHit.block)) {
            const pt = resolveBlockHitPoint(rayStart, vNorm, blockHit);
            const d = Math.hypot(pt.x - rayStart.x, pt.y - rayStart.y, pt.z - rayStart.z);
            if (d > 0.25 && d < hitDist) {
                hitDist = d;
                targetPoint = pt;
                hitKind = "block";
                hitNormal = faceToNormal(blockHit.face, hitNormal);
            }
        }
    } catch { }

    try {
        const entHits = dim.getEntitiesFromRay(rayStart, vNorm, { maxDistance: hitDist });
        for (const h of entHits) {
            const e = h.entity;
            if (!isValidAimEntity(e, player)) continue;
            const d = h.distance ?? maxRange;
            if (d >= 0.2 && d <= hitDist) {
                hitDist = d;
                hitEntity = e;
                hitKind = "entity";
                const eLoc = e.location;
                targetPoint = {
                    x: eLoc.x,
                    y: eLoc.y + (e.typeId === "minecraft:player" ? 1.05 : 0.9),
                    z: eLoc.z,
                };
                hitNormal = { x: -vNorm.x, y: -vNorm.y, z: -vNorm.z };
                break;
            }
        }
    } catch { }


    if (!hitEntity && aimAssistRadius > 0) {
        try {
            let bestScore = aimAssistRadius;
            for (const e of dim.getEntities({ location: rayStart, maxDistance: Math.min(maxRange, hitDist + 0.5) })) {
                if (!isValidAimEntity(e, player)) continue;
                const hp = e.getComponent("minecraft:health");
                if (!hp || hp.currentValue <= 0) continue;
                const eLoc = e.location;
                const center = {
                    x: eLoc.x,
                    y: eLoc.y + (e.typeId === "minecraft:player" ? 1.05 : 0.9),
                    z: eLoc.z,
                };
                const rx = center.x - rayStart.x;
                const ry = center.y - rayStart.y;
                const rz = center.z - rayStart.z;
                const along = rx * vNorm.x + ry * vNorm.y + rz * vNorm.z;
                if (along < 0.3 || along > hitDist) continue;
                const px = rx - vNorm.x * along;
                const py = ry - vNorm.y * along;
                const pz = rz - vNorm.z * along;
                const perp = Math.hypot(px, py, pz);
                if (perp <= bestScore) {
                    bestScore = perp;
                    hitEntity = e;
                    hitKind = "entity";
                    hitDist = along;
                    targetPoint = center;
                    hitNormal = { x: -vNorm.x, y: -vNorm.y, z: -vNorm.z };
                }
            }
        } catch { }
    }

    const sdx = targetPoint.x - armOrigin.x;
    const sdy = targetPoint.y - armOrigin.y;
    const sdz = targetPoint.z - armOrigin.z;
    const sLen = Math.hypot(sdx, sdy, sdz);
    const shootDir = sLen > 0.35 ? { x: sdx / sLen, y: sdy / sLen, z: sdz / sLen } : vNorm;
    const muzzle = {
        x: armOrigin.x + shootDir.x * 0.42,
        y: armOrigin.y + shootDir.y * 0.42,
        z: armOrigin.z + shootDir.z * 0.42,
    };

    let beamDist = Math.min(maxRange, Math.max(0.3, sLen - 0.42));
    try {
        const armBlockHit = raycastSolidBlock(dim, muzzle, shootDir, beamDist);
        if (armBlockHit?.block && !isPassableBlock(armBlockHit.block)) {
            const bPt = resolveBlockHitPoint(muzzle, shootDir, armBlockHit);
            const bDist = Math.hypot(bPt.x - muzzle.x, bPt.y - muzzle.y, bPt.z - muzzle.z);
            if (bDist < beamDist - 0.15) {
                beamDist = Math.max(0.15, bDist);
                targetPoint = bPt;
                hitKind = "block";
                hitEntity = null;
                hitNormal = faceToNormal(armBlockHit.face, hitNormal);
            }
        }
    } catch { }

    return {
        muzzle,
        shootDir,
        armAim: shootDir,
        targetPoint,
        beamDist,
        hitKind,
        hitNormal,
        hitEntity,
    };
}


export function spawnDetachedArmAimIndicator(player, aimInfo, opts = {}) {
    if (!player?.isValid || !aimInfo) return;
    const { muzzle, shootDir, targetPoint, beamDist, hitKind, hitNormal } = aimInfo;
    const isLocked = hitKind === "entity";
    const showLine = opts.showLine ?? true;
    const defaultColor = opts.defaultColor ?? Colors.blue;
    const lockedColor = opts.lockedColor ?? Colors.crimson;
    const idleCoreColor = opts.idleCoreColor ?? (defaultColor === Colors.gold ? Colors.gold : Colors.cyan);

    const beamColor = isLocked ? lockedColor : defaultColor;
    const totalDist = Math.max(0.1, beamDist);

    if (showLine) {
        const startOffset = Math.min(0.28, totalDist * 0.25);
        const span = totalDist - startOffset;
        if (span > 0.35) {
            const dashHalf = isLocked ? 0.24 : 0.20;
            const step = Math.max(1.25, span / 12);
            const beamWidth = isLocked ? 0.024 : 0.017;
            const beamAlpha = isLocked ? 0.85 : 0.65;
            for (let d = startOffset + 0.35; d < totalDist - 0.2; d += step) {
                spawnVFX(player, "tusk:nail_trail", {
                    x: muzzle.x + shootDir.x * d,
                    y: muzzle.y + shootDir.y * d,
                    z: muzzle.z + shootDir.z * d,
                }, {
                    s_x: dashHalf,
                    s_y: beamWidth,
                    life: 0.09,
                    alpha: beamAlpha,
                    color: beamColor,
                    dir: shootDir,
                });
            }
        }
    }

    const reticlePos = hitKind === "block"
        ? {
            x: targetPoint.x + hitNormal.x * 0.12 - shootDir.x * 0.06,
            y: targetPoint.y + hitNormal.y * 0.12 - shootDir.y * 0.06,
            z: targetPoint.z + hitNormal.z * 0.12 - shootDir.z * 0.06,
        }
        : targetPoint;

    spawnVFX(player, "tusk:aim_ring", reticlePos, {
        size: isLocked ? 0.48 : (hitKind === "block" ? 0.36 : 0.32),
        life: 0.11,
        color: isLocked ? lockedColor : defaultColor,
        alpha: isLocked ? 0.95 : 0.85,
    });
    spawnVFX(player, "tusk:aim_dot", reticlePos, {
        size: isLocked ? 0.24 : (hitKind === "block" ? 0.18 : 0.16),
        life: 0.11,
        color: isLocked ? lockedColor : idleCoreColor,
        alpha: 0.98,
    });
}
