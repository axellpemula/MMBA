import { world, system, MolangVariableMap, EasingType, BlockPermutation } from "@minecraft/server";
import { applyHitscanDamage } from "../../damage/damage.js";
import { Colors, buildBasis, triggerImpactFrame, spawnVFX, spawnBezierSlash, spawnImpactRing, spawnVortexRing, spawnStarburst, spawnGlowFlash, spawnPunchShockwave, spawnConeSparks } from "../../utils/vfx.js";
import { BlockRenderer } from "../../bedrockblockrender/index.js";
import { getEnergy, useEnergy } from "../../energy.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { raycastSolidBlock, resolveBlockHitPoint } from "../../utils/blocks.js";
import { getNails, consumeNails } from "./tusk.js";
import { applyBleed } from "./bleed.js";
import {
    fireNailRay,
    getTuskShootOrigin,
    spawnWormholeSpiral,
    spawnPursuitWormhole,
    spawnWormholeTrail,
    spawnVoidSpot,
    spawnGoldenRatioVFX,
    registerPrimaryOverride,
    consumeSpinNailBuff,
    spawnSpatialPursuitWormhole
} from "./nail_shot.js";

const PassableBlock = /(?:^|:)short_grass$|(?:^|:)tall_grass$|(?:^|:)grass$|air|water|lava|fern|flower|double_plant|peony|rose_bush|lilac|sunflower|vine|torch|carpet|button|lever|sign|rail|wire|pressure_plate|tripwire|snow_layer|sapling|bush|dead_bush|kelp|seagrass|structure_void|light_block/;


const activeCasts = new Map();
const drillLocks = [];
const slashWaves = [];
const pilotedArms = new Map();
const spatialWormholes = new Map();

function getScore(player, name) {
    try { return world.scoreboard.getObjective(name)?.getScore(player) ?? 0; } catch { return 0; }
}

function setScore(player, name, value) {
    try { world.scoreboard.getObjective(name)?.setScore(player, Math.round(value)); } catch { }
}

function heldType(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex)?.typeId ?? "";
    } catch {
        return "";
    }
}

function normalize(v) {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function rotateDir(dir, yawDeg, pitchDeg) {
    const { fwd, right, up } = buildBasis(dir);
    const yr = (yawDeg * Math.PI) / 180;
    const pr = (pitchDeg * Math.PI) / 180;
    return normalize({
        x: fwd.x + right.x * Math.tan(yr) + up.x * Math.tan(pr),
        y: fwd.y + right.y * Math.tan(yr) + up.y * Math.tan(pr),
        z: fwd.z + right.z * Math.tan(yr) + up.z * Math.tan(pr),
    });
}

function playAnim(player, anim) {
    try { player.runCommand(`playanimation @s ${anim}`); } catch { }
}

function restorePlayerMovement(player) {
    if (!player?.isValid) return;
    try { player.runCommand("inputpermission set @s movement enabled"); } catch { }
    try { player.runCommand("inputpermission set @s camera enabled"); } catch { }
    try { player.runCommand("inputpermission set @s move_forward enabled"); } catch { }
    try { player.runCommand("inputpermission set @s jump enabled"); } catch { }
    try { player.runCommand("inputpermission set @s sneak enabled"); } catch { }
    try { player.runCommand("hud @s reset"); } catch { }
    try { player.triggerEvent("xvoid:jatuh"); } catch { }
    clearPilotCamera(player);
    try { player.runCommand("effect @s slowness 0"); } catch { }
}

function cleanupSkillLock(player, cdTicks = 12, spLock = -10) {
    if (!player?.isValid) return;
    player.removeTag("onSkill");
    player.removeTag("tusk_shot_queued");
    setScore(player, "movesScript", 0);
    setScore(player, "m1", 0);
    setScore(player, "cd", cdTicks);
    restorePlayerMovement(player);
    setScore(player, "sp1", spLock);
}

function findAimTarget(player, maxRange = 24, coneDot = 0.88) {
    const dim = player.dimension;
    const origin = getTuskShootOrigin(player);
    const dir = normalize(player.getViewDirection());


    let blockDist = maxRange;
    try {
        const bh = raycastSolidBlock(dim, origin, dir, maxRange, { passableRe: PassableBlock });
        if (bh) {
            const f = bh.faceLocation;
            blockDist = Math.hypot(bh.block.x + f.x - origin.x, bh.block.y + f.y - origin.y, bh.block.z + f.z - origin.z);
        }
    } catch { }

    try {
        for (const h of dim.getEntitiesFromRay(origin, dir, { maxDistance: blockDist })) {
            const e = h.entity;
            if (!e?.isValid || e.id === player.id || e.hasTag("tusk_decoy") || e.hasTag("tusk_rotation")) continue;
            const hp = e.getComponent("minecraft:health");
            if (hp && hp.currentValue > 0) return e;
        }
    } catch { }


    let best = null;
    let bestScore = coneDot;
    try {
        for (const e of dim.getEntities({ location: origin, maxDistance: maxRange })) {
            if (!e?.isValid || e.id === player.id || e.hasTag("tusk_decoy") || e.hasTag("tusk_rotation")) continue;
            const hp = e.getComponent("minecraft:health");
            if (!hp || hp.currentValue <= 0) continue;
            const c = { x: e.location.x, y: e.location.y + 0.95, z: e.location.z };
            const dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
            const dist = Math.hypot(dx, dy, dz) || 1;
            const dot = (dx / dist) * dir.x + (dy / dist) * dir.y + (dz / dist) * dir.z;
            if (dot > bestScore && dist <= blockDist + 1.5) {
                bestScore = dot;
                best = e;
            }
        }
    } catch { }
    return best;
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function lerpFlatDir(a, b, t) {
    return normalize({
        x: a.x + (b.x - a.x) * t,
        y: 0,
        z: a.z + (b.z - a.z) * t,
    });
}

function getLowHoleGroundY(dim, x, y, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let dy = 2; dy >= -3; dy--) {
        const by = Math.floor(y + dy);
        if (isSolidBlock(dim, bx, by, bz) && !isSolidBlock(dim, bx, by + 1, bz)) {
            return by + 1.05;
        }
    }
    return null;
}

function getHorizForward(player) {
    const v = player.getViewDirection();
    const h = Math.hypot(v.x, v.z);
    if (h > 0.05) return { x: v.x / h, y: 0, z: v.z / h };
    const yawRad = (player.getRotation().y * Math.PI) / 180;
    return { x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) };
}

function getGroundSlashY(dim, x, refY, z) {
    return getLowHoleGroundY(dim, x, refY, z) ?? (refY + 0.05);
}

function stepGroundSlash(dim, curPos, dir, stepDist) {
    const nextX = curPos.x + dir.x * stepDist;
    const nextZ = curPos.z + dir.z * stepDist;
    const bx = Math.floor(nextX);
    const bz = Math.floor(nextZ);
    const baseBy = Math.floor(curPos.y - 0.05);

    if (isSolidBlock(dim, bx, baseBy + 1, bz)) {
        if (!isSolidBlock(dim, bx, baseBy + 2, bz) && !isSolidBlock(dim, bx, baseBy + 3, bz)) {
            return { blocked: false, pos: { x: nextX, y: baseBy + 2.04, z: nextZ } };
        }
        return { blocked: true, pos: { x: nextX, y: curPos.y, z: nextZ } };
    }
    if (isSolidBlock(dim, bx, baseBy + 2, bz)) {
        return { blocked: true, pos: { x: nextX, y: curPos.y, z: nextZ } };
    }
    for (let dy = 0; dy >= -2; dy--) {
        const by = baseBy + dy;
        if (isSolidBlock(dim, bx, by, bz) && !isSolidBlock(dim, bx, by + 1, bz)) {
            return { blocked: false, pos: { x: nextX, y: by + 1.04, z: nextZ } };
        }
    }
    return { blocked: false, pos: { x: nextX, y: curPos.y, z: nextZ } };
}

let slashBlockRenderer = null;

function getGroundSplitBlockInfo(dim, wx, refY, wz) {
    const bx = Math.floor(wx);
    const bz = Math.floor(wz);
    const baseY = Math.floor(refY);
    for (let dy = 2; dy >= -4; dy--) {
        const by = baseY + dy;
        try {
            const b = dim.getBlock({ x: bx, y: by, z: bz });
            if (!b || b.isAir || b.isLiquid) continue;
            if (PassableBlock.test(b.typeId)) continue;
            if (!isSolidBlock(dim, bx, by + 1, bz)) {
                return { by, permutation: b.permutation };
            }
        } catch { }
    }
    try {
        return { by: baseY - 1, permutation: BlockPermutation.resolve("minecraft:dirt") };
    } catch {
        return null;
    }
}

function spawnGroundSplitBlocks(dim, centerPos, dir, lateralOffset = 0.36, scale = 0.72, sides = [-1, 1], jumpBase = 0.20) {
    if (!sides || sides.length === 0) return;
    slashBlockRenderer ??= new BlockRenderer();
    const splitYawDeg = Math.atan2(-dir.z, dir.x) * (180 / Math.PI);
    const right = { x: -dir.z, y: 0, z: dir.x };

    for (const side of sides) {
        const sideSign = side < 0 ? -1 : 1;
        const jitterFwd = (Math.random() - 0.5) * 0.14;
        const bx = centerPos.x + right.x * side * lateralOffset + dir.x * jitterFwd;
        const bz = centerPos.z + right.z * side * lateralOffset + dir.z * jitterFwd;
        const info = getGroundSplitBlockInfo(dim, bx, centerPos.y, bz);
        if (!info?.permutation) continue;

        const tiltDeg = sideSign * (24 + Math.random() * 10);
        try {
            slashBlockRenderer.drawBlock(
                { permutation: info.permutation },
                {
                    dimension: dim,
                    location: { x: bx - 0.5, y: info.by + 0.25, z: bz - 0.5 },
                    lifetimeSeconds: 0.52,
                    scale,
                    rotation: { x: tiltDeg, y: splitYawDeg, z: 0 },
                    jumpHeight: jumpBase + Math.random() * 0.12,
                }
            );
        } catch { }
    }
}

function spawnNailSlashWaveVFX(dim, origin, dir, primaryColor, maxDist = 3.3, opts = {}) {
    const speed = opts.speed ?? 16.5;
    const maxRange = opts.maxRange ?? 3.3;
    const scale = opts.scale ?? 1.0;
    const clampedDist = Math.max(1.2, Math.min(maxRange, maxDist));
    const life = Math.max(0.08, clampedDist / speed);
    const { fwd, right, up } = buildBasis(dir);


    const layers = [
        { yOff: 0.04, height: 1.04 * scale, bow: 0.92 * scale, tilt: 0, thickness: 0.30 * scale, color: primaryColor, alpha: 0.92, lead: 0 },
        { yOff: 0.04, height: 1.00 * scale, bow: 0.90 * scale, tilt: 0, thickness: 0.11 * scale, color: Colors.white, alpha: 0.98, lead: 0.08 },
    ];
    if (opts.includeWings !== false) {
        layers.push(
            { yOff: 0.02, height: 0.66 * scale, bow: 0.58 * scale, tilt: -0.14 * scale, thickness: 0.22 * scale, color: primaryColor, alpha: 0.85, lead: -0.05 },
            { yOff: 0.02, height: 0.66 * scale, bow: 0.58 * scale, tilt: 0.14 * scale, thickness: 0.22 * scale, color: primaryColor, alpha: 0.85, lead: -0.05 },
        );
    }
    for (const l of layers) {
        const p = {
            x: origin.x + fwd.x * l.lead,
            y: origin.y + l.yOff,
            z: origin.z + fwd.z * l.lead,
        };
        spawnVFX(dim, "tusk:nail_slash_wave", p, {
            fwd, right, up, speed, life,
            height: l.height,
            bow: l.bow,
            tilt: l.tilt,
            thickness: l.thickness,
            color: l.color,
            alpha: l.alpha,
        });
    }
}

function spawnCleanCutVFX(dim, target, dir, primaryColor, withImpactFrame = false) {
    const loc = target.location;
    const legCenter = { x: loc.x, y: loc.y + 0.44, z: loc.z };
    const torsoCenter = { x: loc.x, y: loc.y + 1.18, z: loc.z };

    for (const pos of [legCenter, torsoCenter]) {
        spawnImpactRing(dim, pos, { x: 0, y: 1, z: 0 }, { radius: 1.45, time: 0.20, color: primaryColor, alpha: 0.88 });
        spawnStarburst(dim, pos, { size: 1.30, life: 0.20 });
        spawnGlowFlash(dim, pos, { size: 1.55, life: 0.18, color: primaryColor, alpha: 0.90 });
    }
    spawnConeSparks(dim, torsoCenter, dir);
    try {
        dim.spawnParticle("xvoid:blood", legCenter);
        dim.spawnParticle("xvoid:blood", torsoCenter);
        dim.playSound("xvoid.hit_slash_M", torsoCenter, { volume: 0.9, pitch: 1.15 });
    } catch { }
    if (withImpactFrame) {
        triggerImpactFrame(dim, torsoCenter, 1);
    }
}

function processSlashWaveHits(caster, wave, segStart, segEnd) {
    const dim = wave.dim;
    const mid = {
        x: (segStart.x + segEnd.x) * 0.5,
        y: (segStart.y + segEnd.y) * 0.5 + 0.9,
        z: (segStart.z + segEnd.z) * 0.5,
    };
    const segDx = segEnd.x - segStart.x;
    const segDz = segEnd.z - segStart.z;
    const segLenSq = segDx * segDx + segDz * segDz || 1;
    const halfWidth = wave.halfWidth ?? 1.45;

    try {
        for (const e of dim.getEntities({ location: mid, maxDistance: 3.4 })) {
            if (!e?.isValid || e.id === caster.id || wave.hitIds.has(e.id)) continue;
            if (e.hasTag("tusk_decoy") || e.hasTag("tusk_rotation")) continue;
            const hpE = e.getComponent("minecraft:health");
            if (!hpE || hpE.currentValue <= 0) continue;

            const px = e.location.x - segStart.x;
            const pz = e.location.z - segStart.z;
            const t = clamp((px * segDx + pz * segDz) / segLenSq, 0, 1);
            const cx = segStart.x + segDx * t;
            const cz = segStart.z + segDz * t;
            const perpDist = Math.hypot(e.location.x - cx, e.location.z - cz);
            if (perpDist > halfWidth) continue;

            const wy = segStart.y + (segEnd.y - segStart.y) * t;
            if (e.location.y > wy + 2.25 || e.location.y + 1.85 < wy - 0.5) continue;

            wave.hitIds.add(e.id);
            applyHitscanDamage(caster, e, wave.dmg, {
                originPos: segStart,
                originViewDir: wave.dir,
                modifiers: { barrage: true, barragePush: 0.45, barrageDown: 0 },
            });
            applyBleed(e, 120, 2.0 * wave.spinMult, caster);
            spawnCleanCutVFX(dim, e, wave.dir, wave.color, !wave.impactFramed);
            wave.impactFramed = true;
        }
    } catch { }
}

function syncTuskLimbProps(player, mode, worldPos, dir) {
    if (!player?.isValid) return;
    try {
        player.setProperty("property:tim_limb", mode);
        if (mode === 2) {
            player.setProperty("property:tim_dx", 0);
            player.setProperty("property:tim_dy", 0);
            player.setProperty("property:tim_dz", 0);
            player.setProperty("property:tim_dir_x", 0);
            player.setProperty("property:tim_dir_y", -1);
            player.setProperty("property:tim_dir_z", 0);
            return;
        }


        const ref = { x: player.location.x, y: player.location.y, z: player.location.z };
        const d = normalize(dir ?? { x: 0, y: 0, z: 1 });
        player.setProperty("property:tim_dx", clamp(worldPos.x - ref.x, -64, 64));
        player.setProperty("property:tim_dy", clamp(worldPos.y - ref.y, -64, 64));
        player.setProperty("property:tim_dz", clamp(worldPos.z - ref.z, -64, 64));
        player.setProperty("property:tim_dir_x", clamp(d.x, -1, 1));
        player.setProperty("property:tim_dir_y", clamp(d.y, -1, 1));
        player.setProperty("property:tim_dir_z", clamp(d.z, -1, 1));
    } catch { }
}

function resetTuskLimbProps(player) {
    if (!player?.isValid) return;
    try {
        player.setProperty("property:tim_limb", 0);
        player.setProperty("property:tim_dx", 0);
        player.setProperty("property:tim_dy", 0);
        player.setProperty("property:tim_dz", 0);
        player.setProperty("property:tim_dir_x", 0);
        player.setProperty("property:tim_dir_y", -1);
        player.setProperty("property:tim_dir_z", 0);
        player.setProperty("property:tim_detach", 0);
    } catch { }
}

function resetOrphanedTuskState(player) {
    if (!player?.isValid) return;
    const hadDetached = player.hasTag("tusk_detached");
    const hadSpatial = player.hasTag("tusk_spatial");
    const hadRotation = player.hasTag("tusk_rotation");
    const hadLimb = (player.getProperty("property:tim_limb") ?? 0) !== 0;
    if (hadDetached) player.removeTag("tusk_detached");
    if (hadSpatial) player.removeTag("tusk_spatial");
    if (hadRotation) player.removeTag("tusk_rotation");
    if (hadLimb) resetTuskLimbProps(player);
    if (hadDetached || hadSpatial || hadRotation || hadLimb) {
        clearChargeTags(player);
        try { player.triggerEvent("xvoid:kb_normal"); } catch { }
        restorePlayerMovement(player);
    }
}


try {
    world.beforeEvents.playerLeave.subscribe((ev) => {
        const pid = ev.player?.id;
        if (!pid) return;
        activeCasts.delete(pid);
        pilotedArms.delete(pid);
        spatialWormholes.delete(pid);
    });
} catch { }

try {
    world.afterEvents.playerSpawn.subscribe((ev) => {
        const p = ev.player;
        if (!p?.isValid) return;
        if (!pilotedArms.has(p.id) && !spatialWormholes.has(p.id)) {
            resetOrphanedTuskState(p);
        }
    });
} catch { }

function clearChargeTags(player) {
    for (const tag of [
        "tusk_shot_queued", "chargeMB", "chargeMSB", "chargeTB", "chargeTSB",
        "chargeM", "chargeMS", "chargeT", "chargeTS", "charging", "chargingS"
    ]) {
        player.removeTag(tag);
    }
}

const FaceNormals = {
    Up: { x: 0, y: 1, z: 0 },
    Down: { x: 0, y: -1, z: 0 },
    North: { x: 0, y: 0, z: -1 },
    South: { x: 0, y: 0, z: 1 },
    East: { x: 1, y: 0, z: 0 },
    West: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    down: { x: 0, y: -1, z: 0 },
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
};

function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function snapAxis(v) {
    const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
    if (ax >= ay && ax >= az) return { x: Math.sign(v.x) || 1, y: 0, z: 0 };
    if (ay >= az) return { x: 0, y: Math.sign(v.y) || 1, z: 0 };
    return { x: 0, y: 0, z: Math.sign(v.z) || 1 };
}


function hasSurfaceSupport(dim, pos, n) {
    const behindSolid = isSolidBlock(dim, Math.floor(pos.x - n.x * 0.5), Math.floor(pos.y - n.y * 0.5), Math.floor(pos.z - n.z * 0.5));
    const frontOpen = !isSolidBlock(dim, Math.floor(pos.x + n.x * 0.3), Math.floor(pos.y + n.y * 0.3), Math.floor(pos.z + n.z * 0.3));
    return behindSolid && frontOpen;
}


function snapToFace(pos, n) {
    const p = { x: pos.x, y: pos.y, z: pos.z };
    for (const k of ["x", "y", "z"]) {
        if (n[k] === 0) continue;
        const block = Math.floor(pos[k] - n[k] * 0.5);
        const plane = n[k] > 0 ? block + 1 : block;
        p[k] = plane + n[k] * 0.05;
    }
    return p;
}


function rescueFromInsideBlock(dim, st) {
    const pos = st.holePos;
    const n = st.normal;
    const bx = Math.floor(pos.x);
    const by = Math.floor(pos.y);
    const bz = Math.floor(pos.z);
    const probeX = Math.floor(pos.x + n.x * 0.15);
    const probeY = Math.floor(pos.y + n.y * 0.15);
    const probeZ = Math.floor(pos.z + n.z * 0.15);


    if (isSolidBlock(dim, bx, by, bz) || isSolidBlock(dim, probeX, probeY, probeZ)) {
        for (let dy = 0; dy <= 4; dy++) {
            if (isSolidBlock(dim, bx, by + dy, bz) && !isSolidBlock(dim, bx, by + dy + 1, bz)) {
                st.normal = { x: 0, y: 1, z: 0 };
                st.holePos = { x: pos.x, y: by + dy + 1.05, z: pos.z };
                return;
            }
        }
        const dirs = [
            { x: 0, y: 1, z: 0 },
            { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
            { x: 0, y: -1, z: 0 },
        ];
        for (const d of dirs) {
            if (!isSolidBlock(dim, bx + d.x, by + d.y, bz + d.z)) {
                st.normal = d;
                st.holePos = snapToFace({
                    x: bx + 0.5 + d.x * 0.55,
                    y: by + 0.5 + d.y * 0.55,
                    z: bz + 0.5 + d.z * 0.55,
                }, d);
                return;
            }
        }
    }


    if (hasSurfaceSupport(dim, pos, n)) {
        st.holePos = snapToFace(pos, n);
    } else {

        const near = findNearestSolidAnchor(dim, pos, 1.5);
        if (near) {
            const axisN = snapAxis(near.normal);
            st.normal = axisN;
            st.holePos = snapToFace({
                x: near.point.x + axisN.x * 0.05,
                y: near.point.y + axisN.y * 0.05,
                z: near.point.z + axisN.z * 0.05,
            }, axisN);
        }
    }
}

const PilotAimExcludeTypes = new Set([
    "minecraft:item", "minecraft:xp_orb", "minecraft:arrow",
    "minecraft:armor_stand", "xvoid:dmg", "jjba:steelball", "jjba:knife", "jjba:nail",
    "xvoid:impact_frame", "xvoid:tim_arm"
]);

function isValidPilotAimTarget(e, ownerId) {
    if (!e?.isValid || e.id === ownerId) return false;
    if (PilotAimExcludeTypes.has(e.typeId)) return false;
    if (e.hasTag("tusk_decoy") || e.hasTag("tusk_rotation")) return false;
    try {
        const hp = e.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) return false;
    } catch {
        return false;
    }
    return true;
}

function getEntityAimCenter(e) {
    try {
        const head = e.getHeadLocation();
        if (head) {
            return {
                x: e.location.x,
                y: e.location.y + Math.max(0.35, (head.y - e.location.y) * 0.65),
                z: e.location.z,
            };
        }
    } catch { }
    return { x: e.location.x, y: e.location.y + 0.95, z: e.location.z };
}

function isMuzzleBlockedBefore(dim, muzzle, targetPos) {
    const dx = targetPos.x - muzzle.x;
    const dy = targetPos.y - muzzle.y;
    const dz = targetPos.z - muzzle.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= 0.45) return false;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    try {
        const hit = raycastSolidBlock(dim, muzzle, dir, dist - 0.35, { passableRe: PassableBlock });
        return Boolean(hit);
    } catch {
        return false;
    }
}


function getPilotAim(pa, view) {
    const n = pa.normal;
    let aim = normalize(view);
    const d = dot(aim, n);
    if (d < 0.5) aim = normalize({ x: aim.x + n.x * (0.5 - d), y: aim.y + n.y * (0.5 - d), z: aim.z + n.z * (0.5 - d) });
    const pivot = { x: pa.holePos.x + n.x * 0.18, y: pa.holePos.y + n.y * 0.18, z: pa.holePos.z + n.z * 0.18 };
    const muzzle = { x: pivot.x + aim.x * 0.62, y: pivot.y + aim.y * 0.62, z: pivot.z + aim.z * 0.62 };
    return { aim, pivot, muzzle };
}


function getBodyShoulderHolePos(savedBodyPos, holePos) {
    const dx = holePos.x - savedBodyPos.x;
    const dz = holePos.z - savedBodyPos.z;
    const h = Math.hypot(dx, dz);
    const fx = h > 0.001 ? dx / h : 0;
    const fz = h > 0.001 ? dz / h : 1;
    const rx = -fz;
    const rz = fx;
    return {
        x: savedBodyPos.x + fx * 0.42 + rx * 0.18,
        y: savedBodyPos.y + 0.05,
        z: savedBodyPos.z + fz * 0.42 + rz * 0.18,
    };
}

function clearPilotCamera(player) {
    try { player.camera.clear(); } catch { }
    try { player.runCommand("camera @s clear"); } catch { }
}

function computePilotCameraPos(player, anchorPos, view, normal = { x: 0, y: 1, z: 0 }, holePos = anchorPos) {
    const dim = player.dimension;
    let camDir = normalize({ x: -view.x + normal.x * 0.35, y: -view.y + normal.y * 0.35 + 0.15, z: -view.z + normal.z * 0.35 });
    const dn = dot(camDir, normal);
    if (dn < 0.3) {
        camDir = normalize({
            x: camDir.x + normal.x * (0.3 - dn),
            y: camDir.y + normal.y * (0.3 - dn),
            z: camDir.z + normal.z * (0.3 - dn),
        });
    }
    let dist = 1.85;
    try {
        const hit = raycastSolidBlock(dim, anchorPos, camDir, 2.05, { passableRe: PassableBlock });
        if (hit) {
            const f = hit.faceLocation;
            const d = Math.hypot(hit.block.x + f.x - anchorPos.x, hit.block.y + f.y - anchorPos.y, hit.block.z + f.z - anchorPos.z);
            dist = Math.max(0.25, d - 0.35);
        }
    } catch { }
    let camPos = {
        x: anchorPos.x + camDir.x * dist,
        y: anchorPos.y + camDir.y * dist,
        z: anchorPos.z + camDir.z * dist,
    };
    const surfDist = dot({ x: camPos.x - holePos.x, y: camPos.y - holePos.y, z: camPos.z - holePos.z }, normal);
    if (surfDist < 0.4) {
        const lift = 0.4 - surfDist;
        camPos = { x: camPos.x + normal.x * lift, y: camPos.y + normal.y * lift, z: camPos.z + normal.z * lift };
    }
    if (isSolidBlock(dim, Math.floor(camPos.x), Math.floor(camPos.y), Math.floor(camPos.z))) {
        camPos = { x: holePos.x + normal.x * 0.55, y: holePos.y + normal.y * 0.55, z: holePos.z + normal.z * 0.55 };
    }

    const pLoc = player.location;
    const pdx = camPos.x - pLoc.x;
    const pdz = camPos.z - pLoc.z;
    const pHoriz = Math.hypot(pdx, pdz);
    if (pHoriz < 1.25 && camPos.y >= pLoc.y - 0.35 && camPos.y <= pLoc.y + 2.05) {
        if (pHoriz > 0.05) {
            const push = 1.25 / pHoriz;
            camPos.x = pLoc.x + pdx * push;
            camPos.z = pLoc.z + pdz * push;
        } else {
            camPos.y = pLoc.y + 2.1;
        }
    }
    return camPos;
}

function updatePilotedCamera(player, anchorPos, view, normal = { x: 0, y: 1, z: 0 }, holePos = anchorPos) {
    const camPos = computePilotCameraPos(player, anchorPos, view, normal, holePos);
    const rot = player.getRotation();
    try {
        player.camera.setCamera("minecraft:free", {
            location: camPos,
            rotation: { x: rot.x, y: rot.y },
            easeOptions: { easeTime: 0.1, easeType: EasingType.Linear },
        });
    } catch { }
    return camPos;
}


function resolvePilotArmAim(player, st, view, camPos, maxRange = 28) {
    const dim = player.dimension;
    const { aim: baseArmAim, pivot, muzzle } = getPilotAim(st, view);
    const camOrigin = camPos ?? computePilotCameraPos(player, muzzle, view, st.normal, st.holePos);


    let camBlockDist = maxRange + 4;
    let camAimPoint = {
        x: muzzle.x + view.x * maxRange,
        y: muzzle.y + view.y * maxRange,
        z: muzzle.z + view.z * maxRange,
    };
    try {
        const bh = raycastSolidBlock(dim, camOrigin, view, maxRange + 4, { passableRe: PassableBlock });
        if (bh?.block) {
            const hp = resolveBlockHitPoint(camOrigin, view, bh);
            const fwdFromMuzzle = (hp.x - muzzle.x) * view.x + (hp.y - muzzle.y) * view.y + (hp.z - muzzle.z) * view.z;
            if (fwdFromMuzzle > 0.15) {
                camBlockDist = Math.hypot(hp.x - camOrigin.x, hp.y - camOrigin.y, hp.z - camOrigin.z);
                camAimPoint = hp;
            }
        }
    } catch { }


    let lockedTarget = null;
    let lockedPos = null;
    try {
        for (const h of dim.getEntitiesFromRay(camOrigin, view, { maxDistance: camBlockDist })) {
            const e = h.entity;
            if (!isValidPilotAimTarget(e, player.id)) continue;
            const tp = getEntityAimCenter(e);
            const dx = tp.x - muzzle.x, dy = tp.y - muzzle.y, dz = tp.z - muzzle.z;
            const mDist = Math.hypot(dx, dy, dz);
            if (mDist > maxRange || (dx * view.x + dy * view.y + dz * view.z) <= 0.1) continue;
            if (!isMuzzleBlockedBefore(dim, muzzle, tp)) {
                lockedTarget = e;
                lockedPos = tp;
                break;
            }
        }
    } catch { }

    if (!lockedTarget) {
        let bestScore = -Infinity;
        try {
            for (const e of dim.getEntities({ location: muzzle, maxDistance: maxRange })) {
                if (!isValidPilotAimTarget(e, player.id)) continue;
                const tp = getEntityAimCenter(e);
                const mdx = tp.x - muzzle.x, mdy = tp.y - muzzle.y, mdz = tp.z - muzzle.z;
                const mDist = Math.hypot(mdx, mdy, mdz);
                if (mDist > maxRange || mDist < 0.2) continue;
                if (mdx * view.x + mdy * view.y + mdz * view.z <= 0.1) continue;

                const cdx = tp.x - camOrigin.x, cdy = tp.y - camOrigin.y, cdz = tp.z - camOrigin.z;
                const cDist = Math.hypot(cdx, cdy, cdz) || 1;
                if (cDist > camBlockDist + 1.2) continue;
                const camDot = (cdx / cDist) * view.x + (cdy / cDist) * view.y + (cdz / cDist) * view.z;
                const crossDist = Math.hypot(tp.x - camAimPoint.x, tp.y - camAimPoint.y, tp.z - camAimPoint.z);
                if (camDot < 0.95 && crossDist > 1.35) continue;
                if (isMuzzleBlockedBefore(dim, muzzle, tp)) continue;

                const score = (camDot >= 0.95 ? camDot : 0.94 - crossDist * 0.02) - mDist * 0.0015;
                if (score > bestScore) {
                    bestScore = score;
                    lockedTarget = e;
                    lockedPos = tp;
                }
            }
        } catch { }
    }


    let shootDir;
    let hitType = "sky";
    let endPos;
    let endNormal = { x: -view.x, y: -view.y, z: -view.z };

    if (lockedTarget && lockedPos) {
        shootDir = normalize({ x: lockedPos.x - muzzle.x, y: lockedPos.y - muzzle.y, z: lockedPos.z - muzzle.z });
        hitType = "entity";
        endPos = lockedPos;
    } else {
        const toCross = { x: camAimPoint.x - muzzle.x, y: camAimPoint.y - muzzle.y, z: camAimPoint.z - muzzle.z };
        shootDir = dot(toCross, view) > 0.35 ? normalize(toCross) : view;

        let blockDist = maxRange;
        let blockHitPoint = null;
        let blockHitNormal = endNormal;
        try {
            const mb = raycastSolidBlock(dim, muzzle, shootDir, maxRange, { passableRe: PassableBlock });
            if (mb?.block) {
                const bp = resolveBlockHitPoint(muzzle, shootDir, mb);
                blockDist = Math.hypot(bp.x - muzzle.x, bp.y - muzzle.y, bp.z - muzzle.z);
                blockHitPoint = bp;
                if (FaceNormals[mb.face]) blockHitNormal = FaceNormals[mb.face];
            }
        } catch { }

        try {
            for (const h of dim.getEntitiesFromRay(muzzle, shootDir, { maxDistance: blockDist })) {
                if (!isValidPilotAimTarget(h.entity, player.id)) continue;
                lockedTarget = h.entity;
                hitType = "entity";
                endPos = {
                    x: muzzle.x + shootDir.x * h.distance,
                    y: muzzle.y + shootDir.y * h.distance,
                    z: muzzle.z + shootDir.z * h.distance,
                };
                break;
            }
        } catch { }

        if (hitType !== "entity") {
            if (blockHitPoint) {
                hitType = "block";
                endPos = blockHitPoint;
                endNormal = blockHitNormal;
            } else {
                endPos = {
                    x: muzzle.x + shootDir.x * maxRange,
                    y: muzzle.y + shootDir.y * maxRange,
                    z: muzzle.z + shootDir.z * maxRange,
                };
            }
        }
    }


    const n = st.normal;
    let armAim = shootDir;
    const dn = dot(armAim, n);
    if (dn < 0.5) {
        armAim = normalize({ x: armAim.x + n.x * (0.5 - dn), y: armAim.y + n.y * (0.5 - dn), z: armAim.z + n.z * (0.5 - dn) });
    }
    if (!Number.isFinite(armAim.x)) armAim = baseArmAim;

    return { pivot, muzzle, armAim, shootDir, hitType, endPos, endNormal, lockedTarget };
}

function spawnPilotAimIndicator(player, st, aimInfo) {
    if (!player?.isValid) return;
    const { muzzle, shootDir, hitType, endPos, endNormal } = aimInfo;
    const dx = endPos.x - muzzle.x;
    const dy = endPos.y - muzzle.y;
    const dz = endPos.z - muzzle.z;
    const totalDist = Math.hypot(dx, dy, dz);
    const isLocked = hitType === "entity";


    const startOffset = Math.min(0.28, totalDist * 0.25);
    const span = totalDist - startOffset;
    if (span > 0.35) {
        const dashHalf = isLocked ? 0.24 : 0.20;
        const step = Math.max(1.25, span / 12);
        const beamColor = isLocked ? Colors.crimson : Colors.blue;
        const beamWidth = isLocked ? 0.024 : 0.015;
        const beamAlpha = isLocked ? 0.72 : 0.36;
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


    const reticlePos = hitType === "block"
        ? {
            x: endPos.x + endNormal.x * 0.12 - shootDir.x * 0.06,
            y: endPos.y + endNormal.y * 0.12 - shootDir.y * 0.06,
            z: endPos.z + endNormal.z * 0.12 - shootDir.z * 0.06,
        }
        : endPos;

    if (isLocked) {
        spawnVFX(player, "tusk:aim_ring", reticlePos, {
            size: 0.48,
            life: 0.11,
            color: Colors.crimson,
            alpha: 0.95,
        });
        spawnVFX(player, "tusk:aim_dot", reticlePos, {
            size: 0.24,
            life: 0.11,
            color: Colors.crimson,
            alpha: 0.98,
        });
    } else if (hitType === "block") {
        spawnVFX(player, "tusk:aim_ring", reticlePos, {
            size: 0.36,
            life: 0.11,
            color: Colors.blue,
            alpha: 0.85,
        });
        spawnVFX(player, "tusk:aim_dot", reticlePos, {
            size: 0.18,
            life: 0.11,
            color: Colors.cyan,
            alpha: 0.95,
        });
    } else {
        spawnVFX(player, "tusk:aim_ring", reticlePos, {
            size: 0.32,
            life: 0.11,
            color: Colors.blue,
            alpha: 0.65,
        });
        spawnVFX(player, "tusk:aim_dot", reticlePos, {
            size: 0.16,
            life: 0.11,
            color: Colors.blue,
            alpha: 0.75,
        });
    }
}

function isSolidBlock(dim, bx, by, bz) {
    try {
        const b = dim.getBlock({ x: bx, y: by, z: bz });
        if (!b || b.isAir || b.isLiquid) return false;
        return !PassableBlock.test(b.typeId);
    } catch {
        return false;
    }
}

function findNearestSolidAnchor(dim, center, radius = 3.2) {
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    const rCeil = Math.ceil(radius);

    let bestDist = Infinity;
    let bestPoint = null;
    let bestNormal = { x: 0, y: 1, z: 0 };

    for (let x = cx - rCeil; x <= cx + rCeil; x++) {
        for (let y = cy - rCeil; y <= cy + rCeil; y++) {
            for (let z = cz - rCeil; z <= cz + rCeil; z++) {
                if (!isSolidBlock(dim, x, y, z)) continue;
                const px = Math.max(x, Math.min(x + 1, center.x));
                const py = Math.max(y, Math.min(y + 1, center.y));
                const pz = Math.max(z, Math.min(z + 1, center.z));
                const dx = center.x - px;
                const dy = center.y - py;
                const dz = center.z - pz;
                const dist = Math.hypot(dx, dy, dz);
                if (dist <= radius && dist < bestDist) {
                    bestDist = dist;
                    bestPoint = { x: px, y: py, z: pz };
                    if (dist > 0.02) {
                        bestNormal = { x: dx / dist, y: dy / dist, z: dz / dist };
                    } else {
                        const bcx = x + 0.5, bcy = y + 0.5, bcz = z + 0.5;
                        bestNormal = normalize({ x: center.x - bcx, y: center.y - bcy, z: center.z - bcz });
                    }
                }
            }
        }
    }
    return bestPoint ? { dist: bestDist, point: bestPoint, normal: bestNormal } : null;
}

function findInitialSurfaceHole(player) {
    const dim = player.dimension;
    const view = normalize(player.getViewDirection());
    const origin = getTuskShootOrigin(player);
    let holePos = null;
    let normal = { x: 0, y: 1, z: 0 };
    const rayOrigin = { x: origin.x, y: Math.max(origin.y, player.location.y + 0.65), z: origin.z };
    try {
        const hit = raycastSolidBlock(dim, rayOrigin, view, 6, { passableRe: PassableBlock });
        if (hit && FaceNormals[hit.face]) {
            normal = FaceNormals[hit.face];
            holePos = snapToFace({
                x: hit.block.x + hit.faceLocation.x + normal.x * 0.08,
                y: hit.block.y + hit.faceLocation.y + normal.y * 0.08,
                z: hit.block.z + hit.faceLocation.z + normal.z * 0.08,
            }, normal);
        }
    } catch { }
    if (!holePos) {
        const yawRad = (player.getRotation().y * Math.PI) / 180;
        const flat = { x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) };
        const fx = player.location.x + flat.x * 1.2;
        const fz = player.location.z + flat.z * 1.2;
        const gy = getLowHoleGroundY(dim, fx, player.location.y, fz);
        holePos = gy !== null
            ? { x: fx, y: gy, z: fz }
            : { x: player.location.x, y: player.location.y + 0.05, z: player.location.z };
        normal = { x: 0, y: 1, z: 0 };
    }
    return { holePos, normal, view, origin };
}

function stepSurfaceWormhole(dim, st, savedBodyPos, mv, view, rotY) {
    const n = st.normal;
    const yawRad = (rotY * Math.PI) / 180;
    const camFwdH = { x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) };
    const camRightH = { x: -Math.cos(yawRad), y: 0, z: -Math.sin(yawRad) };
    let fwdT;
    let rightT;
    if (Math.abs(n.y) > 0.5) {
        fwdT = camFwdH;
        rightT = camRightH;
    } else {
        const wallHoriz = { x: -n.z, y: 0, z: n.x };
        const signR = dot(camRightH, wallHoriz) >= 0 ? 1 : -1;
        rightT = { x: wallHoriz.x * signR, y: 0, z: wallHoriz.z * signR };
        const climbY = view.y < -0.6 ? -1 : 1;
        const sideSteer = dot(camFwdH, wallHoriz) * 0.45;
        fwdT = normalize({ x: wallHoriz.x * sideSteer, y: climbY, z: wallHoriz.z * sideSteer });
    }

    const moveVec = {
        x: fwdT.x * mv.y - rightT.x * mv.x,
        y: fwdT.y * mv.y - rightT.y * mv.x,
        z: fwdT.z * mv.y - rightT.z * mv.x,
    };
    const moveLen = Math.hypot(moveVec.x, moveVec.y, moveVec.z);
    const prevHole = { x: st.holePos.x, y: st.holePos.y, z: st.holePos.z };

    if (moveLen > 0.05) {
        const stepDir = normalize(moveVec);
        const stepLen = 0.42 * Math.min(1, moveLen);
        const rayStart = { x: st.holePos.x + n.x * 0.22, y: st.holePos.y + n.y * 0.22, z: st.holePos.z + n.z * 0.22 };
        let nextPos = null;
        let nextNormal = n;


        try {
            const hit = raycastSolidBlock(dim, rayStart, stepDir, stepLen + 0.3, { passableRe: PassableBlock });
            if (hit && FaceNormals[hit.face]) {
                nextNormal = FaceNormals[hit.face];
                nextPos = snapToFace({
                    x: hit.block.x + hit.faceLocation.x + nextNormal.x * 0.08,
                    y: hit.block.y + hit.faceLocation.y + nextNormal.y * 0.08,
                    z: hit.block.z + hit.faceLocation.z + nextNormal.z * 0.08,
                }, nextNormal);
            }
        } catch { }


        if (!nextPos) {
            const probe = {
                x: st.holePos.x + n.x * 0.2 + stepDir.x * (stepLen + 0.15),
                y: st.holePos.y + n.y * 0.2 + stepDir.y * (stepLen + 0.15),
                z: st.holePos.z + n.z * 0.2 + stepDir.z * (stepLen + 0.15),
            };
            if (isSolidBlock(dim, Math.floor(probe.x), Math.floor(probe.y), Math.floor(probe.z))) {
                const hitN = snapAxis({ x: -stepDir.x, y: -stepDir.y, z: -stepDir.z });
                const candidateWall = snapToFace({
                    x: probe.x + hitN.x * 0.35,
                    y: probe.y + hitN.y * 0.35,
                    z: probe.z + hitN.z * 0.35,
                }, hitN);
                if (hasSurfaceSupport(dim, candidateWall, hitN)) {
                    nextNormal = hitN;
                    nextPos = candidateWall;
                }
            }
        }


        if (nextPos && (nextNormal.x !== n.x || nextNormal.y !== n.y || nextNormal.z !== n.z)) {
            if (n.y > 0.5 && Math.abs(nextNormal.y) < 0.5) {
                nextPos.y = Math.max(nextPos.y, Math.floor(st.holePos.y) + 0.24);
            } else if (Math.abs(n.y) < 0.5 && nextNormal.y > 0.5) {
                nextPos.x += n.x * 0.18;
                nextPos.z += n.z * 0.18;
            }
        }

        if (!nextPos) {
            const cand = {
                x: st.holePos.x + stepDir.x * stepLen,
                y: st.holePos.y + stepDir.y * stepLen,
                z: st.holePos.z + stepDir.z * stepLen,
            };
            if (hasSurfaceSupport(dim, cand, n)) {

                nextPos = snapToFace(cand, n);
            } else {

                const wrapN = snapAxis(stepDir);
                const wrapPos = {
                    x: cand.x - n.x * 0.28 + stepDir.x * 0.12,
                    y: cand.y - n.y * 0.28 + stepDir.y * 0.12,
                    z: cand.z - n.z * 0.28 + stepDir.z * 0.12,
                };
                if (dot(wrapN, n) === 0 && hasSurfaceSupport(dim, wrapPos, wrapN)) {
                    nextNormal = wrapN;
                    nextPos = snapToFace(wrapPos, wrapN);
                }
            }
        }


        if (nextPos && Math.hypot(
            nextPos.x - savedBodyPos.x,
            nextPos.y - savedBodyPos.y,
            nextPos.z - savedBodyPos.z
        ) <= 28) {
            st.holePos = nextPos;
            st.normal = nextNormal;
        }
    }


    rescueFromInsideBlock(dim, st);
    return prevHole;
}


function enterPilotedArm(player) {
    if (pilotedArms.has(player.id)) return;
    const dim = player.dimension;
    const { holePos, normal, view, origin } = findInitialSurfaceHole(player);

    const savedBodyPos = { x: player.location.x, y: player.location.y, z: player.location.z };
    const st = {
        savedBodyPos,
        savedDimId: dim.id,
        holePos,
        normal,
        heldSlot: player.selectedSlotIndex,
        shotCd: 4,
        graceTicks: 8,
        angle: Math.random() * 360,
    };
    rescueFromInsideBlock(dim, st);
    pilotedArms.set(player.id, st);

    player.addTag("tusk_detached");
    try { player.triggerEvent("xvoid:kb_immune"); } catch { }
    try { player.clearVelocity(); } catch { }
    try { player.runCommand("inputpermission set @s jump disabled"); } catch { }

    const { pivot, muzzle } = getPilotAim(st, view);
    const camPos = updatePilotedCamera(player, muzzle, view, normal, holePos);
    const aimInfo = resolvePilotArmAim(player, st, view, camPos);
    syncTuskLimbProps(player, 1, pivot, aimInfo.armAim);
    spawnPilotAimIndicator(player, st, aimInfo);
    spawnWormholeTrail(dim, origin, holePos, normal);

    try {
        dim.playSound("xvoid.warp", holePos, { volume: 0.9, pitch: 1.35 });
        const bodyHole = getBodyShoulderHolePos(savedBodyPos, holePos);
        spawnVoidSpot(dim, bodyHole, { x: 0, y: 1, z: 0 }, 0.72, 0.42, 0.98);
        spawnWormholeSpiral(dim, bodyHole, { x: 0, y: 1, z: 0 }, {
            radius: 1.45, life: 0.42, turn: 0, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
        });
        spawnWormholeSpiral(dim, holePos, normal, {
            radius: 0.95, life: 0.42, turn: 0, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
        });
    } catch { }
}

function exitPilotedArm(player) {
    const st = pilotedArms.get(player.id);
    if (!st) return false;
    pilotedArms.delete(player.id);

    if (player?.isValid) {
        player.removeTag("tusk_detached");
        player.removeTag("tusk_rotation");
        clearChargeTags(player);
        resetTuskLimbProps(player);
        try { player.triggerEvent("xvoid:kb_normal"); } catch { }
        restorePlayerMovement(player);


        const pid = player.id;
        for (const delay of [2, 6]) {
            system.runTimeout(() => {
                if (player?.isValid && !pilotedArms.has(pid) && !spatialWormholes.has(pid)) clearPilotCamera(player);
            }, delay);
        }

        const d = Math.hypot(
            player.location.x - st.savedBodyPos.x,
            player.location.y - st.savedBodyPos.y,
            player.location.z - st.savedBodyPos.z
        );
        if (d > 0.25) {
            try {
                const dim = world.getDimension(st.savedDimId) ?? player.dimension;
                player.teleport(st.savedBodyPos, { dimension: dim });
            } catch { }
        }

        setScore(player, "cd", 16);
        setScore(player, "m1", 0);
        setScore(player, "sp1", -8);

        try {
            const bodyHole = getBodyShoulderHolePos(st.savedBodyPos, st.holePos);
            player.dimension.playSound("xvoid.warp", st.holePos, { volume: 0.85, pitch: 0.95 });
            spawnWormholeSpiral(player.dimension, bodyHole, { x: 0, y: 1, z: 0 }, {
                radius: 1.45, life: 0.38, turn: st.angle, spin: -300, rim: { x: 0.35, y: 0.55, z: 1.0 }
            });
            spawnWormholeSpiral(player.dimension, st.holePos, st.normal, {
                radius: 0.9, life: 0.38, turn: st.angle, spin: -300, rim: { x: 0.35, y: 0.55, z: 1.0 }
            });
        } catch { }
    }
    return true;
}

function fireFromPilotedArm(player) {
    const st = pilotedArms.get(player.id);
    if (!st) return false;
    if (st.shotCd > 0) return true;
    if (!consumeNails(player, 1)) {
        try { player.onScreenDisplay.setActionBar("§9Out of Nails!"); } catch { }
        return true;
    }

    const view = normalize(player.getViewDirection());
    const { muzzle } = getPilotAim(st, view);
    const camPos = computePilotCameraPos(player, muzzle, view, st.normal, st.holePos);
    const { shootDir } = resolvePilotArmAim(player, st, view, camPos);
    const dim = player.dimension;
    fireNailRay(player, 3, {
        origin: muzzle,
        dir: shootDir,
        muzzle,
        damage: 7.5,
        range: 28,
        unblockable: true,
        allowWormhole: false,
    });
    spawnWormholeSpiral(dim, muzzle, { x: -shootDir.x, y: -shootDir.y, z: -shootDir.z }, {
        radius: 0.6, life: 0.3, turn: st.angle, spin: 380, rim: { x: 0.35, y: 0.55, z: 1.0 }
    });
    try {
        st.shotCount = (st.shotCount ?? 0) + 1;
        dim.playSound("xvoid.5Mista_gun_fire2", muzzle, { volume: 0.88, pitch: 1.2 });
        dim.playSound(st.shotCount === 1 ? "johnny.skill_20" : "johnny.atkGM_01", muzzle, { volume: 0.85, pitch: 1.0 });
    } catch { }
    st.shotCd = 8;
    return true;
}

registerPrimaryOverride((player, actNum) => {
    if (actNum !== 3) return false;
    if (pilotedArms.has(player.id)) return fireFromPilotedArm(player);
    if (spatialWormholes.has(player.id)) return true;
    return false;
});


function handleStand2Reuse(source, itemStack) {
    if (!source?.isValid || source.typeId !== "minecraft:player") return;
    if (itemStack?.typeId !== "jjba:stand2") return;
    const st = pilotedArms.get(source.id);
    if (st && st.graceTicks <= 0) {
        exitPilotedArm(source);
        return;
    }
    const sw = spatialWormholes.get(source.id);
    if (sw && sw.graceTicks <= 0) {
        exitSpatialWormhole(source, true);
    }
}

world.afterEvents.itemStartUse.subscribe(({ source, itemStack }) => {
    handleStand2Reuse(source, itemStack);
});

world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
    handleStand2Reuse(source, itemStack);
});


function getBodySpatialPortalPos(savedBodyPos, holePos, fallbackFwd = { x: 0, y: 0, z: 1 }) {
    const dx = holePos.x - savedBodyPos.x;
    const dz = holePos.z - savedBodyPos.z;
    const h = Math.hypot(dx, dz);
    const fx = h > 0.001 ? dx / h : (fallbackFwd?.x ?? 0);
    const fz = h > 0.001 ? dz / h : (fallbackFwd?.z ?? 1);
    return {
        x: savedBodyPos.x + fx * 0.42,
        y: savedBodyPos.y + 0.05,
        z: savedBodyPos.z + fz * 0.42,
    };
}

function getSafeSpatialTeleportPos(dim, holePos, normal) {
    let base;
    if (normal.y > 0.5) {
        base = { x: holePos.x, y: holePos.y, z: holePos.z };
    } else if (normal.y < -0.5) {
        base = { x: holePos.x, y: holePos.y - 1.85, z: holePos.z };
    } else {
        base = {
            x: holePos.x + normal.x * 0.55,
            y: Math.floor(holePos.y),
            z: holePos.z + normal.z * 0.55,
        };

        if (!isSolidBlock(dim, Math.floor(base.x), Math.floor(base.y), Math.floor(base.z)) &&
            isSolidBlock(dim, Math.floor(base.x), Math.floor(base.y) - 1, Math.floor(base.z))) {

        } else if (isSolidBlock(dim, Math.floor(base.x), Math.floor(base.y), Math.floor(base.z))) {
            base.y += 1.05;
        }
    }

    if (isSolidBlock(dim, Math.floor(base.x), Math.floor(base.y + 1.65), Math.floor(base.z)) &&
        !isSolidBlock(dim, Math.floor(base.x), Math.floor(base.y) - 1, Math.floor(base.z))) {
        base.y -= 1.0;
    }
    return base;
}

function exitSpatialCastWindup(player) {
    if (!player?.isValid) return;
    player.removeTag("tusk_spatial");
    clearChargeTags(player);
    resetTuskLimbProps(player);
    try { player.playAnimation("animation.johnny.idle", { blendOutTime: 0.05 }); } catch { }
    try { player.triggerEvent("xvoid:kb_normal"); } catch { }
    cleanupSkillLock(player, 10, -8);
}

function enterSpatialWormhole(player, cast) {
    if (spatialWormholes.has(player.id)) return;
    const dim = player.dimension;
    const { holePos, normal, view, origin } = findInitialSurfaceHole(player);
    const yawRad = ((cast?.bodyYaw ?? player.getRotation().y) * Math.PI) / 180;
    const bodyFwd = normalize({ x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) });
    const savedBodyPos = cast?.savedBodyPos ?? { x: player.location.x, y: player.location.y, z: player.location.z };

    const sw = {
        savedBodyPos,
        savedDimId: cast?.savedDimId ?? dim.id,
        bodyFwd,
        holePos,
        normal,
        heldSlot: cast?.heldSlot ?? player.selectedSlotIndex,
        heldItemId: cast?.heldItemId ?? heldType(player),
        remainingTicks: 160,
        graceTicks: 8,
        angle: Math.random() * 360,
        tickCount: 0,
    };
    rescueFromInsideBlock(dim, sw);
    spatialWormholes.set(player.id, sw);

    player.addTag("tusk_spatial");
    syncTuskLimbProps(player, 4, sw.holePos, sw.normal);
    try { player.triggerEvent("xvoid:kb_immune"); } catch { }
    try { player.clearVelocity(); } catch { }
    try { player.runCommand("inputpermission set @s jump disabled"); } catch { }

    const camAnchor = {
        x: sw.holePos.x + sw.normal.x * 0.42,
        y: sw.holePos.y + sw.normal.y * 0.42,
        z: sw.holePos.z + sw.normal.z * 0.42,
    };
    updatePilotedCamera(player, camAnchor, view, sw.normal, sw.holePos);
    spawnWormholeTrail(dim, origin, sw.holePos, sw.normal);

    try {
        const bodyPortalPos = getBodySpatialPortalPos(savedBodyPos, sw.holePos, bodyFwd);
        dim.playSound("xvoid.warp", sw.holePos, { volume: 0.95, pitch: 1.25 });
        dim.playSound("johnny.skill_11", savedBodyPos, { volume: 0.9, pitch: 1.0 });
        spawnVoidSpot(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, 0.72, 0.42, 0.98);
        spawnWormholeSpiral(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, {
            radius: 1.45, life: 0.42, turn: 0, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
        });
        spawnVoidSpot(dim, sw.holePos, sw.normal, 0.58, 0.42, 0.98);
        spawnWormholeSpiral(dim, sw.holePos, sw.normal, {
            radius: 1.15, life: 0.42, turn: 0, spin: 380, rim: { x: 0.35, y: 0.55, z: 1.0 }
        });
    } catch { }
}

function exitSpatialWormhole(player, teleportToHole = false) {
    const sw = spatialWormholes.get(player.id);
    if (!sw) return false;
    spatialWormholes.delete(player.id);

    if (player?.isValid) {
        player.removeTag("tusk_spatial");
        player.removeTag("tusk_rotation");
        clearChargeTags(player);
        resetTuskLimbProps(player);
        try { player.triggerEvent("xvoid:kb_normal"); } catch { }
        restorePlayerMovement(player);

        const pid = player.id;
        for (const delay of [2, 6]) {
            system.runTimeout(() => {
                if (player?.isValid && !pilotedArms.has(pid) && !spatialWormholes.has(pid)) clearPilotCamera(player);
            }, delay);
        }

        const dim = world.getDimension(sw.savedDimId) ?? player.dimension;
        const bodyPortalPos = getBodySpatialPortalPos(sw.savedBodyPos, sw.holePos, sw.bodyFwd);

        if (teleportToHole) {
            const dest = getSafeSpatialTeleportPos(dim, sw.holePos, sw.normal);
            try {
                dim.playSound("xvoid.warp", sw.savedBodyPos, { volume: 0.9, pitch: 1.15 });
                dim.playSound("xvoid.warp", dest, { volume: 1.0, pitch: 0.95 });
                dim.playSound("johnny.skill_14", dest, { volume: 0.95, pitch: 1.0 });
                spawnWormholeSpiral(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, {
                    radius: 1.45, life: 0.38, turn: sw.angle, spin: -300, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
                spawnWormholeSpiral(dim, sw.holePos, sw.normal, {
                    radius: 1.45, life: 0.42, turn: sw.angle, spin: 420, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
                spawnImpactRing(dim, { x: dest.x, y: dest.y + 0.5, z: dest.z }, { x: 0, y: 1, z: 0 }, {
                    radius: 2.2, time: 0.28, color: Colors.blue, alpha: 0.92
                });
                spawnGlowFlash(dim, { x: dest.x, y: dest.y + 0.8, z: dest.z }, {
                    size: 1.6, life: 0.2, color: Colors.cyan, alpha: 0.85
                });
            } catch { }
            try { player.teleport(dest, { dimension: dim }); } catch { }
            try { player.clearVelocity(); } catch { }
        } else {
            const d = Math.hypot(
                player.location.x - sw.savedBodyPos.x,
                player.location.y - sw.savedBodyPos.y,
                player.location.z - sw.savedBodyPos.z
            );
            if (d > 0.15) {
                try { player.teleport(sw.savedBodyPos, { dimension: dim }); } catch { }
            }
            try {
                dim.playSound("xvoid.warp", sw.savedBodyPos, { volume: 0.8, pitch: 0.9 });
                spawnWormholeSpiral(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, {
                    radius: 1.45, life: 0.38, turn: sw.angle, spin: -300, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
                spawnWormholeSpiral(dim, sw.holePos, sw.normal, {
                    radius: 1.0, life: 0.36, turn: sw.angle, spin: -300, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
            } catch { }
        }

        setScore(player, "cd", 18);
        setScore(player, "m1", 0);
        setScore(player, "sp1", -8);
    }
    return true;
}


function startActiveMove(player, actNum, tagName) {
    player.removeTag(tagName);
    player.removeTag("tusk_shot_queued");
    setScore(player, "m1", 0);
    setScore(player, "sp1", 0);
    const nails = getNails(player);


    if (actNum === 0) {
        if (tagName === "chargeMB") {

            if (nails < 1) {
                try {
                    player.playSound("xvoid.oramuda_button2", { volume: 0.6, pitch: 0.6 });
                    player.onScreenDisplay.setActionBar("§bNeed at least 1 Nail for Shotgun!");
                } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 20, 20);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk1.shotgun");
            try {
                player.dimension.playSound("johnny.skill_06", player.location, { volume: 0.95, pitch: 1.0 });
                player.dimension.playSound("xvoid.steelball_turn", player.location, { volume: 0.75, pitch: 1.15 });
            } catch { }
            activeCasts.set(player.id, { kind: "shotgun", actNum: 1, ticks: 0, maxTicks: 20, fired: false });
        } else if (tagName === "chargeTB") {

            if (nails < 1) {
                try { player.onScreenDisplay.setActionBar("§bNeed at least 1 Nail for Ricochet Spin Nail!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 15, 16);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk1.nail");
            try {
                player.dimension.playSound("johnny.skill_03", player.location, { volume: 0.9, pitch: 1.0 });
                player.dimension.playSound("xvoid.steelball_turn2", player.location, { volume: 0.75, pitch: 1.25 });
            } catch { }
            activeCasts.set(player.id, { kind: "ricochet_nail", actNum: 1, ticks: 0, maxTicks: 21, fired: false });
        } else if (tagName === "chargeTSB") {

            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 25, 22);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk1.slash");
            try {
                player.dimension.playSound("johnny.original_15", player.location, { volume: 0.95, pitch: 1.0 });
                player.dimension.playSound("xvoid.steelball_turn2", player.location, { volume: 0.75, pitch: 1.25 });
            } catch { }
            activeCasts.set(player.id, { kind: "slash", actNum: 1, ticks: 0, maxTicks: 13, fired: false });
        }
        return;
    }


    if (actNum === 1) {
        if (tagName === "chargeTSB") {

            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 25, 22);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk2.slash");
            try {
                player.dimension.playSound("johnny.original_15", player.location, { volume: 0.9, pitch: 0.95 });
                player.dimension.playSound("xvoid.steelball_turn2", player.location, { volume: 0.8, pitch: 1.1 });
            } catch { }
            activeCasts.set(player.id, { kind: "slash", actNum: 2, ticks: 0, maxTicks: 13, fired: false });
        } else if (tagName === "chargeTB") {

            if (nails < 1) {
                try { player.onScreenDisplay.setActionBar("§eNeed 1 Nail for Piercing Golden Nail!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 16, 18);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk2.golden_pierce");
            try {
                player.dimension.playSound("xvoid.steelball_turn", player.location, { volume: 0.85, pitch: 1.0 });
                player.dimension.playSound("johnny.skill_12", player.location, { volume: 0.9, pitch: 1.0 });
            } catch { }
            activeCasts.set(player.id, { kind: "golden_pierce", actNum: 2, ticks: 0, maxTicks: 22, fired: false });
        } else if (tagName === "chargeMB") {

            if (nails < 2) {
                try { player.onScreenDisplay.setActionBar("§eNeed 2 Nails for Drilling Nail!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 30, 30);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk2.drill");
            try {
                player.dimension.playSound("xvoid.chargeMax", player.location, { volume: 0.8, pitch: 1.15 });
                player.dimension.playSound("johnny.skill_19", player.location, { volume: 0.95, pitch: 1.0 });
            } catch { }
            activeCasts.set(player.id, { kind: "drill_cast", actNum: 2, ticks: 0, maxTicks: 22, fired: false });
        }
        return;
    }


    if (actNum === 2) {
        if (tagName === "chargeTB") {

            if (pilotedArms.has(player.id)) {
                exitPilotedArm(player);
                return;
            }
            if (nails < 1) {
                try { player.onScreenDisplay.setActionBar("§9Need 1 Nail for Piloted Arm!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            consumeNails(player, 1);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            try {
                player.playAnimation("animation.tusk3.detach_set", {
                    blendOutTime: 0.05,
                    stopExpression: "q.property('property:tim_limb') != 0"
                });
            } catch { }
            try {
                player.dimension.playSound("xvoid.warp", player.location, { volume: 0.85, pitch: 1.35 });
                player.dimension.playSound("johnny.skill_13", player.location, { volume: 0.9, pitch: 1.0 });
            } catch { }
            activeCasts.set(player.id, { kind: "pilot_arm_cast", actNum: 3, ticks: 0, maxTicks: 8, fired: false });
        } else if (tagName === "chargeMB") {

            if (spatialWormholes.has(player.id)) {
                exitSpatialWormhole(player, true);
                return;
            }
            if (nails < 1) {
                try { player.onScreenDisplay.setActionBar("§9Need 1 Nail for Spatial Wormhole!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            consumeNails(player, 1);
            const savedBodyPos = { x: player.location.x, y: player.location.y, z: player.location.z };
            player.addTag("onSkill");
            player.addTag("tusk_spatial");
            setScore(player, "movesScript", 0);
            try { player.setProperty("property:tim_limb", 0); } catch { }
            try { player.triggerEvent("xvoid:kb_immune"); } catch { }
            try { player.clearVelocity(); } catch { }
            try { player.runCommand("inputpermission set @s jump disabled"); } catch { }
            try {
                player.playAnimation("animation.tusk3.suicide", {
                    blendOutTime: 0.05,
                    stopExpression: "q.property('property:tim_limb') != 0"
                });
            } catch { }
            try {
                player.dimension.playSound("johnny.hha_04", player.location, { volume: 0.95, pitch: 1.0 });
                player.dimension.playSound("xvoid.steelball_turn2", player.location, { volume: 0.8, pitch: 0.85 });
            } catch { }
            activeCasts.set(player.id, {
                kind: "spatial_wormhole_cast",
                actNum: 3,
                ticks: 0,
                maxTicks: 10,
                fired: false,
                savedBodyPos,
                savedDimId: player.dimension.id,
                bodyYaw: player.getRotation().y,
                heldSlot: player.selectedSlotIndex,
                heldItemId: heldType(player),
            });
        } else if (tagName === "chargeTSB") {

            if (nails < 1) {
                try { player.onScreenDisplay.setActionBar("§9Need 1 Nail for Pursuing Spatial Nail!"); } catch { }
                return;
            }
            if (getEnergy(player) < 5) {
                try { player.onScreenDisplay.setActionBar("§cNot enough Energy!"); } catch { }
                return;
            }
            useEnergy(player, 60, 24);
            player.addTag("onSkill");
            setScore(player, "movesScript", 0);
            playAnim(player, "animation.tusk3.nail");
            try {
                player.dimension.playSound("xvoid.steelball_turn2", player.location, { volume: 0.85, pitch: 1.25 });
                player.dimension.playSound("johnny.skill_09", player.location, { volume: 0.95, pitch: 1.0 });
            } catch { }
            activeCasts.set(player.id, { kind: "spatial_pursuit_cast", actNum: 3, ticks: 0, maxTicks: 12, fired: false });
        }
    }
}


system.runInterval(() => {
    const stopped = isTimeStopped();


    for (let i = drillLocks.length - 1; i >= 0; i--) {
        const dl = drillLocks[i];
        const target = dl.target;
        const caster = world.getEntity(dl.casterId);
        if (!target?.isValid || !caster?.isValid) {
            drillLocks.splice(i, 1);
            continue;
        }
        const hp = target.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) {
            drillLocks.splice(i, 1);
            continue;
        }
        if (stopped && !target.hasTag("ts") && target.hasTag("tsed")) continue;

        dl.remainingTicks--;
        dl.angle = (dl.angle + 54) % 360;
        const totalTicks = dl.totalTicks ?? 24;
        const progress = Math.max(0, Math.min(1, 1 - dl.remainingTicks / totalTicks));
        const dDir = dl.dir ?? { x: 0, y: 0, z: 1 };
        const negDir = { x: -dDir.x, y: -dDir.y, z: -dDir.z };
        const basis = buildBasis(dDir);
        const tLoc = { x: dl.anchorPos.x, y: dl.anchorPos.y, z: dl.anchorPos.z };
        const center = { x: tLoc.x, y: tLoc.y + 1.0, z: tLoc.z };


        try {
            target.teleport(tLoc);
            setScore(target, "stun", 4);
        } catch { }


        const baseRad = (dl.angle * Math.PI) / 180;
        for (let k = 0; k < 3; k++) {
            const frac = k / 2;
            const along = -0.85 + frac * 1.15;
            const ringR = 0.82 * (1 - frac * 0.72) * (1 - progress * 0.22);
            const theta = baseRad + k * 2.1;
            const cos = Math.cos(theta);
            const sin = Math.sin(theta);
            const pos = {
                x: center.x + dDir.x * along + (basis.right.x * cos + basis.up.x * sin) * ringR,
                y: center.y + dDir.y * along + (basis.right.y * cos + basis.up.y * sin) * ringR,
                z: center.z + dDir.z * along + (basis.right.z * cos + basis.up.z * sin) * ringR,
            };
            const sx = -basis.right.x * sin + basis.up.x * cos;
            const sy = -basis.right.y * sin + basis.up.y * cos;
            const sz = -basis.right.z * sin + basis.up.z * cos;
            const tangent = normalize({ x: dDir.x * 0.55 + sx, y: dDir.y * 0.55 + sy, z: dDir.z * 0.55 + sz });
            const bladeColor = k === 2 && progress > 0.65 ? Colors.white : (k % 2 === 0 ? Colors.hot : Colors.gold);
            spawnVFX(dl.dim, "tusk:nail_trail", pos, {
                s_x: 0.34, s_y: 0.068, life: 0.14, alpha: 0.96, color: bladeColor, dir: tangent,
            });
        }


        if (dl.remainingTicks % 2 === 0) {
            const boreEntry = { x: center.x - dDir.x * 0.32, y: center.y - dDir.y * 0.32, z: center.z - dDir.z * 0.32 };
            spawnWormholeSpiral(dl.dim, boreEntry, dDir, {
                radius: 0.76 + progress * 0.42,
                life: 0.22,
                turn: dl.angle,
                spin: 920,
                rim: progress > 0.65 ? Colors.gold : Colors.hot,
                alpha: 0.95,
            });
            spawnImpactRing(dl.dim, center, dDir, {
                radius: 1.05 + progress * 0.55,
                time: 0.18,
                color: progress > 0.72 ? Colors.white : Colors.hot,
                alpha: 0.92,
            });
            spawnConeSparks(dl.dim, boreEntry, negDir);
            spawnGlowFlash(dl.dim, center, {
                size: 0.85 + progress * 1.15,
                life: 0.16,
                color: progress > 0.75 ? Colors.white : (progress > 0.4 ? Colors.gold : Colors.hot),
                alpha: 0.95,
            });
        }
        if (dl.remainingTicks % 3 === 0) {
            try { dl.dim.spawnParticle("tusk:drill_hit", center); } catch { }
        }


        const sMult = dl.spinMult ?? 1;
        if (dl.remainingTicks > 0 && dl.remainingTicks % 4 === 0) {
            applyHitscanDamage(caster, target, 2.2 * sMult, { originPos: caster.location, originViewDir: caster.getViewDirection() });
            try { dl.dim.playSound("xvoid.steelball_turn2", center, { volume: 0.7, pitch: 1.15 + progress * 0.55 }); } catch { }
        }

        if (dl.remainingTicks <= 0) {
            applyHitscanDamage(caster, target, 5.5 * sMult, {
                originPos: caster.location,
                originViewDir: caster.getViewDirection(),
                modifiers: { heavy: true, heavyBack: 8, heavyUp: 1.8 }
            });
            const finDir = { x: 0.02, y: 1, z: 0.02 };
            triggerImpactFrame(dl.dim, center, 2);
            try {
                dl.dim.spawnParticle("tusk2:drill_burst", center);
                dl.dim.spawnParticle("tusk2:drill_finisher", center);
            } catch { }
            spawnGlowFlash(dl.dim, center, { size: 4.0, life: 0.24, color: Colors.white, alpha: 1.0 });
            spawnGlowFlash(dl.dim, center, { size: 3.3, life: 0.34, color: Colors.gold, alpha: 0.95 });
            spawnStarburst(dl.dim, center, { size: 3.6, life: 0.28 });
            spawnStarburst(dl.dim, center, { size: 2.1, life: 0.20 });
            spawnImpactRing(dl.dim, center, dDir, { radius: 3.5, time: 0.28, color: Colors.gold, alpha: 0.98 });
            spawnImpactRing(dl.dim, center, finDir, { radius: 4.0, time: 0.32, color: Colors.hot, alpha: 0.96 });
            spawnWormholeSpiral(dl.dim, center, dDir, { radius: 1.95, life: 0.34, turn: dl.angle, spin: 980, rim: Colors.gold, alpha: 0.98 });
            spawnVortexRing(dl.dim, center, finDir, { radius: 2.6, thickness: 0.42 });
            spawnPunchShockwave(dl.dim, center, finDir);
            spawnConeSparks(dl.dim, center, dDir);
            spawnConeSparks(dl.dim, center, negDir);
            try {
                dl.dim.playSound("xvoid.steelball_hit_L", center, { volume: 1.0, pitch: 1.0 });
                dl.dim.playSound("random.explode", center, { volume: 0.65, pitch: 1.35 });
            } catch { }
            drillLocks.splice(i, 1);
        }
    }


    for (let i = slashWaves.length - 1; i >= 0; i--) {
        const wave = slashWaves[i];
        const caster = world.getEntity(wave.ownerId);
        if (!caster?.isValid) {
            slashWaves.splice(i, 1);
            continue;
        }
        if (stopped && !caster.hasTag("ts")) continue;

        const prevPos = wave.pos;
        const step = stepGroundSlash(wave.dim, prevPos, wave.dir, wave.speed);
        if (step.blocked) {
            const wallPos = { x: prevPos.x + wave.dir.x * 0.45, y: prevPos.y + 0.95, z: prevPos.z + wave.dir.z * 0.45 };
            spawnImpactRing(wave.dim, wallPos, wave.dir, { radius: 1.65, time: 0.20, color: wave.color, alpha: 0.88 });
            spawnConeSparks(wave.dim, wallPos, { x: -wave.dir.x, y: 0.2, z: -wave.dir.z });
            try {
                wave.dim.spawnParticle("xvoid:dust_puff", wallPos);
                wave.dim.playSound("dig.stone", wallPos, { volume: 0.85, pitch: 1.2 });
            } catch { }
            slashWaves.splice(i, 1);
            continue;
        }

        const nextPos = step.pos;
        const segMid = {
            x: (prevPos.x + nextPos.x) * 0.5,
            y: (prevPos.y + nextPos.y) * 0.5 + 0.04,
            z: (prevPos.z + nextPos.z) * 0.5,
        };
        const furrowRollDeg = Math.atan2(wave.dir.z, wave.dir.x) * (180 / Math.PI);
        const furrowScale = wave.furrowScale ?? 1.0;

        spawnVFX(wave.dim, "tusk:nail_cut_flat", segMid, {
            s_x: wave.speed * 0.92, s_y: 0.20 * furrowScale, life: 0.36, alpha: 0.90, color: wave.color, roll: furrowRollDeg,
        });
        spawnVFX(wave.dim, "tusk:nail_cut_flat", segMid, {
            s_x: wave.speed * 0.86, s_y: 0.07 * furrowScale, life: 0.26, alpha: 0.98, color: Colors.white, roll: furrowRollDeg,
        });
        const splitSides = wave.splitSides ?? [-1, 1];
        if (splitSides.length > 0) {
            const totalTicks = wave.maxTicks || 1;
            const stepIdx = totalTicks - wave.remainingTicks;
            const pMid = (stepIdx + 0.5) / totalTicks;
            const pEnd = (stepIdx + 1) / totalTicks;
            const offStart = wave.splitOffset ?? 0.38;
            const offEnd = wave.splitOffsetEnd ?? offStart;
            const scaleStart = wave.splitScale ?? 0.72;
            const scaleEnd = wave.splitScaleEnd ?? scaleStart;
            const grows = scaleEnd > scaleStart;

            if (wave.splitMid !== false) {
                const midOffset = offStart + (offEnd - offStart) * pMid;
                const midScale = scaleStart + (scaleEnd - scaleStart) * pMid;
                const midJump = grows ? 0.14 + 0.16 * pMid : 0.20;
                spawnGroundSplitBlocks(wave.dim, segMid, wave.dir, midOffset, midScale, splitSides, midJump);
            }
            const endOffset = offStart + (offEnd - offStart) * pEnd;
            const endScale = scaleStart + (scaleEnd - scaleStart) * pEnd;
            const endJump = grows ? 0.14 + 0.16 * pEnd : 0.20;
            spawnGroundSplitBlocks(wave.dim, nextPos, wave.dir, endOffset + (grows ? 0 : 0.02), endScale, splitSides, endJump);
        }
        spawnVFX(wave.dim, "tusk:nail_mote", { x: nextPos.x, y: nextPos.y + 0.12, z: nextPos.z }, {
            size: 0.28, life: 0.24, color: wave.color, alpha: 0.92,
        });
        if (wave.remainingTicks % 2 === 1) {
            try { wave.dim.spawnParticle("xvoid:dust_puff", { x: nextPos.x, y: nextPos.y + 0.08, z: nextPos.z }); } catch { }
        }

        processSlashWaveHits(caster, wave, prevPos, nextPos);
        wave.pos = nextPos;
        wave.remainingTicks--;
        if (wave.remainingTicks <= 0) {
            slashWaves.splice(i, 1);
        }
    }


    for (const player of world.getAllPlayers()) {
        if (!player?.isValid) continue;
        const standC = getScore(player, "standC");
        const actNum = getScore(player, "act");
        const pid = player.id;

        if (standC !== 1) {
            if (activeCasts.has(pid)) {
                const c = activeCasts.get(pid);
                activeCasts.delete(pid);
                if (c?.kind === "spatial_wormhole_cast") exitSpatialCastWindup(player);
                else cleanupSkillLock(player, 10, -8);
            }
            if (pilotedArms.has(pid)) exitPilotedArm(player);
            if (spatialWormholes.has(pid)) exitSpatialWormhole(player, false);
            if (player.hasTag("tusk_detached") || player.hasTag("tusk_spatial") || player.hasTag("tusk_rotation")) {
                resetOrphanedTuskState(player);
            }
            continue;
        }

        const hp = player.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) {
            if (activeCasts.has(pid)) {
                const c = activeCasts.get(pid);
                activeCasts.delete(pid);
                if (c?.kind === "spatial_wormhole_cast") exitSpatialCastWindup(player);
            }
            if (pilotedArms.has(pid)) exitPilotedArm(player);
            if (spatialWormholes.has(pid)) exitSpatialWormhole(player, false);
            if (player.hasTag("tusk_detached") || player.hasTag("tusk_spatial") || player.hasTag("tusk_rotation")) {
                resetOrphanedTuskState(player);
            }
            continue;
        }


        if (!pilotedArms.has(pid) && !spatialWormholes.has(pid) && activeCasts.get(pid)?.kind !== "spatial_wormhole_cast") {
            if (
                player.hasTag("tusk_detached") ||
                player.hasTag("tusk_spatial") ||
                player.hasTag("tusk_rotation") ||
                (player.getProperty("property:tim_limb") ?? 0) !== 0
            ) {
                resetOrphanedTuskState(player);
            }
        }


        const pa = pilotedArms.get(pid);
        if (pa) {
            if (actNum !== 2 || player.hasTag("tsed")) {
                exitPilotedArm(player);
                continue;
            }
            if (stopped && !player.hasTag("ts") && player.hasTag("tsed")) continue;

            if (pa.graceTicks > 0) pa.graceTicks--;
            if (pa.shotCd > 0) pa.shotCd--;

            const held = heldType(player);
            const switchedAway = player.selectedSlotIndex !== pa.heldSlot || (held !== "jjba:stand2" && held !== "jjba:stand");
            const reusedStand2 = pa.graceTicks <= 0 && (
                player.hasTag("chargeTB") || player.hasTag("chargeMB") ||
                player.hasTag("chargeTSB") || player.hasTag("chargeMSB")
            );
            if (switchedAway || reusedStand2) {
                exitPilotedArm(player);
                continue;
            }


            useEnergy(player, 100 / 400, 20);
            if (getEnergy(player) <= 0) {
                exitPilotedArm(player);
                continue;
            }


            if (getScore(player, "sp1") >= 18) {
                setScore(player, "sp1", -6);
                fireFromPilotedArm(player);
            }

            const dim = player.dimension;
            const view = normalize(player.getViewDirection());
            let mv = { x: 0, y: 0 };
            try { mv = player.inputInfo?.getMovementVector?.() ?? { x: 0, y: 0 }; } catch { }
            const prevHole = stepSurfaceWormhole(dim, pa, pa.savedBodyPos, mv, view, player.getRotation().y);


            try { player.runCommand("effect @s slowness 1 255 true"); } catch { }
            try { player.clearVelocity(); } catch { }
            if (Math.hypot(
                player.location.x - pa.savedBodyPos.x,
                player.location.y - pa.savedBodyPos.y,
                player.location.z - pa.savedBodyPos.z
            ) > 0.05) {
                try { player.teleport(pa.savedBodyPos); } catch { }
            }

            const { pivot, muzzle } = getPilotAim(pa, view);
            const camPos = updatePilotedCamera(player, muzzle, view, pa.normal, pa.holePos);
            const aimInfo = resolvePilotArmAim(player, pa, view, camPos);
            syncTuskLimbProps(player, 1, pivot, aimInfo.armAim);
            spawnPilotAimIndicator(player, pa, aimInfo);


            if (Math.hypot(pa.holePos.x - prevHole.x, pa.holePos.y - prevHole.y, pa.holePos.z - prevHole.z) > 0.02) {
                spawnWormholeTrail(dim, prevHole, pa.holePos, pa.normal);
            }
            pa.tickCount = (pa.tickCount ?? 0) + 1;
            if (pa.tickCount % 2 === 0) {
                pa.angle = (pa.angle + 65) % 360;
                const bodyHole = getBodyShoulderHolePos(pa.savedBodyPos, pa.holePos);
                spawnVoidSpot(dim, bodyHole, { x: 0, y: 1, z: 0 }, 0.65, 0.24, 0.98);
                spawnWormholeSpiral(dim, bodyHole, { x: 0, y: 1, z: 0 }, {
                    radius: 1.25, life: 0.26, turn: pa.angle, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
                spawnVoidSpot(dim, pa.holePos, pa.normal, 0.32, 0.22, 0.98);
                spawnWormholeSpiral(dim, pa.holePos, pa.normal, {
                    radius: 0.55, life: 0.24, turn: pa.angle, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
            }
            continue;
        }


        const sw = spatialWormholes.get(pid);
        if (sw) {
            if (actNum !== 2 || player.hasTag("tsed")) {
                exitSpatialWormhole(player, false);
                continue;
            }
            if (stopped && !player.hasTag("ts") && player.hasTag("tsed")) continue;

            if (sw.graceTicks > 0) sw.graceTicks--;
            sw.remainingTicks--;

            const held = heldType(player);
            const switchedItem = player.selectedSlotIndex !== sw.heldSlot || held !== sw.heldItemId;
            if (switchedItem || player.isSneaking) {
                exitSpatialWormhole(player, false);
                continue;
            }

            const reusedStand2 = sw.graceTicks <= 0 && (
                player.hasTag("chargeTB") || player.hasTag("chargeMB") ||
                player.hasTag("chargeTSB") || player.hasTag("chargeMSB")
            );
            if (reusedStand2) {
                exitSpatialWormhole(player, true);
                continue;
            }


            useEnergy(player, 100 / 160, 20);
            if (sw.remainingTicks <= 0 || getEnergy(player) <= 0) {
                exitSpatialWormhole(player, true);
                continue;
            }

            const dim = player.dimension;
            const view = normalize(player.getViewDirection());
            let mv = { x: 0, y: 0 };
            try { mv = player.inputInfo?.getMovementVector?.() ?? { x: 0, y: 0 }; } catch { }
            const prevHole = stepSurfaceWormhole(dim, sw, sw.savedBodyPos, mv, view, player.getRotation().y);


            try { player.runCommand("effect @s slowness 1 255 true"); } catch { }
            try { player.clearVelocity(); } catch { }
            syncTuskLimbProps(player, 4, sw.holePos, sw.normal);
            if (Math.hypot(
                player.location.x - sw.savedBodyPos.x,
                player.location.y - sw.savedBodyPos.y,
                player.location.z - sw.savedBodyPos.z
            ) > 0.05) {
                try { player.teleport(sw.savedBodyPos); } catch { }
            }

            const camAnchor = {
                x: sw.holePos.x + sw.normal.x * 0.42,
                y: sw.holePos.y + sw.normal.y * 0.42,
                z: sw.holePos.z + sw.normal.z * 0.42,
            };
            updatePilotedCamera(player, camAnchor, view, sw.normal, sw.holePos);

            if (Math.hypot(sw.holePos.x - prevHole.x, sw.holePos.y - prevHole.y, sw.holePos.z - prevHole.z) > 0.02) {
                spawnWormholeTrail(dim, prevHole, sw.holePos, sw.normal);
            }
            sw.tickCount++;
            if (sw.tickCount % 2 === 0) {
                sw.angle = (sw.angle + 65) % 360;
                const bodyPortalPos = getBodySpatialPortalPos(sw.savedBodyPos, sw.holePos, sw.bodyFwd);

                spawnVoidSpot(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, 0.65, 0.24, 0.98);
                spawnWormholeSpiral(dim, bodyPortalPos, { x: 0, y: 1, z: 0 }, {
                    radius: 1.25, life: 0.26, turn: sw.angle, spin: 340, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });

                spawnVoidSpot(dim, sw.holePos, sw.normal, 0.55, 0.24, 0.98);
                spawnWormholeSpiral(dim, sw.holePos, sw.normal, {
                    radius: 1.05, life: 0.26, turn: -sw.angle, spin: 380, rim: { x: 0.35, y: 0.55, z: 1.0 }
                });
                spawnPursuitWormhole(dim, sw.holePos, {
                    radius: 0.42, life: 0.22, turn: sw.angle, spin: -420, rim: { x: 0.25, y: 0.45, z: 0.95 }
                });
            }
            continue;
        }


        const cast = activeCasts.get(pid);
        if (cast) {
            if (stopped && !player.hasTag("ts") && player.hasTag("tsed")) continue;
            cast.ticks++;

            if (cast.kind === "shotgun") {
                try { player.runCommand("effect @s slowness 1 2 true"); } catch { }
                if (cast.ticks === 3 || cast.ticks === 7) {
                    const o = getTuskShootOrigin(player);
                    const f = normalize(player.getViewDirection());
                    const cp = { x: o.x + f.x * 0.75, y: o.y - 0.06 + f.y * 0.75, z: o.z + f.z * 0.75 };
                    spawnVortexRing(player.dimension, cp, f, { radius: cast.ticks === 3 ? 1.1 : 0.85, thickness: 0.24 });
                    spawnGlowFlash(player.dimension, cp, { size: cast.ticks === 3 ? 1.1 : 1.5, life: 0.22, color: Colors.cyan, alpha: 0.8 });
                } else if (cast.ticks === 11 && !cast.fired) {
                    cast.fired = true;
                    const count = Math.min(5, getNails(player));
                    if (count > 0 && consumeNails(player, count)) {
                        const spinMult = consumeSpinNailBuff(player, 20, false);
                        const origin = getTuskShootOrigin(player);
                        const baseDir = normalize(player.getViewDirection());
                        const muzzle = { x: origin.x + baseDir.x * 0.9, y: origin.y + baseDir.y * 0.9, z: origin.z + baseDir.z * 0.9 };
                        const spreadYaws = count === 1 ? [0] : count === 2 ? [-5, 5] : count === 3 ? [-8, 0, 8] : count === 4 ? [-11, -3.5, 3.5, 11] : [-14, -7, 0, 7, 14];
                        for (const yaw of spreadYaws) {
                            const pitch = (Math.random() - 0.5) * 4;
                            fireNailRay(player, 1, {
                                origin,
                                dir: rotateDir(baseDir, yaw, pitch),
                                damage: 4.0,
                                spinMult,
                                triggerSpinCd: false,
                                range: 20,
                                speed: 3.85,
                                allowWormhole: false,
                                trailWidth: 0.22,
                                trailLag: 0.18,
                                applyModifiers: { barrage: true, barragePush: 2.5, barrageDown: 0 },
                            });
                        }
                        spawnGlowFlash(player.dimension, muzzle, { size: 2.3, life: 0.22, color: Colors.cyan, alpha: 0.95 });
                        spawnGlowFlash(player.dimension, muzzle, { size: 1.25, life: 0.16, color: Colors.white, alpha: 0.95 });
                        spawnStarburst(player.dimension, muzzle, { size: 2.0, life: 0.22 });
                        spawnImpactRing(player.dimension, muzzle, baseDir, { radius: 2.4, time: 0.25, color: Colors.cyan, alpha: 0.95 });
                        spawnVortexRing(player.dimension, muzzle, baseDir, { radius: 1.55, thickness: 0.34 });
                        spawnPunchShockwave(player.dimension, muzzle, baseDir);
                        spawnConeSparks(player.dimension, muzzle, baseDir);
                        try {
                            player.dimension.playSound("xvoid.5Mista_gun_fire3", origin, { volume: 0.95, pitch: 1.05 });
                            player.applyKnockback({ x: -baseDir.x * 0.45, z: -baseDir.z * 0.45 }, 0.08);
                            player.runCommand("camerashake add @s 0.32 0.14");
                        } catch { }
                    }
                }
            } else if (cast.kind === "ricochet_nail") {
                if (cast.ticks === 7 || cast.ticks === 11 || cast.ticks === 15) {
                    const shotIdx = (cast.ticks - 7) / 4;
                    if (consumeNails(player, 1)) {
                        if (cast.spinMult === undefined) {
                            cast.spinMult = consumeSpinNailBuff(player, 20, false);
                        }
                        const origin = getTuskShootOrigin(player);
                        const fwd = normalize(player.getViewDirection());
                        const yawJitter = shotIdx === 0 ? 0 : shotIdx === 1 ? -1.4 : 1.4;
                        const pitchJitter = shotIdx === 0 ? 0 : (Math.random() - 0.5) * 1.4;
                        const shotDir = yawJitter === 0 ? fwd : rotateDir(fwd, yawJitter, pitchJitter);
                        const muzzle = { x: origin.x + shotDir.x * 0.85, y: origin.y + shotDir.y * 0.85, z: origin.z + shotDir.z * 0.85 };
                        fireNailRay(player, 1, {
                            origin,
                            dir: shotDir,
                            damage: 6.0,
                            spinMult: cast.spinMult,
                            range: 42,
                            speed: 3.85,
                            maxBounces: 3,
                            bounceAimRadius: 12,
                            allowWormhole: false,
                            triggerSpinCd: false,
                            applyModifiers: { barrage: true, barragePush: 1.2, barrageDown: 0 },
                        });
                        try {
                            player.dimension.playSound("xvoid.5Mista_gun_fire1", origin, { volume: 0.88, pitch: 1.18 + shotIdx * 0.08 });
                            player.dimension.playSound("xvoid.steelball_turn", origin, { volume: 0.7, pitch: 1.25 + shotIdx * 0.06 });
                            spawnImpactRing(player.dimension, muzzle, shotDir, { radius: 0.9, time: 0.18, color: Colors.hot, alpha: 0.9 });
                            spawnStarburst(player.dimension, muzzle, { size: 0.95, life: 0.16 });
                            spawnConeSparks(player.dimension, muzzle, shotDir);
                            player.runCommand("camerashake add @s 0.07 0.07 positional");
                        } catch { }
                        if (shotIdx < 2 && getNails(player) > 0) {
                            playAnim(player, "animation.tusk1.nail_burst");
                        }
                    } else {
                        cast.ticks = cast.maxTicks;
                    }
                }
            } else if (cast.kind === "slash") {
                try { player.runCommand("effect @s slowness 1 3 true"); } catch { }
                const dim = player.dimension;
                const horizFwd = getHorizForward(player);
                const slashColor = cast.actNum === 2 ? Colors.gold : Colors.cyan;
                const accentColor = cast.actNum === 2 ? Colors.hot : Colors.blue;

                if (cast.ticks === 2 || cast.ticks === 4) {

                    const groundPos = {
                        x: player.location.x + horizFwd.x * 0.9,
                        y: getGroundSlashY(dim, player.location.x + horizFwd.x * 0.9, player.location.y, player.location.z + horizFwd.z * 0.9),
                        z: player.location.z + horizFwd.z * 0.9,
                    };
                    const right = { x: -horizFwd.z, y: 0, z: horizFwd.x };
                    for (const side of [-0.32, 0.32]) {
                        const hp = { x: groundPos.x + right.x * side, y: groundPos.y + 0.04, z: groundPos.z + right.z * side };
                        spawnImpactRing(dim, hp, { x: 0, y: 1, z: 0 }, { radius: 0.72, time: 0.16, color: slashColor, alpha: 0.88 });
                        spawnVFX(dim, "tusk:nail_mote", hp, { size: 0.24, life: 0.18, color: accentColor, alpha: 0.95 });
                    }
                    if (cast.ticks === 2) {
                        try {
                            dim.spawnParticle("xvoid:dust_puff", groundPos);
                        } catch { }
                    }
                } else if (cast.ticks === 5 && !cast.fired) {
                    cast.fired = true;
                    const isAct2 = cast.actNum === 2;
                    const spinMult = consumeSpinNailBuff(player, isAct2 ? 100 : 20, false);
                    const startX = player.location.x + horizFwd.x * 0.7;
                    const startZ = player.location.z + horizFwd.z * 0.7;
                    const groundY = getGroundSlashY(dim, startX, player.location.y, startZ);
                    const startGround = { x: startX, y: groundY, z: startZ };
                    const closeStart = {
                        x: player.location.x + horizFwd.x * 0.2,
                        y: groundY,
                        z: player.location.z + horizFwd.z * 0.2,
                    };


                    spawnImpactRing(dim, { x: startX, y: groundY + 0.06, z: startZ }, { x: 0, y: 1, z: 0 }, {
                        radius: isAct2 ? 1.85 : 1.55, time: 0.22, color: slashColor, alpha: 0.92,
                    });
                    if (isAct2) {
                        spawnGroundSplitBlocks(dim, startGround, horizFwd, 0.40, 0.76, [-1, 1]);
                    }
                    spawnConeSparks(dim, { x: startX, y: groundY + 0.35, z: startZ }, horizFwd);
                    try {
                        dim.spawnParticle("xvoid:dust_puff", { x: startX, y: groundY + 0.08, z: startZ });
                        dim.playSound("xvoid.hit_slash_L", startGround, { volume: 0.95, pitch: isAct2 ? 1.0 : 1.15 });
                        dim.playSound("xvoid.steelball_hit_S", startGround, { volume: 0.85, pitch: 1.25 });
                        dim.playSound("dig.gravel", startGround, { volume: 0.8, pitch: 0.95 });
                        player.runCommand("camerashake add @s 0.22 0.12");
                    } catch { }


                    const branches = isAct2
                        ? [{
                            yaw: 0, baseDmg: 9.5, travelDist: 5.3, ticks: 5,
                            halfWidth: 1.45, vfxScale: 1.15, includeWings: true,
                            furrowScale: 1.1, splitOffset: 0.40, splitScale: 0.76, splitMid: true, splitSides: [-1, 1],
                        }]
                        : [
                            {
                                yaw: 0, baseDmg: 4.5, travelDist: 3.3, ticks: 4,
                                halfWidth: 1.05, vfxScale: 0.92, includeWings: false,
                                furrowScale: 0.90, splitOffset: 0.22, splitScale: 0.46, splitMid: false, splitSides: [],
                            },
                            {
                                yaw: -20, baseDmg: 2.5, travelDist: 3.3, ticks: 4,
                                halfWidth: 0.78, vfxScale: 0.66, includeWings: false,
                                furrowScale: 0.55, splitOffset: 0.26, splitOffsetEnd: 0.46, splitScale: 0.36, splitScaleEnd: 0.84, splitMid: false, splitSides: [1],
                            },
                            {
                                yaw: 20, baseDmg: 2.5, travelDist: 3.3, ticks: 4,
                                halfWidth: 0.78, vfxScale: 0.66, includeWings: false,
                                furrowScale: 0.55, splitOffset: 0.26, splitOffsetEnd: 0.46, splitScale: 0.36, splitScaleEnd: 0.84, splitMid: false, splitSides: [-1],
                            },
                        ];

                    for (const br of branches) {
                        const branchDir = br.yaw === 0 ? horizFwd : rotateDir(horizFwd, br.yaw, 0);
                        if (!isAct2 && br.splitSides?.length) {
                            spawnGroundSplitBlocks(dim, startGround, branchDir, br.splitOffset, br.splitScale, br.splitSides, 0.14);
                        }
                        let wallDist = br.travelDist;
                        try {
                            const ray = raycastSolidBlock(
                                dim,
                                { x: startX, y: groundY + 1.0, z: startZ },
                                branchDir,
                                br.travelDist,
                                { passableRe: PassableBlock }
                            );
                            if (ray?.block) {
                                const f = ray.faceLocation;
                                wallDist = Math.hypot(
                                    ray.block.x + f.x - startX,
                                    ray.block.y + f.y - (groundY + 1.0),
                                    ray.block.z + f.z - startZ
                                );
                            }
                        } catch { }

                        const tickSpeed = br.travelDist / br.ticks;
                        spawnNailSlashWaveVFX(dim, startGround, branchDir, slashColor, wallDist, {
                            maxRange: br.travelDist,
                            speed: tickSpeed * 20,
                            scale: br.vfxScale,
                            includeWings: br.includeWings,
                        });

                        const wave = {
                            ownerId: player.id,
                            dim,
                            actNum: cast.actNum,
                            pos: { x: startGround.x, y: startGround.y, z: startGround.z },
                            dir: branchDir,
                            speed: tickSpeed,
                            remainingTicks: br.ticks,
                            maxTicks: br.ticks,
                            dmg: br.baseDmg * spinMult,
                            spinMult,
                            color: slashColor,
                            accent: accentColor,
                            halfWidth: br.halfWidth,
                            furrowScale: br.furrowScale,
                            splitOffset: br.splitOffset,
                            splitOffsetEnd: br.splitOffsetEnd,
                            splitScale: br.splitScale,
                            splitScaleEnd: br.splitScaleEnd,
                            splitMid: br.splitMid,
                            splitSides: br.splitSides,
                            hitIds: new Set(),
                            impactFramed: false,
                        };
                        processSlashWaveHits(player, wave, closeStart, startGround);
                        slashWaves.push(wave);
                    }
                }
            } else if (cast.kind === "golden_pierce") {

                try { player.runCommand("effect @s slowness 1 3 true"); } catch { }
                if (cast.ticks === 3) {
                    const o = getTuskShootOrigin(player);
                    const f = normalize(player.getViewDirection());
                    const wp = { x: o.x + f.x * 1.15, y: o.y - 0.08 + f.y * 1.15, z: o.z + f.z * 1.15 };
                    const goldenPos = { x: player.location.x, y: player.location.y + 1, z: player.location.z };

                    spawnGoldenRatioVFX(player.dimension, goldenPos, f, { size: 1.85, life: 0.58, turn: 10, spin: -30, alpha: 0.98 });
                    spawnGlowFlash(player.dimension, wp, { size: 1.35, life: 0.22, color: Colors.white, alpha: 0.85 });
                } else if (cast.ticks === 7 || cast.ticks === 10) {
                    const o = getTuskShootOrigin(player);
                    const f = normalize(player.getViewDirection());
                    const distAlong = cast.ticks === 7 ? 1.35 : 2.15;
                    const rp = { x: o.x + f.x * distAlong, y: o.y - 0.06 + f.y * distAlong, z: o.z + f.z * distAlong };
                    spawnImpactRing(player.dimension, rp, f, {
                        radius: cast.ticks === 7 ? 1.55 : 0.95,
                        time: 0.20,
                        color: cast.ticks === 7 ? Colors.gold : Colors.white,
                        alpha: 0.95,
                    });
                } else if (cast.ticks === 13 && !cast.fired) {
                    cast.fired = true;
                    if (consumeNails(player, 1)) {
                        const spinMult = consumeSpinNailBuff(player, 100, false);
                        const o = getTuskShootOrigin(player);
                        const f = normalize(player.getViewDirection());
                        const muzzle = { x: o.x + f.x * 1.1, y: o.y + f.y * 1.1, z: o.z + f.z * 1.1 };
                        fireNailRay(player, 2, {
                            origin: o,
                            dir: f,
                            damage: 12.5,
                            spinMult,
                            triggerSpinCd: false,
                            range: 34,
                            speed: 4.35,
                            pierce: true,
                            maxPierce: 6,
                            trailWidth: 0.34,
                            trailLag: 0.32,
                            trailColor: Colors.gold,
                            trailStyle: "standard",
                            applyModifiers: { heavy: true, heavyBack: 5, heavyUp: 0.5 },
                            onHitEntity: (_target, hitPos) => {
                                spawnImpactRing(player.dimension, hitPos, f, { radius: 2.3, time: 0.24, color: Colors.white, alpha: 0.96 });
                                spawnStarburst(player.dimension, hitPos, { size: 1.9, life: 0.22 });
                                spawnGlowFlash(player.dimension, hitPos, { size: 2.1, life: 0.22, color: Colors.gold, alpha: 0.95 });
                            },
                        });

                        for (const dRing of [1.2, 4.2, 7.6]) {
                            const rp = { x: o.x + f.x * dRing, y: o.y + f.y * dRing, z: o.z + f.z * dRing };
                            spawnImpactRing(player.dimension, rp, f, { radius: 2.6 - dRing * 0.14, time: 0.28, color: Colors.gold, alpha: 0.95 });
                        }
                        spawnGlowFlash(player.dimension, muzzle, { size: 2.7, life: 0.24, color: Colors.gold, alpha: 0.96 });
                        spawnGlowFlash(player.dimension, muzzle, { size: 1.5, life: 0.18, color: Colors.white, alpha: 0.98 });
                        spawnStarburst(player.dimension, muzzle, { size: 2.4, life: 0.24 });
                        spawnPunchShockwave(player.dimension, muzzle, f);
                        spawnConeSparks(player.dimension, muzzle, f);
                        try {
                            player.dimension.playSound("xvoid.5Mista_gun_fire1", o, { volume: 1.0, pitch: 0.9 });
                            player.dimension.playSound("xvoid.steelball_hit_L", o, { volume: 0.85, pitch: 1.25 });
                            player.runCommand("camerashake add @s 0.32 0.15");
                        } catch { }
                    }
                }
            } else if (cast.kind === "drill_cast") {

                try { player.runCommand("effect @s slowness 1 3 true"); } catch { }
                if (cast.ticks === 3 || cast.ticks === 6 || cast.ticks === 9 || cast.ticks === 11) {
                    const o = getTuskShootOrigin(player);
                    const f = normalize(player.getViewDirection());
                    const wp = { x: o.x + f.x * 0.95, y: o.y - 0.06 + f.y * 0.95, z: o.z + f.z * 0.95 };
                    const rad = cast.ticks === 3 ? 1.15 : cast.ticks === 6 ? 0.90 : cast.ticks === 9 ? 0.68 : 0.48;
                    spawnWormholeSpiral(player.dimension, wp, f, {
                        radius: rad,
                        life: 0.22,
                        turn: cast.ticks * 95,
                        spin: 760,
                        rim: cast.ticks >= 9 ? Colors.gold : Colors.hot,
                        alpha: 0.95,
                    });
                    spawnImpactRing(player.dimension, wp, f, {
                        radius: rad * 1.25,
                        time: 0.18,
                        color: cast.ticks >= 9 ? Colors.gold : Colors.hot,
                        alpha: 0.90,
                    });
                    spawnGlowFlash(player.dimension, wp, {
                        size: cast.ticks >= 9 ? 1.85 : 1.15,
                        life: 0.18,
                        color: cast.ticks >= 11 ? Colors.white : Colors.hot,
                        alpha: 0.95,
                    });
                } else if (cast.ticks === 13 && !cast.fired) {
                    cast.fired = true;
                    if (consumeNails(player, 2)) {
                        const spinMult = consumeSpinNailBuff(player, 100, false);
                        const o = getTuskShootOrigin(player);
                        const f = normalize(player.getViewDirection());
                        const muzzle = { x: o.x + f.x * 0.95, y: o.y + f.y * 0.95, z: o.z + f.z * 0.95 };
                        fireNailRay(player, 2, {
                            origin: o,
                            dir: f,
                            damage: 5.0,
                            spinMult,
                            triggerSpinCd: false,
                            range: 28,
                            speed: 3.85,
                            actOverride: 3,
                            trailWidth: 0.28,
                            trailLag: 0.34,
                            trailColor: Colors.hot,
                            trailStyle: "corkscrew",
                            onHitEntity: (target, hitPos) => {
                                spawnWormholeSpiral(player.dimension, hitPos, f, {
                                    radius: 1.05, life: 0.30, turn: 0, spin: 900, rim: Colors.gold, alpha: 0.98,
                                });
                                spawnImpactRing(player.dimension, hitPos, f, { radius: 2.1, time: 0.24, color: Colors.gold, alpha: 0.96 });
                                spawnGlowFlash(player.dimension, hitPos, { size: 2.4, life: 0.22, color: Colors.white, alpha: 0.98 });
                                spawnStarburst(player.dimension, hitPos, { size: 1.8, life: 0.20 });
                                spawnConeSparks(player.dimension, hitPos, { x: -f.x, y: -f.y, z: -f.z });
                                try { player.dimension.spawnParticle("tusk:drill_hit", hitPos); } catch { }
                                drillLocks.push({
                                    target,
                                    casterId: player.id,
                                    dim: target.dimension,
                                    dir: f,
                                    anchorPos: { x: target.location.x, y: target.location.y, z: target.location.z },
                                    totalTicks: 24,
                                    remainingTicks: 24,
                                    angle: 0,
                                    spinMult,
                                });
                            },
                        });
                        spawnWormholeSpiral(player.dimension, muzzle, f, {
                            radius: 1.05, life: 0.28, turn: 0, spin: 920, rim: Colors.hot, alpha: 0.96,
                        });
                        spawnWormholeSpiral(player.dimension, { x: o.x + f.x * 1.8, y: o.y + f.y * 1.8, z: o.z + f.z * 1.8 }, f, {
                            radius: 0.70, life: 0.26, turn: 90, spin: 920, rim: Colors.gold, alpha: 0.95,
                        });
                        spawnImpactRing(player.dimension, muzzle, f, { radius: 2.0, time: 0.22, color: Colors.gold, alpha: 0.96 });
                        spawnImpactRing(player.dimension, { x: o.x + f.x * 1.8, y: o.y + f.y * 1.8, z: o.z + f.z * 1.8 }, f, { radius: 1.35, time: 0.20, color: Colors.white, alpha: 0.92 });
                        spawnGlowFlash(player.dimension, muzzle, { size: 2.4, life: 0.22, color: Colors.white, alpha: 0.96 });
                        spawnGlowFlash(player.dimension, muzzle, { size: 1.8, life: 0.24, color: Colors.hot, alpha: 0.92 });
                        spawnStarburst(player.dimension, muzzle, { size: 1.75, life: 0.20 });
                        spawnConeSparks(player.dimension, muzzle, f);
                        try {
                            player.dimension.playSound("xvoid.5Mista_gun_fire1", o, { volume: 1.0, pitch: 0.85 });
                            player.runCommand("camerashake add @s 0.35 0.16");
                        } catch { }
                    }
                }
            } else if (cast.kind === "spatial_pursuit_cast") {
                try { player.runCommand("effect @s slowness 1 3 true"); } catch { }
                if (cast.ticks === 5 && !cast.fired) {
                    cast.fired = true;
                    if (consumeNails(player, 1)) {
                        const spinMult = consumeSpinNailBuff(player, 20, false);
                        const origin = getTuskShootOrigin(player);
                        const view = normalize(player.getViewDirection());
                        const fh = Math.hypot(view.x, view.z) || 1;
                        const horizFwd = { x: view.x / fh, y: 0, z: view.z / fh };

                        const groundDir = normalize({ x: horizFwd.x * 0.55, y: -0.85, z: horizFwd.z * 0.55 });
                        let groundPos = {
                            x: player.location.x + horizFwd.x * 1.35,
                            y: player.location.y,
                            z: player.location.z + horizFwd.z * 1.35,
                        };
                        let groundNormal = { x: 0, y: 1, z: 0 };
                        try {
                            const hit = raycastSolidBlock(player.dimension, origin, groundDir, 6, {
                                passableRe: PassableBlock,
                            });
                            if (hit?.block) {
                                groundPos = {
                                    x: hit.block.location.x + (hit.faceLocation?.x ?? 0.5),
                                    y: hit.block.location.y + (hit.faceLocation?.y ?? 1.0),
                                    z: hit.block.location.z + (hit.faceLocation?.z ?? 0.5),
                                };
                                groundNormal = FaceNormals[hit.face] ?? { x: 0, y: 1, z: 0 };
                            }
                        } catch { }

                        fireNailRay(player, 3, {
                            origin,
                            dir: groundDir,
                            damage: 6.5,
                            spinMult,
                            triggerSpinCd: false,
                            range: 4.5,
                            speed: 3.5,
                            allowWormhole: false,
                        });
                        spawnSpatialPursuitWormhole(player, groundPos, groundNormal, horizFwd, spinMult, {
                            aimOrigin: player.getHeadLocation(),
                            aimDir: view,
                        });
                        spawnImpactRing(player.dimension, groundPos, groundNormal, { radius: 2.8, time: 0.28, color: Colors.blue, alpha: 0.96 });
                        spawnImpactRing(player.dimension, groundPos, groundNormal, { radius: 1.7, time: 0.22, color: Colors.cyan, alpha: 0.92 });
                        spawnGlowFlash(player.dimension, groundPos, { size: 2.3, life: 0.22, color: Colors.blue, alpha: 0.92 });
                        spawnStarburst(player.dimension, groundPos, { size: 1.8, life: 0.20 });
                        spawnConeSparks(player.dimension, groundPos, groundNormal);
                        try {
                            player.dimension.playSound("xvoid.5Mista_gun_fire1", origin, { volume: 0.9, pitch: 1.15 });
                        } catch { }
                    }
                }
            } else if (cast.kind === "spatial_wormhole_cast") {
                try { player.runCommand("effect @s slowness 1 255 true"); } catch { }
                try { player.clearVelocity(); } catch { }
                if (cast.savedBodyPos && Math.hypot(
                    player.location.x - cast.savedBodyPos.x,
                    player.location.y - cast.savedBodyPos.y,
                    player.location.z - cast.savedBodyPos.z
                ) > 0.05) {
                    try { player.teleport(cast.savedBodyPos); } catch { }
                }
                const switchedItem = player.selectedSlotIndex !== cast.heldSlot || heldType(player) !== cast.heldItemId;
                if (actNum !== 2 || player.hasTag("tsed") || switchedItem || player.isSneaking) {
                    activeCasts.delete(pid);
                    exitSpatialCastWindup(player);
                    continue;
                }
                if (cast.ticks === 10 && !cast.fired) {
                    cast.fired = true;
                    try { player.dimension.playSound("xvoid.5Mista_gun_fire1", player.location, { volume: 0.9, pitch: 1.1 }); } catch { }
                    activeCasts.delete(pid);
                    cleanupSkillLock(player, 5, -5);
                    enterSpatialWormhole(player, cast);
                    continue;
                }
            } else if (cast.kind === "pilot_arm_cast") {
                try { player.runCommand("effect @s slowness 1 3 true"); } catch { }
                if (cast.ticks === 6 && !cast.fired) {
                    cast.fired = true;
                    try { player.dimension.playSound("xvoid.5Mista_gun_fire1", player.location, { volume: 0.9, pitch: 1.2 }); } catch { }
                    activeCasts.delete(pid);
                    cleanupSkillLock(player, 5, -5);
                    enterPilotedArm(player);
                    continue;
                }
            }

            if (cast.ticks >= cast.maxTicks) {
                activeCasts.delete(pid);
                cleanupSkillLock(player, 12, -10);
            }
            continue;
        }


        const isBusy =
            player.hasTag("onSkill") ||
            player.hasTag("blocking") ||
            player.hasTag("clashing") ||
            player.hasTag("tsed") ||
            player.hasTag("tusk_rotation") ||
            player.hasTag("tusk_detached") ||
            player.hasTag("tusk_spatial") ||
            pilotedArms.has(pid) ||
            spatialWormholes.has(pid) ||
            getScore(player, "stun") > 1 ||
            getScore(player, "cd") !== 0;

        for (const tag of ["chargeMB", "chargeTB", "chargeTSB"]) {
            if (!player.hasTag(tag)) continue;
            if (isBusy) {
                player.removeTag(tag);
                continue;
            }
            startActiveMove(player, actNum, tag);
            break;
        }
    }
}, 1);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    activeCasts.delete(playerId);
    pilotedArms.delete(playerId);
    spatialWormholes.delete(playerId);
});
