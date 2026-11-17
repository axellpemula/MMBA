import { world, system, ItemStack } from "@minecraft/server";
import * as mc from "@minecraft/server";
import { getSpecial, setSpecial } from "../../energy.js";
import { applyHitscanDamage } from "../../damage/damage.js";
import { calculateArmorReduction } from "../../damage/def.js";
import { applyHeavyKnockback } from "../../damage/physics.js";
import { recordDamageOverride } from "../../damage/indicator.js";
import { breakGuard } from "../basic_combat.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { Colors, spawnImpactRing, spawnGlowFlash, spawnStarburst, spawnConeSparks, spawnTracer, spawnVortexRing, spawnPunchShockwave, spawnVFX } from "../../utils/vfx.js";
import { infuseFloatBallWithSatellites, isSpinUser } from "./spin.js";
import { getTimDetachedShootOrigin, getTimDetachedShootDir } from "../tim/tim.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "../tim/timHitboxState.js";

const WbItem = "jjba:wrecking_ball";
const WbEntity = "jjba:steelball";
const HoldTicks = 5;
const DoubleSneakWindow = 8;
const MaxGuardTicks = 60;
const GuardDrainPerTick = 0.7;

const ExcludeTypes = [WbEntity, "jjba:nail", "minecraft:item", "xvoid:dmg", "minecraft:xp_orb", "minecraft:arrow", "jjba:knife", "minecraft:armor_stand"];
const DeflectTypes = new Set(["minecraft:arrow", "jjba:knife", WbEntity, "minecraft:snowball", "minecraft:trident", "minecraft:fireball", "minecraft:small_fireball"]);
const Passable = /air|grass|flower|fern|vine|torch|snow_layer|sapling|bush|carpet|button|lever|sign|rail|redstone_wire|pressure_plate|tripwire|dead_bush|seagrass|kelp|light_block|structure_void/;

const players = new Map();
const balls = new Set();
const satellites = new Set();
const mines = new Set();
const ataxiaTimers = new Map();
const ataxiaState = new Map();
let tick = 0;

function P(player) {
    let s = players.get(player.id);
    if (!s) {
        s = {
            exact: getSpecial(player),
            wasSneak: false,
            sneakTaps: [],
            use: null,
            guarding: false,
            guardTicks: 0,
            guardCharged: false
        };
        players.set(player.id, s);
    }
    return s;
}

const held = (p) => { try { return p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex); } catch { return undefined; } };
const holdingWB = (p) => held(p)?.typeId === WbItem;
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const eyeOf = (p) => getTimDetachedShootOrigin(p) ?? { x: p.location.x, y: p.location.y + 1.4, z: p.location.z };
const chest = (e) => {
    if (e?.typeId === TimHitboxType) return { x: e.location.x, y: e.location.y + 0.2, z: e.location.z };
    return (e?.typeId === "minecraft:player" && getTimDetachedShootOrigin(e)) || { x: e.location.x, y: e.location.y + 1.0, z: e.location.z };
};

function setExact(player, s, v) {
    s.exact = Math.max(0, Math.min(100, v));
    setSpecial(player, s.exact);
}
function syncExact(player, s) {
    const real = getSpecial(player);
    if (Math.abs(real - Math.round(s.exact)) > 1) s.exact = real;
}

function isSolidAt(dim, pos) {
    try {
        const b = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
        if (!b || b.isAir || b.isLiquid) return false;
        return !Passable.test(b.typeId);
    } catch { return false; }
}

function targetsNear(dim, pos, r, ownerId) {
    try {
        const ents = dim.getEntities({ location: pos, maxDistance: r + 1.5, excludeTypes: ExcludeTypes, excludeFamilies: ["inanimate"] });
        const seenOwners = new Set();
        return ents.filter(e => {
            if (!e?.isValid || e.id === ownerId || e.hasTag("tusk_rotation") || isOwnTimHitbox(ownerId, e)) return false;
            const owner = e.typeId === TimHitboxType ? getTimHitboxOwner(e) : e;
            if (!owner?.isValid || owner.id === ownerId) return false;
            const hp = owner.getComponent("minecraft:health");
            if (!hp || hp.currentValue <= 0) return false;
            if (len(sub(chest(e), pos)) > r) return false;
            if (seenOwners.has(owner.id)) return false;
            seenOwners.add(owner.id);
            return true;
        });
    } catch { return []; }
}

function nearestTarget(dim, pos, r, ownerId) {
    let best, bd = Infinity;
    for (const e of targetsNear(dim, pos, r, ownerId)) {
        const d = len(sub(chest(e), pos));
        if (d <= r && d < bd) { bd = d; best = e; }
    }
    return best;
}

function sound(dim, id, pos, pitch = 1, volume = 1) { try { dim.playSound(id, pos, { pitch, volume }); } catch { } }
function particle(dim, id, pos) { try { dim.spawnParticle(id, pos); } catch { } }


const ataxiaImmunity = new Map();

function wrapAngle180(deg) {
    return ((deg + 180) % 360 + 360) % 360 - 180;
}

export function applyAtaxia(target, ticks = 100) {
    if (!target?.isValid) return;
    if (ticks <= 0) {
        ataxiaTimers.delete(target.id);
        ataxiaState.delete(target.id);
        try { target.removeTag("ataxia"); } catch { }
        releaseAtaxiaLocks(target);
        return;
    }


    const immuneUntil = ataxiaImmunity.get(target.id) ?? 0;
    if (tick < immuneUntil) return;

    const cur = ataxiaTimers.get(target.id) ?? 0;

    const newDur = Math.min(140, Math.max(cur, ticks));
    ataxiaTimers.set(target.id, newDur);
    try {
        target.addTag("ataxia");
        if (!ataxiaState.has(target.id)) {
            ataxiaState.set(target.id, {
                minYaw: target.getRotation().y,
                camLocked: false,
                moveLocked: false
            });
        }
    } catch { }

    const hitLoc = chest(target);
    sound(target.dimension, "random.anvil_land", hitLoc, 1.9, 0.85);
    sound(target.dimension, "xvoid.flash1", hitLoc, 0.7, 0.9);
    spawnImpactRing(target.dimension, hitLoc, { x: 0, y: 1, z: 0 }, { radius: 2.2, time: 0.25, color: Colors.crimson, alpha: 0.9 });
}

function setPerm(ent, cat, on) {
    try { ent.runCommand(`inputpermission set @s ${cat} ${on ? "enabled" : "disabled"}`); return ""; }
    catch (e) { return `perm:${e}`; }
}

function releaseAtaxiaLocks(ent) {
    if (!ent?.isValid || ent.typeId !== "minecraft:player") return;
    setPerm(ent, "camera", true);
    setPerm(ent, "movement", true);
}

function forceRotation(ent, pitch, yaw) {
    try { ent.teleport(ent.location, { rotation: { x: pitch, y: yaw } }); return "tp"; } catch {
        try { ent.setRotation({ x: pitch, y: yaw }); return "setRot"; } catch {
            try { ent.runCommand(`tp @s ~ ~ ~ ${yaw} ${pitch}`); return "cmd"; } catch { return "FAIL"; }
        }
    }
}

function enforceLeftHalf(ent, id) {
    const rot = ent.getRotation();
    let st = ataxiaState.get(id);
    if (!st) {
        st = { minYaw: rot.y, camLocked: false, moveLocked: false };
        ataxiaState.set(id, st);
    }

    if (st.camLocked) {
        setPerm(ent, "camera", true);
        st.camLocked = false;
    }

    const dYaw = wrapAngle180(rot.y - st.minYaw);
    if (dYaw < -0.1) {
        if (!setPerm(ent, "camera", false)) st.camLocked = true;
        forceRotation(ent, rot.x, st.minYaw);
    } else if (dYaw > 0) {
        st.minYaw = rot.y;
    }

    let mvx = 0;
    try { mvx = ent.inputInfo.getMovementVector().x; } catch { }
    const wantLock = mvx > 0.1;
    if (wantLock !== st.moveLocked) {
        if (!setPerm(ent, "movement", !wantLock)) st.moveLocked = wantLock;
    }
}

function tickAtaxia() {
    for (const [id, rem] of [...ataxiaTimers.entries()]) {
        const ent = world.getEntity(id);
        if (!ent?.isValid || rem <= 1) {
            ataxiaTimers.delete(id);
            ataxiaState.delete(id);
            if (ent?.isValid) {
                try { ent.removeTag("ataxia"); } catch { }
                releaseAtaxiaLocks(ent);

                ataxiaImmunity.set(id, tick + 40);
            }
            continue;
        }
        ataxiaTimers.set(id, rem - 1);
        if (ent.typeId === "minecraft:player") {
            try { enforceLeftHalf(ent, id); } catch { }
        }
    }

    const tagged = new Set();
    for (const player of world.getAllPlayers()) {
        if (!player?.isValid || !player.hasTag("ataxia")) continue;
        tagged.add(player.id);
        if (ataxiaTimers.has(player.id)) continue;
        try { enforceLeftHalf(player, player.id); } catch { }
    }

    for (const id of [...ataxiaState.keys()]) {
        if (!ataxiaTimers.has(id) && !tagged.has(id)) {
            ataxiaState.delete(id);
            releaseAtaxiaLocks(world.getEntity(id));
        }
    }
}


function giveWB(owner, dim, pos) {
    if (owner?.isValid) {
        try {
            const left = owner.getComponent("minecraft:inventory").container.addItem(new ItemStack(WbItem, 1));
            if (!left) { sound(owner.dimension, "xvoid.steelball_turn", owner.location, 1.2, 0.6); return; }
        } catch { }
        try { owner.dimension.spawnItem(new ItemStack(WbItem, 1), owner.location); return; } catch { }
    }
    try { dim.spawnItem(new ItemStack(WbItem, 1), pos); } catch { }
}

function removeHeldOne(player) {
    try {
        const c = player.getComponent("minecraft:inventory").container;
        const it = c.getItem(player.selectedSlotIndex);
        if (!it || it.typeId !== WbItem) return false;
        if (it.amount > 1) { it.amount -= 1; c.setItem(player.selectedSlotIndex, it); }
        else c.setItem(player.selectedSlotIndex, undefined);
        return true;
    } catch { return false; }
}

function hitTarget(ownerId, dim, pos, target, dmg) {
    const owner = world.getEntity(ownerId);
    try {
        if (owner?.isValid) applyHitscanDamage(owner, target, dmg);
        else target.applyDamage(dmg, { cause: "override" });
    } catch { }
    sound(dim, "xvoid.steelball_hit_S", pos, 1.2 + Math.random() * 0.25);
    particle(dim, "sfx:hits_basic", pos);
}

function executionHit(owner, target, baseDmg, dir) {
    try {
        if (target.hasTag("blocking")) breakGuard(target, "heavy");
    } catch { }

    const hadAtaxia = target.hasTag("ataxia");
    const rawDmg = hadAtaxia ? baseDmg * 1.5 : baseDmg;

    let finalDmg = rawDmg;
    try {
        const armorRed = calculateArmorReduction(target, rawDmg);
        finalDmg *= (1 - armorRed);
        const res = target.getEffects?.()?.find(e => e.typeId === "resistance");
        if (res) finalDmg *= (1 - 0.2 * Math.min(5, res.amplifier ?? 0));
    } catch { }
    const isTuskSpatial = target.hasTag("tusk_spatial");
    const isTuskDetached = !isTuskSpatial && target.hasTag("tusk_detached");
    if (isTuskSpatial) finalDmg *= 0.25;
    else if (isTuskDetached) finalDmg *= 0.5;
    finalDmg = Math.max(isTuskSpatial || isTuskDetached ? 0.25 : 1, finalDmg);

    try {
        recordDamageOverride(target, finalDmg);
        target.applyDamage(finalDmg, {
            cause: "override",
            damagingEntity: owner?.isValid ? owner : undefined
        });
    } catch { }

    try {
        applyHeavyKnockback(target, dir, hadAtaxia ? 14 : 10, hadAtaxia ? 2.1 : 1.5);
    } catch { }
}


function spawnSatEntity(dim, pos, ownerId, charged = false, trail = true) {
    try {
        const ent = dim.spawnEntity(WbEntity, pos);
        ent.addTag("spin");
        ent.addTag("wrecking");
        ent.addTag("satellite");
        if (ownerId) ent.addTag(`owner:${ownerId}`);
        try {
            ent.setProperty("property:wrecking", 3);
            ent.setProperty("property:charged", charged ? 1 : 0);
            ent.setProperty("property:trail", trail ? 1 : 0);
        } catch { }
        return ent;
    } catch {
        return null;
    }
}

function removeEnt(ent) {
    try { if (ent?.isValid) ent.remove(); } catch { }
}

function cleanupOrbitEnts(ball) {
    if (ball?.orbitEnts) {
        for (const o of ball.orbitEnts) removeEnt(o.ent);
        ball.orbitEnts = null;
    }
    if (ball?.satsPlanted) {
        for (const s of ball.satsPlanted) removeEnt(s.ent);
        ball.satsPlanted = null;
    }
}


function spawnSatellites(ball, baseDir, opts = {}) {
    const count = opts.count ?? 6;
    const speed = opts.speed ?? 1.45;
    const maxDist = opts.maxDist ?? 13;
    const dmg = opts.dmg ?? 1.3;
    const maxTargetCap = opts.maxTargetCap ?? 9.5;
    const ataxiaTicks = opts.ataxiaTicks ?? 0;
    const grazeAtaxiaTicks = opts.grazeAtaxiaTicks ?? 0;
    const maxBounces = opts.maxBounces ?? 3;
    const radial = Boolean(opts.radial);
    const pullToOwner = Boolean(opts.pullToOwner);
    const spread = opts.spread ?? 0.36;
    const curve = Boolean(opts.curve);
    const curveStrength = opts.curveStrength ?? 0.8;
    const target = opts.target ?? null;
    const pincer = Boolean(opts.pincer);

    const fwd = norm(baseDir);
    const right = norm({ x: -fwd.z, y: 0, z: fwd.x });
    const up = { x: 0, y: 1, z: 0 };

    sound(ball.dim, "random.anvil_land", ball.pos, 1.85, 0.75);
    sound(ball.dim, "xvoid.steelball_hit_L", ball.pos, 1.4, 0.9);
    spawnGlowFlash(ball.dim, ball.pos, { size: 1.5, life: 0.18, color: Colors.gold, alpha: 0.85 });
    try { if (ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }


    const volleyState = {
        dmgDealt: new Map(),
        grazedIds: new Set(),
        maxTargetCap
    };

    const fanOffsets = [
        { r: -1.0, u: 0.15 },
        { r: -0.55, u: 0.45 },
        { r: -0.18, u: 0.25 },
        { r: 0.18, u: 0.25 },
        { r: 0.55, u: 0.45 },
        { r: 1.0, u: 0.15 }
    ];

    for (let i = 0; i < count; i++) {
        let dir;
        if (radial) {
            const ang = (i / count) * Math.PI * 2;
            dir = norm({ x: Math.cos(ang), y: 0.12, z: Math.sin(ang) });
        } else {
            const o = fanOffsets[i % fanOffsets.length];
            dir = norm({
                x: fwd.x + right.x * o.r * spread,
                y: fwd.y + up.y * o.u * (spread * 0.65),
                z: fwd.z + right.z * o.r * spread
            });
        }
        const startPos = { ...ball.pos };
        const ent = spawnSatEntity(ball.dim, startPos, ball.ownerId, ataxiaTicks > 0);
        satellites.add({
            ownerId: ball.ownerId,
            dim: ball.dim,
            pos: startPos,
            ent,
            dir,
            speed,
            dmg,
            maxDist,
            ataxiaTicks,
            grazeAtaxiaTicks,
            bouncesLeft: maxBounces,
            pullToOwner,
            volleyState,
            travelled: 0,
            t: 0,
            hitIds: new Set(),
            curve,
            curveStrength,
            curveSide: i % 2 === 0 ? 1 : -1,
            target,
            pincer,
            charged: Boolean(opts.charged || ball.charged)
        });
    }
}


function reflectOnBlocks(dim, cur, next, dir) {
    let rx = dir.x, ry = dir.y, rz = dir.z;
    let reflected = false;
    if (isSolidAt(dim, { x: next.x, y: cur.y, z: cur.z })) { rx = -dir.x; reflected = true; }
    if (isSolidAt(dim, { x: cur.x, y: next.y, z: cur.z })) { ry = Math.abs(dir.y) * 0.8 + 0.15; reflected = true; }
    if (isSolidAt(dim, { x: cur.x, y: cur.y, z: next.z })) { rz = -dir.z; reflected = true; }
    if (!reflected) { rx = -dir.x; ry = Math.abs(dir.y) * 0.75 + 0.2; rz = -dir.z; }
    return norm({ x: rx, y: ry, z: rz });
}

function tickSatellites() {
    for (const sat of [...satellites]) {
        if (isTimeStopped()) continue;
        sat.t++;


        if (sat.curve) {
            if (sat.target?.isValid) {
                const tChest = chest(sat.target);
                const toTarget = sub(tChest, sat.pos);
                const dist = len(toTarget);
                const toH = norm({ x: toTarget.x, y: 0, z: toTarget.z });
                const perpH = { x: -toH.z, y: 0, z: toH.x };

                if (sat.travelled < sat.maxDist * 0.45 && dist > 3.0) {

                    const lateral = sat.curveSide * sat.curveStrength * 0.24;
                    sat.dir = norm({
                        x: sat.dir.x + perpH.x * lateral,
                        y: sat.dir.y + (toTarget.y > 0 ? 0.04 : -0.02),
                        z: sat.dir.z + perpH.z * lateral
                    });
                } else {

                    const steer = 0.32 + sat.curveStrength * 0.25;
                    const aim = norm(toTarget);
                    sat.dir = norm(add(sat.dir, aim, steer));
                }
            } else {

                const fwdH = norm({ x: sat.dir.x, y: 0, z: sat.dir.z });
                const perpH = { x: -fwdH.z, y: 0, z: fwdH.x };
                const curveStep = sat.curveSide * (sat.curveStrength * 0.08);
                sat.dir = norm({
                    x: sat.dir.x + perpH.x * curveStep,
                    y: sat.dir.y - 0.006,
                    z: sat.dir.z + perpH.z * curveStep
                });
            }
        }

        const prevPos = sat.pos;
        const next = add(sat.pos, sat.dir, sat.speed);
        sat.travelled += sat.speed;

        if (isSolidAt(sat.dim, next)) {
            if (sat.bouncesLeft > 0) {
                sat.bouncesLeft--;
                sat.dir = reflectOnBlocks(sat.dim, sat.pos, next, sat.dir);
                if (sat.curve) sat.curveSide = -sat.curveSide;
                sound(sat.dim, "random.anvil_land", sat.pos, 2.0, 0.4);
                spawnImpactRing(sat.dim, sat.pos, sat.dir, { radius: 0.75, time: 0.14, color: Colors.gold, alpha: 0.8 });
            } else {
                removeEnt(sat.ent);
                satellites.delete(sat);
                continue;
            }
        } else {
            sat.pos = next;
        }


        try { if (sat.ent?.isValid) sat.ent.teleport(sat.pos, { facingLocation: add(sat.pos, sat.dir) }); } catch { }
        spawnTracer(sat.dim, prevPos, sat.pos, {
            color: sat.charged ? Colors.crimson : (sat.ataxiaTicks > 0 ? Colors.gold : Colors.steel),
            coreColor: Colors.white,
            width: 0.075,
            lag: 0.045
        });


        for (const e of targetsNear(sat.dim, sat.pos, 1.55, sat.ownerId)) {
            if (sat.hitIds.has(e.id)) continue;
            sat.hitIds.add(e.id);
            const vs = sat.volleyState;
            const prev = vs ? (vs.dmgDealt.get(e.id) ?? 0) : 0;
            const cap = vs?.maxTargetCap ?? 99;
            const deal = Math.max(0, Math.min(sat.dmg, cap - prev));
            if (deal > 0) {
                if (vs) vs.dmgDealt.set(e.id, prev + deal);
                hitTarget(sat.ownerId, sat.dim, sat.pos, e, deal);
            }
            if (sat.ataxiaTicks > 0) applyAtaxia(e, sat.ataxiaTicks);
            if (sat.pullToOwner && !e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
                const owner = world.getEntity(sat.ownerId);
                if (owner?.isValid) {
                    const pullDir = norm(sub(owner.location, e.location));
                    try { e.applyKnockback({ x: pullDir.x * 0.75, z: pullDir.z * 0.75 }, 0.35); } catch { }
                }
            }
        }


        if (sat.grazeAtaxiaTicks > 0) {
            for (const e of targetsNear(sat.dim, sat.pos, 2.85, sat.ownerId)) {
                if (sat.hitIds.has(e.id) || sat.volleyState?.grazedIds.has(e.id)) continue;
                sat.volleyState?.grazedIds.add(e.id);
                applyAtaxia(e, sat.grazeAtaxiaTicks);
            }
        }

        if (sat.travelled >= sat.maxDist || sat.t > 24) {
            sound(sat.dim, "random.anvil_land", sat.pos, 1.85, 0.45);
            particle(sat.dim, "xvoid:dust_puff", sat.pos);
            removeEnt(sat.ent);
            satellites.delete(sat);
        }
    }
}

export function hasActiveWBBallsOrMines(playerId) {
    for (const b of balls) {
        if (b.ownerId === playerId && b.state !== "return") return true;
    }
    for (const m of mines) {
        if (m.ownerId === playerId) return true;
    }
    return false;
}


export function spreadFloatSatellites(fb, charged = false, ataxiaTicks = 45) {
    if (!fb?.satOrbitEnts?.length) return;
    const ents = fb.satOrbitEnts;
    fb.satOrbitEnts = null;
    fb.satStorm = 0;

    const count = ents.length;
    sound(fb.dim, "random.explode", fb.pos, 1.35, 0.95);
    sound(fb.dim, "random.anvil_land", fb.pos, 1.85, 0.65);
    sound(fb.dim, "xvoid.steelball_turn2", fb.pos, 1.4, 1.1);
    spawnGlowFlash(fb.dim, fb.pos, { size: 2.8, life: 0.25, color: charged ? Colors.crimson : Colors.gold, alpha: 0.95 });
    spawnImpactRing(fb.dim, fb.pos, { x: 0, y: 1, z: 0 }, { radius: 3.2, time: 0.28, color: charged ? Colors.crimson : Colors.gold, alpha: 0.95 });
    spawnStarburst(fb.dim, fb.pos, { size: 2.2, life: 0.22 });

    const volleyState = {
        dmgDealt: new Map(),
        grazedIds: new Set(),
        maxTargetCap: 8.5
    };

    for (let i = 0; i < count; i++) {
        const ent = ents[i];
        if (!ent?.isValid) continue;


        try {
            ent.setProperty("property:wrecking", 3);
            ent.setProperty("property:charged", charged ? 1 : 0);
            ent.setProperty("property:trail", 1);
        } catch { }

        let curPos;
        try { curPos = ent.location; } catch { curPos = fb.pos; }
        const ang = (i / count) * Math.PI * 2;
        const dir = norm({
            x: Math.cos(ang),
            y: 0.14 + (i % 2 === 0 ? 0.08 : -0.04),
            z: Math.sin(ang)
        });

        satellites.add({
            ownerId: fb.ownerId,
            dim: fb.dim,
            pos: { x: curPos.x, y: curPos.y, z: curPos.z },
            ent,
            dir,
            speed: 1.45,
            dmg: 0.8,
            maxDist: 15,
            ataxiaTicks: charged ? ataxiaTicks : 0,
            grazeAtaxiaTicks: charged ? Math.round(ataxiaTicks * 0.75) : 0,
            bouncesLeft: 2,
            pullToOwner: false,
            volleyState,
            travelled: 0,
            t: 0,
            hitIds: new Set(),
            curve: true,
            curveStrength: 0.45,
            curveSide: i % 2 === 0 ? 1 : -1,
            target: nearestTarget(fb.dim, curPos, 12, fb.ownerId),
            charged: Boolean(charged)
        });
    }
}


function spawnWBBall(player, mode, extra) {
    if (!removeHeldOne(player)) return null;
    const dim = player.dimension;
    const dir = getTimDetachedShootDir(player) ?? player.getViewDirection();
    const pos = add(eyeOf(player), dir, 0.8);
    let entity;
    try {
        entity = dim.spawnEntity(WbEntity, pos);
        entity.addTag("spin");
        entity.addTag("wrecking");
        entity.addTag(`owner:${player.id}`);
        try {
            entity.setProperty("property:wrecking", 1);
            entity.setProperty("property:charged", extra?.charged ? 1 : 0);
        } catch { }
    } catch { giveWB(player, dim, pos); return null; }

    const ball = {
        entity, dim, pos, dir, mode, ownerId: player.id, state: "fly", t: 0,
        travelled: 0, blockedTicks: 0, curveSide: Math.random() < 0.5 ? -1 : 1,
        burstDone: false, hitEntities: new Set(), ...extra
    };
    balls.add(ball);
    sound(dim, "xvoid.steelball_turn", pos, 0.9, 1.0);
    return ball;
}

function finishBall(ball) {
    cleanupOrbitEnts(ball);
    balls.delete(ball);
    try { ball.entity?.remove(); } catch { }
    giveWB(world.getEntity(ball.ownerId), ball.dim, ball.pos);
}

function dropBall(ball) {
    cleanupOrbitEnts(ball);
    balls.delete(ball);
    try { ball.entity?.remove(); } catch { }
    try { ball.dim.spawnItem(new ItemStack(WbItem, 1), ball.pos); } catch { }
}

function startReturn(ball, hangTicks = 12) {
    ball.state = "return";
    ball.t = 0;
    ball.hangTicks = hangTicks;
    ball.blockedTicks = 0;
    ball.returnHits = new Set();
    ball.curveSide = Math.random() < 0.5 ? -1 : 1;
    sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.0, 0.8);
}

function moveTo(ball, next) {
    ball.travelled += len(sub(next, ball.pos));
    ball.pos = next;
    try { ball.entity.teleport(next, { facingLocation: add(next, ball.dir) }); } catch { }
}

function tickReturn(ball, owner) {
    if (ball.hangTicks > 0) {
        ball.hangTicks--;
        return;
    }
    if (!owner?.isValid || owner.dimension.id !== ball.dim.id) return dropBall(ball);
    const goal = chest(owner);
    const to = sub(goal, ball.pos);
    const d = len(to);
    if (d < 1.35) return finishBall(ball);

    const fwd = norm(to);
    const side = { x: -fwd.z, y: 0, z: fwd.x };
    const sway = ball.curveSide * Math.min(1, d / 8) * 0.6 * Math.max(0, 1 - ball.t / 28);
    ball.dir = norm(add(fwd, side, sway));
    const speed = Math.min(0.95, d);
    const next = add(ball.pos, ball.dir, speed);


    ball.returnHits ??= new Set();
    for (const e of targetsNear(ball.dim, next, 1.65, ball.ownerId)) {
        if (ball.returnHits.has(e.id)) continue;
        ball.returnHits.add(e.id);
        hitTarget(ball.ownerId, ball.dim, next, e, ball.returnDmg ?? 2.4);
        spawnImpactRing(ball.dim, chest(e), ball.dir, { radius: 1.8, time: 0.2, color: Colors.gold, alpha: 0.85 });
        if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
            try { e.applyKnockback({ x: fwd.x * 0.55, z: fwd.z * 0.55 }, 0.25); } catch { }
        }
    }


    for (const m of [...mines]) {
        if (m.ownerId === ball.ownerId && m.dim.id === ball.dim.id && len(sub(m.pos, next)) <= 2.8) {
            detonateMine(m, true);
        }
    }

    if (isSolidAt(ball.dim, next)) {
        const straight = add(ball.pos, fwd, speed);
        if (!isSolidAt(ball.dim, straight)) { ball.blockedTicks = 0; return moveTo(ball, straight); }
        if (++ball.blockedTicks > 20) return dropBall(ball);
        return;
    }
    ball.blockedTicks = 0;
    moveTo(ball, next);
}


function tickFlak(ball) {
    ball.t++;
    const next = add(ball.pos, ball.dir, 1.2);


    if (!ball.burstDone && infuseFloatBallWithSatellites(next, ball.dim.id, ball.charged, applyAtaxia)) {
        ball.burstDone = true;
        try { if (ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }
        return startReturn(ball, 10);
    }

    if (isSolidAt(ball.dim, next)) {
        if (!ball.burstDone) {
            ball.burstDone = true;
            const bounceDir = reflectOnBlocks(ball.dim, ball.pos, next, ball.dir);
            spawnSatellites(ball, bounceDir, {
                count: 6,
                dmg: ball.satDmg,
                maxTargetCap: ball.maxTargetCap,
                spread: 0.45,
                maxDist: 14,
                maxBounces: 3,
                ataxiaTicks: ball.ataxiaTicks,
                grazeAtaxiaTicks: ball.grazeAtaxiaTicks
            });
        }
        return startReturn(ball, 14);
    }

    const t = nearestTarget(ball.dim, next, 1.8, ball.ownerId);
    if (t) {
        moveTo(ball, chest(t));
        hitTarget(ball.ownerId, ball.dim, ball.pos, t, ball.dmg);
        if (!ball.burstDone) {
            ball.burstDone = true;
            spawnSatellites(ball, ball.dir, {
                count: 6,
                dmg: ball.satDmg,
                maxTargetCap: ball.maxTargetCap,
                spread: 0.38,
                maxDist: 10,
                maxBounces: 2,
                ataxiaTicks: ball.ataxiaTicks,
                grazeAtaxiaTicks: ball.grazeAtaxiaTicks
            });
        }
        return startReturn(ball, 15);
    }

    moveTo(ball, next);
    if (!ball.burstDone && ball.travelled >= 8.5) {
        ball.burstDone = true;
        spawnSatellites(ball, ball.dir, {
            count: 6,
            dmg: ball.satDmg,
            maxTargetCap: ball.maxTargetCap,
            spread: 0.36,
            maxDist: 12,
            maxBounces: 3,
            ataxiaTicks: ball.ataxiaTicks,
            grazeAtaxiaTicks: ball.grazeAtaxiaTicks
        });
    }
    if (ball.travelled >= 20) startReturn(ball, 10);
}


function detonateCageHoming(ball, owner) {
    if (ball.burstDone) return;
    ball.burstDone = true;

    const dim = ball.dim;
    const center = ball.pos;


    sound(dim, "random.explode", center, 1.45, 0.85);
    sound(dim, "random.anvil_land", center, 1.85, 0.55);
    sound(dim, "xvoid.steelball_turn2", center, 1.35, 1.15);
    spawnGlowFlash(dim, center, { size: 3.2, life: 0.28, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.95 });
    spawnImpactRing(dim, center, { x: 0, y: 1, z: 0 }, { radius: 3.8, time: 0.3, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.95 });
    spawnVortexRing(dim, center, { x: 0, y: 1, z: 0 }, { radius: 3.0, thickness: 0.32 });
    particle(dim, "xvoid:dust_puff", center);


    try {
        dim.runCommand(`camerashake add @a[x=${center.x},y=${center.y},z=${center.z},r=12] 0.12 0.2 positional`);
    } catch { }


    for (const e of targetsNear(dim, center, 3.0, ball.ownerId)) {
        try { if (e.hasTag("blocking")) breakGuard(e, "heavy"); } catch { }
        hitTarget(ball.ownerId, dim, center, e, ball.implodeDmg * 0.75);
        if (ball.ataxiaTicks > 0) applyAtaxia(e, ball.ataxiaTicks);
        if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
            try { e.applyKnockback({ x: 0, z: 0 }, 0.38); } catch { }
        }
    }


    const target = nearestTarget(dim, center, 16, ball.ownerId);


    const planted = ball.satsPlanted ?? [];
    for (const s of planted) {
        removeEnt(s.ent);
        const popPos = { x: s.pos.x, y: s.pos.y + 0.65, z: s.pos.z };

        sound(dim, "random.anvil_land", popPos, 1.6, 0.95);
        sound(dim, "xvoid.steelball_hit_L", popPos, 1.25, 1.05);
        spawnGlowFlash(dim, popPos, { size: 1.2, life: 0.18, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.85 });
        spawnImpactRing(dim, popPos, { x: 0, y: 1, z: 0 }, { radius: 1.4, time: 0.2, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.85 });

        let aimDir;
        if (target?.isValid) {

            const tRot = target.getRotation?.() ?? { x: 0, y: 0 };
            const yawRad = tRot.y * (Math.PI / 180);
            const tLeft = { x: Math.cos(yawRad), y: 0, z: Math.sin(yawRad) };
            const flankPt = {
                x: target.location.x + tLeft.x * 0.65,
                y: target.location.y + 1.0,
                z: target.location.z + tLeft.z * 0.65
            };
            aimDir = norm(sub(flankPt, popPos));
        } else {

            const outX = popPos.x - center.x;
            const outZ = popPos.z - center.z;
            aimDir = norm({ x: outX || 0.1, y: 0.35, z: outZ || 0.1 });
        }

        spawnSatellites(
            { ownerId: ball.ownerId, dim: s.dim, pos: popPos, entity: null },
            aimDir,
            {
                count: 1,
                speed: 1.55,
                dmg: (ball.implodeDmg ?? 7.5) * 0.42,
                maxTargetCap: (ball.implodeDmg ?? 7.5) * 1.6,
                maxDist: 18,
                maxBounces: 3,
                ataxiaTicks: ball.ataxiaTicks,
                grazeAtaxiaTicks: Math.round(ball.ataxiaTicks * 0.75),
                curve: true,
                curveStrength: 0.95,
                target
            }
        );
    }
    ball.satsPlanted = [];

    startReturn(ball, 6);
}

function tickCage(ball, owner) {
    if (ball.state === "fly") {
        ball.t++;
        const next = add(ball.pos, ball.dir, 1.15);

        if (!ball.burstDone && infuseFloatBallWithSatellites(next, ball.dim.id, ball.charged, applyAtaxia)) {
            ball.burstDone = true;
            try { if (ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }
            return startReturn(ball, 10);
        }

        const hitEnemy = nearestTarget(ball.dim, next, 1.85, ball.ownerId);
        const hitWall = isSolidAt(ball.dim, next);
        if (hitEnemy) {
            moveTo(ball, chest(hitEnemy));
        } else if (!hitWall) {
            moveTo(ball, next);
        }

        if (hitEnemy || hitWall || ball.travelled >= 7.5) {
            ball.state = "orbit";
            ball.t = 0;
            ball.satsPlanted = [];
            ball.maxSats = 6;
            ball.nextSpitTick = 4;
            ball.spitInterval = 8;
            try { if (ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }

            sound(ball.dim, "random.anvil_land", ball.pos, 1.8, 0.65);
            sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.3, 0.9);
            spawnGlowFlash(ball.dim, ball.pos, { size: 3.2, life: 0.28, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.95 });
            spawnImpactRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, {
                radius: 3.2, time: 0.3, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.95
            });
            spawnVortexRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, { radius: 3.0, thickness: 0.32 });
        }
        return;
    }

    if (ball.state === "orbit") {
        ball.t++;
        const dim = ball.dim;
        const c = ball.pos;


        ball.satsPlanted ??= [];
        if (ball.satsPlanted.length < (ball.maxSats ?? 6) && ball.t >= (ball.nextSpitTick ?? 4)) {
            const idx = ball.satsPlanted.length;
            const ang = (idx / 6) * Math.PI * 2;
            const groundRadius = 2.8;
            const rawTargetPos = {
                x: c.x + Math.cos(ang) * groundRadius,
                y: c.y,
                z: c.z + Math.sin(ang) * groundRadius
            };
            const gy = groundY(dim, rawTargetPos.x, rawTargetPos.y, rawTargetPos.z);
            const targetPos = {
                x: rawTargetPos.x,
                y: gy !== null ? gy + 1 : rawTargetPos.y,
                z: rawTargetPos.z
            };
            const startPos = { x: c.x, y: c.y, z: c.z };


            sound(dim, "xvoid.steelball_turn", startPos, 0.95, 1.45);
            spawnGlowFlash(dim, startPos, { size: 0.6, life: 0.12, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.8 });

            const ent = spawnSatEntity(dim, startPos, ball.ownerId, ball.charged, false);
            const dropDist = len(sub(targetPos, startPos));
            const dropTotal = Math.max(3, Math.min(8, Math.round(dropDist / 0.85)));

            ball.satsPlanted.push({
                dim,
                pos: startPos,
                startPos,
                targetPos,
                ent,
                dropping: true,
                dropT: 0,
                dropTotal,
                t: 0
            });

            ball.nextSpitTick += (ball.spitInterval ?? 8);
        }


        for (const sat of ball.satsPlanted) {
            sat.t++;
            if (sat.dropping) {
                sat.dropT++;
                const progress = Math.min(1, sat.dropT / sat.dropTotal);
                const prevPos = sat.pos;

                const curX = sat.startPos.x + (sat.targetPos.x - sat.startPos.x) * progress;
                const curZ = sat.startPos.z + (sat.targetPos.z - sat.startPos.z) * progress;
                const linearY = sat.startPos.y + (sat.targetPos.y - sat.startPos.y) * progress;
                const arcY = Math.sin(progress * Math.PI) * 0.4;
                const curPos = { x: curX, y: linearY + arcY, z: curZ };
                sat.pos = curPos;

                if (sat.ent?.isValid) {
                    try { sat.ent.teleport(curPos, { facingLocation: sat.targetPos }); } catch { }
                }
                spawnTracer(dim, prevPos, curPos, {
                    color: ball.charged ? Colors.crimson : Colors.gold,
                    coreColor: Colors.white,
                    width: 0.055,
                    lag: 0.035
                });

                if (progress >= 1) {
                    sat.dropping = false;
                    sat.pos = sat.targetPos;
                    if (sat.ent?.isValid) {
                        try { sat.ent.teleport(sat.targetPos); } catch { }
                    }
                    sound(dim, "random.anvil_land", sat.targetPos, 1.75, 0.55);
                    sound(dim, "xvoid.steelball_hit_L", sat.targetPos, 1.1, 1.0);
                    spawnImpactRing(dim, sat.targetPos, { x: 0, y: 1, z: 0 }, {
                        radius: 0.75, time: 0.18, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.85
                    });
                    particle(dim, "xvoid:dust_puff", sat.targetPos);
                }
                continue;
            }


            if (sat.ent?.isValid) {
                try { sat.ent.teleport(sat.pos); } catch { }
            }


            if (sat.t % 15 === 0) {
                sound(dim, "xvoid.steelball_turn2", sat.pos, 1.75, 0.25);
                spawnImpactRing(dim, sat.pos, { x: 0, y: 1, z: 0 }, {
                    radius: 0.65, time: 0.15, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.75
                });
            }
        }


        if (ball.t % 6 === 0) {
            sound(dim, "xvoid.steelball_turn", c, 1.45, 0.65);
            spawnImpactRing(dim, c, { x: 0, y: 1, z: 0 }, {
                radius: 1.8, time: 0.18, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.8
            });
            spawnGlowFlash(dim, c, { size: 1.4, life: 0.15, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.65 });
        }


        try {
            const nearEnts = dim.getEntities({ location: c, maxDistance: 3.2 });
            for (const pr of nearEnts) {
                if (!pr?.isValid || !DeflectTypes.has(pr.typeId)) continue;
                if (pr.hasTag(`owner:${ball.ownerId}`) || pr.hasTag("satellite")) continue;
                sound(dim, "random.anvil_land", pr.location, 2.0, 0.85);
                spawnGlowFlash(dim, pr.location, { size: 1.4, life: 0.15, color: Colors.gold, alpha: 0.9 });
                try { pr.remove(); } catch { }
            }
        } catch { }


        if (ball.t % 5 === 0) {
            for (const e of targetsNear(dim, c, 3.6, ball.ownerId)) {
                hitTarget(ball.ownerId, dim, c, e, ball.tickDmg);
                const inward = norm(sub(c, chest(e)));
                if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
                    try { e.applyKnockback({ x: inward.x * 0.48, z: inward.z * 0.48 }, 0.14); } catch { }
                }
                spawnConeSparks(dim, chest(e), inward);
                sound(dim, "xvoid.steelball_hit_S", chest(e), 0.9, 1.2);
            }
        }


        if (ball.t >= 48 && ball.t % 3 === 0) {
            sound(dim, "xvoid.steelball_turn2", c, 1.4, 0.5 + (ball.t - 48) * 0.05);
            spawnGlowFlash(dim, c, { size: 1.8 + (ball.t - 48) * 0.08, life: 0.14, color: Colors.hot, alpha: 0.85 });
        }


        if (ball.t >= 56) {
            detonateCageHoming(ball, owner);
        }
    }
}


function detonateAnchorPincer(ball, owner) {
    if (ball.burstDone) return;
    ball.burstDone = true;


    const ownerChest = owner?.isValid ? chest(owner) : add(ball.pos, ball.dir, -8);
    let pincerDir = norm(sub(ownerChest, ball.pos));


    const midTarget = nearestTarget(ball.dim, add(ball.pos, pincerDir, 4.0), 5.0, ball.ownerId);
    if (midTarget) {
        pincerDir = norm(sub(chest(midTarget), ball.pos));
    }

    spawnImpactRing(ball.dim, ball.pos, pincerDir, { radius: 2.8, time: 0.28, color: Colors.crimson, alpha: 0.95 });
    spawnSatellites(ball, pincerDir, {
        count: 6,
        speed: 1.55,
        dmg: ball.satDmg,
        maxTargetCap: ball.satDmg * 3.2,
        spread: 0.26,
        maxDist: 16,
        maxBounces: 2,
        ataxiaTicks: ball.ataxiaTicks,
        grazeAtaxiaTicks: Math.round(ball.ataxiaTicks * 0.75),
        pullToOwner: true
    });
    startReturn(ball, 4);
}

function tickAnchor(ball, owner) {
    if (ball.state === "fly") {
        ball.t++;
        const next = add(ball.pos, ball.dir, 1.35);

        if (!ball.burstDone && infuseFloatBallWithSatellites(next, ball.dim.id, ball.charged, applyAtaxia)) {
            ball.burstDone = true;
            try { if (ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }
            return startReturn(ball, 10);
        }


        for (const e of targetsNear(ball.dim, next, 1.6, ball.ownerId)) {
            if (ball.hitEntities.has(e.id)) continue;
            ball.hitEntities.add(e.id);
            hitTarget(ball.ownerId, ball.dim, next, e, ball.dmg);
        }

        if (isSolidAt(ball.dim, next) || ball.travelled >= 13.5) {
            ball.state = "anchor";
            ball.t = 0;
            sound(ball.dim, "random.anvil_land", ball.pos, 1.5, 0.85);
            sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.15, 0.9);
            particle(ball.dim, "xvoid:dust_puff", ball.pos);
            spawnImpactRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, {
                radius: 2.0, time: 0.25, color: Colors.gold, alpha: 0.85
            });
            return;
        }
        moveTo(ball, next);
        return;
    }

    if (ball.state === "anchor") {
        ball.t++;
        if (ball.t % 8 === 0) {
            sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.4, 0.4);
            spawnImpactRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, {
                radius: 1.4, time: 0.2, color: ball.t % 16 === 0 ? Colors.crimson : Colors.gold, alpha: 0.8
            });
        }


        if (ball.t >= 110) {
            detonateAnchorPincer(ball, owner);
        }
    }
}


export function tryAnchorTrickShot(striker, findTargetFn) {
    for (const wb of balls) {
        if (wb.mode !== "anchor" || wb.state !== "anchor" || wb.dim.id !== striker.dim.id) continue;
        if (len(sub(wb.pos, striker.pos)) > 2.0) continue;

        const owner = world.getEntity(wb.ownerId);

        wb.burstDone = true;
        spawnSatellites(wb, striker.dir, {
            count: 8,
            radial: true,
            speed: 1.5,
            dmg: wb.satDmg * 1.25,
            maxTargetCap: wb.satDmg * 3.5,
            maxDist: 12,
            maxBounces: 3,
            ataxiaTicks: Math.max(70, wb.ataxiaTicks),
            grazeAtaxiaTicks: 50
        });
        startReturn(wb, 6);


        const target = findTargetFn(striker.dim, wb.pos, 10, striker.ownerId);
        striker.state = "trick";
        striker.t = 0;
        striker.detourTicks = 0;
        striker.arcTicks = 5;
        striker.arcStrength = 0.7;
        striker.trickSpeed = 1.65;
        striker.returnDelay = 0;
        striker.trickStart = striker.travelled;
        striker.trickDmg = 11.5;
        striker.charged = true;
        striker.homing = target;
        try { striker.entity?.setProperty("property:charged", 1); } catch { }
        return true;
    }
    return false;
}


function groundY(dim, x, y, z) {
    for (let dy = 2; dy >= -10; dy--) {
        const atY = Math.floor(y + dy);
        if (isSolidAt(dim, { x, y: atY, z }) && !isSolidAt(dim, { x, y: atY + 1, z })) {
            return atY + 1;
        }
    }
    return null;
}

function plantMine(ball, rawPos) {
    const gy = groundY(ball.dim, rawPos.x, rawPos.y, rawPos.z);
    const targetPos = {
        x: rawPos.x,
        y: gy !== null ? gy + 1 : rawPos.y,
        z: rawPos.z
    };
    const startPos = { x: ball.pos.x, y: ball.pos.y, z: ball.pos.z };


    sound(ball.dim, "xvoid.steelball_turn", startPos, 0.85, 1.4);
    spawnGlowFlash(ball.dim, startPos, { size: 0.55, life: 0.12, color: ball.charged ? Colors.crimson : Colors.gold, alpha: 0.75 });


    const ent = spawnSatEntity(ball.dim, startPos, ball.ownerId, ball.charged, false);
    const dropDist = len(sub(targetPos, startPos));
    const dropTotal = Math.max(3, Math.min(8, Math.round(dropDist / 0.85)));

    mines.add({
        ownerId: ball.ownerId,
        dim: ball.dim,
        pos: startPos,
        startPos,
        targetPos,
        ent,
        dmg: ball.mineDmg,
        ataxiaTicks: ball.ataxiaTicks,
        charged: ball.charged,
        t: 0,
        dropping: true,
        dropT: 0,
        dropTotal
    });
}

function detonateMine(mine, overcharged = false, proxTarget = null) {
    if (!mines.has(mine)) return;
    mines.delete(mine);
    removeEnt(mine.ent);

    const dim = mine.dim;
    const popPos = { x: mine.pos.x, y: mine.pos.y + 0.75, z: mine.pos.z };
    const col = overcharged ? Colors.crimson : Colors.gold;

    sound(dim, "random.anvil_land", popPos, overcharged ? 1.45 : 1.75, 0.9);
    sound(dim, "xvoid.steelball_hit_L", popPos, overcharged ? 1.15 : 1.35, 0.95);
    spawnGlowFlash(dim, popPos, { size: overcharged ? 1.6 : 1.2, life: 0.2, color: col, alpha: 0.9 });
    spawnImpactRing(dim, popPos, { x: 0, y: 1, z: 0 }, { radius: overcharged ? 2.2 : 1.6, time: 0.22, color: col, alpha: 0.9 });

    const target = proxTarget?.isValid ? proxTarget : nearestTarget(dim, popPos, overcharged ? 16 : 9, mine.ownerId);


    for (const e of targetsNear(dim, popPos, 2.5, mine.ownerId)) {
        try { if (e.hasTag("blocking")) breakGuard(e, "heavy"); } catch { }
        hitTarget(mine.ownerId, dim, popPos, e, mine.dmg * (overcharged ? 1.35 : 1.0));
        if (mine.ataxiaTicks > 0) applyAtaxia(e, mine.ataxiaTicks);
        if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
            try { e.applyKnockback({ x: 0, z: 0 }, 0.36); } catch { }
        }
    }


    let aimDir = { x: 0, y: 0.35, z: 1 };
    if (target?.isValid) {
        const tRot = target.getRotation?.() ?? { x: 0, y: 0 };
        const yawRad = tRot.y * (Math.PI / 180);
        const tLeft = { x: Math.cos(yawRad), y: 0, z: Math.sin(yawRad) };
        const leftFlankPt = {
            x: target.location.x + tLeft.x * 0.65,
            y: target.location.y + 1.0,
            z: target.location.z + tLeft.z * 0.65
        };
        aimDir = norm(sub(leftFlankPt, popPos));
    }

    spawnSatellites(
        { ownerId: mine.ownerId, dim, pos: popPos, entity: null },
        aimDir,
        {
            count: overcharged ? 2 : 1,
            speed: overcharged ? 1.6 : 1.4,
            dmg: mine.dmg * (overcharged ? 1.25 : 0.95),
            maxTargetCap: mine.dmg * 2.5,
            spread: 0.18,
            maxDist: 16,
            maxBounces: 3,
            ataxiaTicks: mine.ataxiaTicks,
            grazeAtaxiaTicks: Math.round(mine.ataxiaTicks * 0.75),
            curve: true,
            curveStrength: overcharged ? 0.95 : 0.75,
            target
        }
    );
}

function tickMines() {
    for (const mine of [...mines]) {
        if (isTimeStopped()) continue;
        mine.t++;


        if (mine.dropping) {
            mine.dropT++;
            const progress = Math.min(1, mine.dropT / mine.dropTotal);
            const prevPos = mine.pos;

            const curX = mine.startPos.x + (mine.targetPos.x - mine.startPos.x) * progress;
            const curZ = mine.startPos.z + (mine.targetPos.z - mine.startPos.z) * progress;
            const linearY = mine.startPos.y + (mine.targetPos.y - mine.startPos.y) * progress;
            const arcY = Math.sin(progress * Math.PI) * 0.35;
            const curPos = { x: curX, y: linearY + arcY, z: curZ };
            mine.pos = curPos;

            if (mine.ent?.isValid) {
                try { mine.ent.teleport(curPos, { facingLocation: mine.targetPos }); } catch { }
            }
            spawnTracer(mine.dim, prevPos, curPos, {
                color: mine.charged ? Colors.crimson : Colors.gold,
                coreColor: Colors.white,
                width: 0.055,
                lag: 0.035
            });

            if (progress >= 1) {
                mine.dropping = false;
                mine.pos = mine.targetPos;
                if (mine.ent?.isValid) {
                    try { mine.ent.teleport(mine.targetPos); } catch { }
                }
                sound(mine.dim, "random.anvil_land", mine.targetPos, 1.75, 0.55);
                sound(mine.dim, "xvoid.steelball_hit_L", mine.targetPos, 1.1, 1.0);
                spawnImpactRing(mine.dim, mine.targetPos, { x: 0, y: 1, z: 0 }, {
                    radius: 0.75, time: 0.18, color: mine.charged ? Colors.crimson : Colors.gold, alpha: 0.85
                });
                particle(mine.dim, "xvoid:dust_puff", mine.targetPos);
            }
            continue;
        }


        if (mine.ent?.isValid) {
            try { mine.ent.teleport(mine.pos); } catch { }
        }


        if (mine.t % 15 === 0) {
            sound(mine.dim, "xvoid.steelball_turn2", mine.pos, 1.75, 0.25);
            spawnImpactRing(mine.dim, mine.pos, { x: 0, y: 1, z: 0 }, {
                radius: 0.7, time: 0.16, color: mine.charged ? Colors.crimson : Colors.gold, alpha: 0.75
            });
        }


        if (mine.t >= 8) {
            const prox = nearestTarget(mine.dim, mine.pos, 2.35, mine.ownerId);
            if (prox) {
                detonateMine(mine, false, prox);
                continue;
            }
        }


        if (mine.t >= 120) {
            const near = nearestTarget(mine.dim, mine.pos, 10, mine.ownerId);
            if (near) detonateMine(mine, false, near);
            else {
                removeEnt(mine.ent);
                mines.delete(mine);
            }
        }
    }
}

function tickMinefield(ball, owner) {
    ball.t++;
    try { if (ball.t === 1 && ball.entity?.isValid) ball.entity.setProperty("property:wrecking", 2); } catch { }

    const next = add(ball.pos, ball.dir, 1.25);

    if (!ball.burstDone && infuseFloatBallWithSatellites(next, ball.dim.id, ball.charged, applyAtaxia)) {
        ball.burstDone = true;
        return startReturn(ball, 12);
    }


    ball.minesPlanted ??= 0;
    ball.nextMineDist ??= 2.2;
    if (ball.minesPlanted < 6 && ball.travelled >= ball.nextMineDist) {
        const side = norm({ x: -ball.dir.z, y: 0, z: ball.dir.x });
        const zig = (ball.minesPlanted % 2 === 0 ? 1 : -1) * 0.75;
        plantMine(ball, add(ball.pos, side, zig));
        ball.minesPlanted++;
        ball.nextMineDist += 2.6;
    }

    if (isSolidAt(ball.dim, next)) {

        while (ball.minesPlanted < 6) {
            const ang = (ball.minesPlanted / 6) * Math.PI * 2;
            plantMine(ball, {
                x: ball.pos.x + Math.cos(ang) * 1.8,
                y: ball.pos.y,
                z: ball.pos.z + Math.sin(ang) * 1.8
            });
            ball.minesPlanted++;
        }
        sound(ball.dim, "xvoid.groundHit", ball.pos, 1.0, 0.9);
        return startReturn(ball, 22);
    }

    const t = nearestTarget(ball.dim, next, 1.85, ball.ownerId);
    if (t && !ball.hitEntities.has(t.id)) {
        ball.hitEntities.add(t.id);
        hitTarget(ball.ownerId, ball.dim, next, t, ball.dmg);
        if (ball.ataxiaTicks > 0) applyAtaxia(t, Math.round(ball.ataxiaTicks * 0.75));


        const tLoc = t.location;
        while (ball.minesPlanted < 6) {
            const idx = ball.minesPlanted;
            const ang = ((idx - 2.5) / 5) * Math.PI * 0.9;
            const fwd = norm({ x: ball.dir.x, y: 0, z: ball.dir.z });
            const right = { x: -fwd.z, y: 0, z: fwd.x };
            const arcDir = add(fwd, right, Math.sin(ang) * 1.15);
            plantMine(ball, add(tLoc, norm(arcDir), 2.4));
            ball.minesPlanted++;
        }

        moveTo(ball, add(chest(t), ball.dir, 3.2));
        return startReturn(ball, 22);
    }

    moveTo(ball, next);
    if (ball.travelled >= 16.5) {
        startReturn(ball, 22);
    }
}


function tickDualBallResonance() {
    if (tick % 3 !== 0) return;
    const list = [...balls];
    if (list.length < 2) return;

    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (a.ownerId !== b.ownerId || a.dim.id !== b.dim.id) continue;
            const diff = sub(b.pos, a.pos);
            const dist = len(diff);
            if (dist < 1.5 || dist > 16) continue;

            const dir = norm(diff);
            spawnTracer(a.dim, a.pos, b.pos, {
                color: Colors.crimson,
                coreColor: Colors.gold,
                width: 0.2,
                lag: 0.08
            });
            const mid = add(a.pos, dir, dist * 0.5);
            sound(a.dim, "random.anvil_land", mid, 1.95, 0.35);


            for (const e of targetsNear(a.dim, mid, dist * 0.5 + 1.5, a.ownerId)) {
                const toE = sub(chest(e), a.pos);
                const proj = Math.max(0, Math.min(dist, toE.x * dir.x + toE.y * dir.y + toE.z * dir.z));
                const closest = add(a.pos, dir, proj);
                if (len(sub(chest(e), closest)) <= 1.65) {
                    hitTarget(a.ownerId, a.dim, closest, e, 1.4);
                    if (a.charged || b.charged) applyAtaxia(e, 60);
                    spawnImpactRing(a.dim, chest(e), dir, { radius: 1.8, time: 0.18, color: Colors.crimson, alpha: 0.85 });
                }
            }
        }
    }
}


function castWBMove(player, hold, sneak) {
    if (!isSpinUser(player)) return;
    const s = P(player);
    syncExact(player, s);
    const avail = s.exact;
    const charged = avail >= 50;


    if (!sneak && !hold) {
        const spent = Math.min(50, avail);
        const f = spent / 50;
        const dmg = 2.1 + 1.4 * f;
        const satDmg = 0.35 + 0.75 * f;
        const maxTargetCap = 6.9 + 4.6 * f;

        const chargeScale = charged ? (avail - 50) / 50 : 0;
        const ataxiaTicks = charged ? Math.round(35 + 35 * chargeScale) : 0;
        const grazeAtaxiaTicks = charged ? Math.round(15 + 15 * chargeScale) : 0;
        if (!spawnWBBall(player, "flak", { dmg, satDmg, maxTargetCap, charged, ataxiaTicks, grazeAtaxiaTicks })) return;
        setExact(player, s, avail - spent);
        return;
    }


    if (!sneak && hold) {

        for (const b of balls) {
            if (b.ownerId === player.id && b.mode === "cage" && b.state === "orbit") {
                detonateCageHoming(b, player);
                return;
            }
        }
        const spent = Math.min(65, avail);
        const f = spent / 65;
        const tickDmg = 0.58 + 0.18 * f;
        const implodeDmg = 0.7 + 2.5 * f;

        const chargeScale = charged ? (avail - 50) / 50 : 0;
        const ataxiaTicks = charged ? Math.round(45 + 35 * chargeScale) : 0;
        if (!spawnWBBall(player, "cage", { tickDmg, implodeDmg, charged, ataxiaTicks })) return;
        setExact(player, s, avail - spent);
        return;
    }


    if (sneak && !hold) {

        for (const b of balls) {
            if (b.ownerId === player.id && b.mode === "anchor" && b.state === "anchor") {
                detonateAnchorPincer(b, player);
                return;
            }
        }
        const spent = Math.min(50, avail);
        const f = spent / 50;
        const satDmg = 1.85 + 0.95 * f;

        const chargeScale = charged ? (avail - 50) / 50 : 0;
        const ataxiaTicks = charged ? Math.round(55 + 55 * chargeScale) : 0;
        if (!spawnWBBall(player, "anchor", { dmg: 2.0, satDmg, charged, ataxiaTicks })) return;
        setExact(player, s, avail - spent);
        return;
    }


    const spent = Math.min(60, avail);
    const f = spent / 60;
    const dmg = 1.4 + 1.8 * f;
    const mineDmg = 0.1 + 0.5 * f;

    const chargeScale = charged ? (avail - 50) / 50 : 0;
    const ataxiaTicks = charged ? Math.round(50 + 45 * chargeScale) : 0;

    const b = spawnWBBall(player, "minefield", { dmg, mineDmg, returnDmg: 3.2 + 1.5 * f, charged, ataxiaTicks });
    if (!b) return;
    setExact(player, s, avail - spent);
}

world.afterEvents.itemStartUse.subscribe(({ source, itemStack }) => {
    if (itemStack?.typeId !== WbItem || source?.typeId !== "minecraft:player") return;
    P(source).use = { start: tick, sneak: source.isSneaking, fired: false };
});

world.afterEvents.itemStopUse.subscribe(({ source, itemStack }) => {
    if (source?.typeId !== "minecraft:player") return;
    if (!isSpinUser(source)) return;
    const s = P(source);
    const u = s.use;
    s.use = null;
    if (!u || u.fired || (itemStack && itemStack.typeId !== WbItem)) return;
    castWBMove(source, false, u.sneak);
});


system.runInterval(() => {
    tick++;
    const stopped = isTimeStopped();

    tickAtaxia();

    for (const player of world.getAllPlayers()) {
        if (!player?.isValid) continue;
        if (!isSpinUser(player)) continue;
        const s = P(player);
        const holding = holdingWB(player);
        const sneak = player.isSneaking;
        syncExact(player, s);


        if (sneak && !s.wasSneak) {
            s.sneakTaps = s.sneakTaps.filter(t => tick - t <= DoubleSneakWindow);
            s.sneakTaps.push(tick);
            if (s.sneakTaps.length >= 2) {
                s.sneakTaps = [];
                for (const b of balls) {
                    if (b.ownerId !== player.id || b.state === "return") continue;
                    if (b.mode === "anchor" && b.state === "anchor") detonateAnchorPincer(b, player);
                    else if (b.mode === "cage" && b.state === "orbit") detonateCageHoming(b, player);
                    else startReturn(b, 0);
                }
                for (const m of [...mines]) {
                    if (m.ownerId === player.id) detonateMine(m, true);
                }
            }
        }
        s.wasSneak = sneak;

        if (s.use && !s.use.fired && tick - s.use.start >= HoldTicks) {
            if (holding) { s.use.fired = true; castWBMove(player, true, s.use.sneak); }
            else s.use = null;
        }
    }

    for (const ball of [...balls]) {
        if (!ball.entity?.isValid) { balls.delete(ball); giveWB(world.getEntity(ball.ownerId), ball.dim, ball.pos); continue; }
        if (stopped) {
            if (!ball.isTsStopped) {
                ball.isTsStopped = true;
                try { ball.entity.setProperty("property:stopped", 1); } catch { }
            }
            continue;
        } else if (ball.isTsStopped) {
            ball.isTsStopped = false;
            try { ball.entity.setProperty("property:stopped", 0); } catch { }
        }
        const owner = world.getEntity(ball.ownerId);
        if (ball.state === "return") { ball.t++; tickReturn(ball, owner); continue; }
        if (ball.mode === "flak") tickFlak(ball);
        else if (ball.mode === "cage") tickCage(ball, owner);
        else if (ball.mode === "anchor") tickAnchor(ball, owner);
        else if (ball.mode === "minefield") tickMinefield(ball, owner);
    }

    if (!stopped) {
        tickDualBallResonance();
        tickMines();
        tickSatellites();
    }
}, 1);


system.beforeEvents.startup.subscribe((init) => {
    const registry = init?.customCommandRegistry;
    if (!registry?.registerCommand) return;

    const successStatus = mc.CustomCommandStatus?.Success ?? 0;
    const failureStatus = mc.CustomCommandStatus?.Failure ?? 1;
    const permAny = mc.CommandPermissionLevel?.Any ?? mc.CustomCommandPermissionLevel?.Any ?? 0;
    const intType = mc.CustomCommandParamType?.Integer ?? 0;

    try {
        registry.registerCommand(
            {
                name: "xvoid:ataxia",
                description: "Test Left-Half Ataxia on yourself ([seconds], 0 to clear)",
                cheatsRequired: false,
                permissionLevel: permAny,
                mandatoryParameters: [],
                optionalParameters: [{ type: intType, name: "seconds" }]
            },
            (origin, seconds) => {
                const player = origin?.sourceEntity;
                if (!player || player.typeId !== "minecraft:player") {
                    return { status: failureStatus, message: "Must be run by a player." };
                }
                system.run(() => {
                    if (seconds === 0) {
                        applyAtaxia(player, 0);
                    } else {
                        const durTicks = typeof seconds === "number" && seconds > 0 ? seconds * 20 : (player.hasTag("ataxia") ? 0 : 120);
                        applyAtaxia(player, durTicks);
                    }
                });
                return { status: successStatus };
            }
        );
    } catch (e) {
        console.warn(`[wrecking_ball.js] Failed to register /xvoid:ataxia: ${e}`);
    }
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "xvoid:ataxia") return;
    const player = ev.sourceEntity ?? world.getAllPlayers()[0];
    if (!player?.isValid) return;
    const arg = (ev.message ?? "").trim().toLowerCase();
    if (arg === "off" || arg === "0" || arg === "clear") {
        applyAtaxia(player, 0);
    } else {
        const secs = parseFloat(arg);
        const ticks = !isNaN(secs) && secs > 0 ? Math.round(secs * 20) : (player.hasTag("ataxia") ? 0 : 120);
        applyAtaxia(player, ticks);
    }
});
