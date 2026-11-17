import { world, system, ItemStack, BlockPermutation, MolangVariableMap } from "@minecraft/server";
import { getSpecial, setSpecial, setSpecialCooldown } from "../../energy.js";
import { applyHitscanDamage } from "../../damage/damage.js";
import { calculateArmorReduction } from "../../damage/def.js";
import { recordDamageOverride } from "../../damage/indicator.js";
import { breakGuard } from "../basic_combat.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { Colors, spawnImpactRing, spawnGlowFlash, spawnStarburst, spawnVortexRing } from "../../utils/vfx.js";
import { BlockRenderer } from "../../bedrockblockrender/index.js";
import { tryAnchorTrickShot, spreadFloatSatellites, hasActiveWBBallsOrMines } from "./wrecking_ball.js";
import { getTimDetachedShootOrigin, getTimDetachedShootDir } from "../tim/tim.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "../tim/timHitboxState.js";

const BallItem = "jjba:ball";
const WbItem = "jjba:wrecking_ball";
const BallEntity = "jjba:steelball";
const HoldTicks = 5;
const DoubleSneakWindow = 8;

const ChargePerTick = 1;
const AutoChargePerTick = 0.5;
const StandChargePerTick = AutoChargePerTick / 1.5;
const StandRegenCdStep = 20;
const StandRegenCdMax = 40;
const DecayPerTick = 0.5;
const DecayGrace = 20;
const BlockModeDrain = 1;

const ExcludeTypes = [BallEntity, "jjba:nail", "minecraft:item", "xvoid:dmg", "minecraft:xp_orb", "minecraft:arrow", "jjba:knife", "minecraft:armor_stand"];
const Passable = /(?:^|:)short_grass$|(?:^|:)tall_grass$|(?:^|:)grass$|air|flower|double_plant|peony|rose_bush|lilac|sunflower|fern|vine|torch|snow_layer|sapling|bush|carpet|button|lever|sign|rail|redstone_wire|pressure_plate|tripwire|dead_bush|seagrass|kelp|light_block|structure_void/;

const players = new Map();
const balls = new Set();
let renderer = null;
let tick = 0;

function P(player) {
    let s = players.get(player.id);
    if (!s) {
        s = {
            exact: getSpecial(player), wasSneak: false, sneakTaps: [], awayTicks: 0, spinUser: false,
            use: null, chargeLoop: 0, maxed: false, blockMode: false, lastBlockThrow: -10,
            standRegenCd: 0, wasOnSkill: false
        };
        players.set(player.id, s);
    }
    return s;
}


export function triggerTuskSpinCooldown(player, addTicks = StandRegenCdStep, maxTicks = StandRegenCdMax) {
    if (!player?.isValid || !isSpinUser(player)) return;
    const s = P(player);
    s.standRegenCd = Math.min(maxTicks, Math.max(0, (s.standRegenCd || 0) + addTicks));
}


export function isSpinUser(player) {
    return Boolean(player?.isValid && (player.hasTag("spin") || player.hasTag("spinUser")));
}
const held = (p) => { try { return p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex); } catch { return undefined; } };
const holdingBall = (p) => held(p)?.typeId === BallItem;
const holdingAnySpinBall = (p) => { const id = held(p)?.typeId; return id === BallItem || id === WbItem; };
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const norm = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const lerpDir = (a, b, t) => norm({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
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
    if (Math.abs(real - Math.round(s.exact)) >= 1) {
        s.exact = real;
        if (s.exact < 100) s.maxed = false;
    }
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

            const d = len(sub(chest(e), pos));
            if (d > r) return false;
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

function giveBall(owner, dim, pos) {
    if (owner?.isValid) {
        try {
            const left = owner.getComponent("minecraft:inventory").container.addItem(new ItemStack(BallItem, 1));
            if (!left) { sound(owner.dimension, "xvoid.steelball_turn", owner.location, 1.4, 0.6); return; }
        } catch { }
        try { owner.dimension.spawnItem(new ItemStack(BallItem, 1), owner.location); return; } catch { }
    }
    try { dim.spawnItem(new ItemStack(BallItem, 1), pos); } catch { }
}

function removeHeldOne(player) {
    try {
        const c = player.getComponent("minecraft:inventory").container;
        const it = c.getItem(player.selectedSlotIndex);
        if (!it) return false;
        if (it.amount > 1) { it.amount -= 1; c.setItem(player.selectedSlotIndex, it); }
        else c.setItem(player.selectedSlotIndex, undefined);
        return true;
    } catch { return false; }
}

function hitTarget(ball, target, dmg) {
    const owner = world.getEntity(ball.ownerId);
    try {
        if (owner?.isValid) applyHitscanDamage(owner, target, dmg);
        else target.applyDamage(dmg, { cause: "override" });
    } catch { }
    sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 1 + Math.random() * 0.2);
    particle(ball.dim, "sfx:hits_basic", ball.pos);
}

function unblockableHit(owner, target, dmg, dir, back, up) {

    try {
        if (target.hasTag("blocking")) {
            breakGuard(target, "heavy");
        }
    } catch { }


    let finalDmg = dmg;
    try {
        const armorReduction = calculateArmorReduction(target, dmg);
        finalDmg *= (1 - armorReduction);

        const resistanceEffect = target.getEffects?.()?.find(e => e.typeId === "resistance");
        if (resistanceEffect) {
            const resLevel = resistanceEffect.amplifier ?? 0;
            finalDmg *= (1 - 0.2 * Math.min(5, resLevel));
        }
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


    if (!isTuskSpatial && !isTuskDetached) {
        try {
            target.applyKnockback({ x: dir.x * back, z: dir.z * back }, up);
        } catch { }
    }
}


function spawnBall(player, mode, extra) {
    if (!removeHeldOne(player)) return null;
    const dim = player.dimension;
    const dir = getTimDetachedShootDir(player) ?? player.getViewDirection();
    const pos = add(eyeOf(player), dir, 0.8);
    let entity;
    try {
        entity = dim.spawnEntity(BallEntity, pos);
        entity.addTag("spin");
        entity.addTag(`owner:${player.id}`);
        try { entity.setDynamicProperty("ownerId", player.id); } catch { }
        try { entity.setProperty("property:charged", extra?.charged ? 1 : 0); } catch { }
    } catch { giveBall(player, dim, pos); return null; }
    const ball = {
        entity, dim, pos, dir, mode, ownerId: player.id, state: "fly", t: 0,
        travelled: 0, hits: 0, hitTimer: 0, target: null, curveSide: Math.random() < 0.5 ? -1 : 1,
        blockedTicks: 0, immune: false, ...extra
    };
    balls.add(ball);
    sound(dim, "xvoid.steelball_turn", pos, 1.0);
    if (ball.charged) {
        spawnGlowFlash(dim, pos, { size: 1.4, life: 0.2, color: Colors.gold, alpha: 0.9 });
    }
    return ball;
}

function getOwnerIdFromEntity(entity) {
    try {
        const dp = entity.getDynamicProperty("ownerId");
        if (typeof dp === "string" && dp.length) return dp;
    } catch { }
    try {
        for (const tag of entity.getTags()) {
            if (tag.startsWith("owner:")) return tag.slice(6);
        }
    } catch { }
    return null;
}

function adoptOrphan(entity, fallbackPlayer = null) {
    if (!entity?.isValid || entity.hasTag("wrecking")) return false;
    const ownerId = getOwnerIdFromEntity(entity) || fallbackPlayer?.id;
    const owner = ownerId ? world.getEntity(ownerId) : fallbackPlayer;
    const dim = entity.dimension;
    const pos = entity.location;

    if (owner?.isValid) {
        if (owner.dimension.id === dim.id && len(sub(chest(owner), pos)) < 2.0) {
            try { entity.remove(); } catch { }
            giveBall(owner, dim, pos);
            return true;
        }

        const toOwner = sub(chest(owner), pos);
        const ball = {
            entity,
            dim,
            pos,
            dir: norm(toOwner),
            mode: "throw",
            ownerId: owner.id,
            state: "return",
            t: 0,
            travelled: 0,
            hits: 0,
            hitTimer: 0,
            target: null,
            curveSide: Math.random() < 0.5 ? -1 : 1,
            blockedTicks: 0,
            immune: false,
            charged: false
        };
        try {
            ball.charged = (entity.getProperty("property:charged") ?? 0) === 1;
        } catch { }
        balls.add(ball);
        sound(dim, "xvoid.steelball_turn2", pos, 1.1, 0.8);
        return true;
    }

    try { entity.remove(); } catch { }
    try { dim.spawnItem(new ItemStack(BallItem, 1), pos); } catch { }
    sound(dim, "xvoid.steelball_hit_S", pos, 0.7, 0.6);
    return true;
}

function cleanupFloatSatellites(ball) {
    if (!ball?.satOrbitEnts) return;
    for (const ent of ball.satOrbitEnts) {
        try { if (ent?.isValid) ent.remove(); } catch { }
    }
    ball.satOrbitEnts = null;
}

function finishBall(ball, toInventory = true) {
    if (ball.satOrbitEnts?.length) spreadFloatSatellites(ball, ball.charged, 45);
    cleanupFloatSatellites(ball);
    balls.delete(ball);
    try { ball.entity?.remove(); } catch { }
    const owner = world.getEntity(ball.ownerId);
    if (toInventory) giveBall(owner, ball.dim, ball.pos);
}

function dropBall(ball) {
    if (ball.satOrbitEnts?.length) spreadFloatSatellites(ball, ball.charged, 45);
    cleanupFloatSatellites(ball);
    balls.delete(ball);
    try { ball.entity?.remove(); } catch { }
    try { ball.dim.spawnItem(new ItemStack(BallItem, 1), ball.pos); } catch { }
    sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 0.7, 0.6);
}

function startReturn(ball) {
    if (ball.satOrbitEnts?.length) spreadFloatSatellites(ball, ball.charged, 45);
    cleanupFloatSatellites(ball);
    ball.state = "return";
    ball.t = 0;
    ball.target = null;
    ball.blockedTicks = 0;
    ball.curveSide = Math.random() < 0.5 ? -1 : 1;
    sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.1, 0.8);
}

function moveTo(ball, next) {
    ball.travelled += len(sub(next, ball.pos));
    ball.pos = next;
    try { ball.entity.teleport(next, { facingLocation: add(next, ball.dir) }); } catch { }
}


function tickReturn(ball, owner) {
    if (ball.returnDelay > 0) { ball.returnDelay--; return; }
    if (!owner?.isValid || owner.dimension.id !== ball.dim.id) return dropBall(ball);
    const goal = chest(owner);
    const to = sub(goal, ball.pos);
    const d = len(to);
    if (d < 1.3) return finishBall(ball, true);

    const fwd = norm(to);
    const side = { x: -fwd.z, y: 0, z: fwd.x };
    const sway = ball.curveSide * Math.min(1, d / 8) * 0.55 * Math.max(0, 1 - ball.t / 25);
    ball.dir = norm(add(fwd, side, sway));
    const speed = Math.min(1.1, d);
    const next = add(ball.pos, ball.dir, speed);

    if (isSolidAt(ball.dim, next)) {

        const straight = add(ball.pos, fwd, speed);
        if (!isSolidAt(ball.dim, straight)) { ball.blockedTicks = 0; return moveTo(ball, straight); }
        if (++ball.blockedTicks > 20) {
            if (ball.immune) { finishBall(ball, true); return; }
            return dropBall(ball);
        }
        return;
    }
    ball.blockedTicks = 0;
    moveTo(ball, next);
}


function tickImpact(ball) {
    if (++ball.hitTimer < 3) return;
    ball.hitTimer = 0;
    const t = ball.target;
    if (t?.isValid) {
        moveTo(ball, chest(t));
        hitTarget(ball, t, ball.dmg);
    } else {
        sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 0.8, 0.7);
    }
    if (++ball.hits >= ball.maxHits || !t?.isValid) startReturn(ball);
}

function checkImpact(ball, next) {
    if (isSolidAt(ball.dim, next)) {
        sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 0.8, 0.8);
        particle(ball.dim, "xvoid:dust_puff", ball.pos);
        return "block";
    }
    const t = nearestTarget(ball.dim, next, 2.0, ball.ownerId);
    if (t) { ball.target = t; return "entity"; }
    return null;
}

function tickThrow(ball, owner) {
    if (ball.state === "impact") return tickImpact(ball);
    ball.t++;
    const next = add(ball.pos, ball.dir, 1.2);
    const hit = checkImpact(ball, next);
    if (hit === "entity") { ball.state = "impact"; ball.hitTimer = 2; return; }
    if (hit === "block") return startReturn(ball);
    if (tryTrickShot(ball)) return;
    moveTo(ball, next);
    if (ball.travelled > 24) startReturn(ball);
}


export function infuseFloatBallWithSatellites(pos, dimId, charged, ataxiaFn) {
    for (const fb of balls) {
        if (fb.mode !== "float" || fb.state !== "hover" || fb.dim.id !== dimId) continue;
        if (len(sub(fb.pos, pos)) > 2.2) continue;
        fb.satStorm = 80;
        fb.satAtaxiaFn = ataxiaFn;
        fb.stormedIds = new Set();
        fb.t = Math.min(fb.t, 70);
        if (charged) {
            fb.charged = true;
            try { fb.entity?.setProperty("property:charged", 1); } catch { }
        }
        cleanupFloatSatellites(fb);
        fb.satOrbitEnts = [];
        const r = 2.0;
        for (let i = 0; i < 6; i++) {
            const ang = (i * Math.PI) / 3;
            const initPos = {
                x: fb.pos.x + Math.cos(ang) * r,
                y: fb.pos.y,
                z: fb.pos.z + Math.sin(ang) * r
            };
            try {
                const ent = fb.dim.spawnEntity(BallEntity, initPos);
                ent.addTag("spin");
                ent.addTag("wrecking");
                ent.addTag("satellite");
                if (fb.ownerId) ent.addTag(`owner:${fb.ownerId}`);
                try {
                    ent.setProperty("property:wrecking", 3);
                    ent.setProperty("property:charged", charged ? 1 : 0);
                    ent.setProperty("property:trail", 0);
                } catch { }
                fb.satOrbitEnts.push(ent);
            } catch { }
        }
        sound(fb.dim, "random.anvil_land", fb.pos, 1.75, 0.9);
        sound(fb.dim, "xvoid.steelball_hit_L", fb.pos, 1.35, 1.0);
        spawnGlowFlash(fb.dim, fb.pos, { size: 2.8, life: 0.3, color: Colors.crimson, alpha: 0.95 });
        spawnImpactRing(fb.dim, fb.pos, { x: 0, y: 1, z: 0 }, { radius: 3.6, time: 0.3, color: Colors.gold, alpha: 0.95 });
        spawnStarburst(fb.dim, fb.pos, { size: 2.4, life: 0.25 });
        return true;
    }
    return false;
}

function doFloatDamage(ball) {
    const storm = (ball.satStorm ?? 0) > 0;
    const radius = storm ? 3.8 : 2.5;
    const targets = targetsNear(ball.dim, ball.pos, radius, ball.ownerId);
    if (!targets.length) return;
    const dmg = storm ? ball.dmg * 1.45 : ball.dmg;
    for (const e of targets) {
        hitTarget(ball, e, dmg);
        if (storm) {
            const toCenter = sub(ball.pos, e.location);
            const d = Math.hypot(toCenter.x, toCenter.z) || 1;
            if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
                try { e.applyKnockback({ x: (toCenter.x / d) * 0.25, z: (toCenter.z / d) * 0.25 }, 0.15); } catch { }
            }
            if (ball.charged && ball.satAtaxiaFn && !ball.stormedIds?.has(e.id)) {
                ball.stormedIds?.add(e.id);
                try { ball.satAtaxiaFn(e, 50); } catch { }
            }
        }
    }
    if (ball.t % 6 === 0) {
        spawnImpactRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, {
            radius: storm ? 3.2 : 1.6,
            time: storm ? 0.22 : 0.15,
            color: storm ? Colors.crimson : (ball.charged ? Colors.gold : Colors.steel),
            alpha: 0.8
        });
    }
}

function tickTrick(ball, owner) {
    ball.t++;
    if (!ball.homing?.isValid) {
        ball.homing = nearestTarget(ball.dim, ball.pos, 10, ball.ownerId);
    }
    const detourTicks = ball.detourTicks ?? 0;
    const inDetour = ball.t <= detourTicks || (ball.partner?.state === "trick" && ball.t < detourTicks + 6);
    const arcTicks = ball.arcTicks ?? 5;
    const arcStrength = ball.arcStrength ?? 0.7;
    const baseSpeed = ball.trickSpeed ?? 1.45;
    let step = baseSpeed;

    if (ball.homing?.isValid) {
        const to = sub(chest(ball.homing), ball.pos);
        const dist = len(to);
        const direct = norm(to);
        const side = { x: -direct.z * ball.curveSide, y: 0.2, z: direct.x * ball.curveSide };

        if (inDetour) {

            const away = dist < 2.8 ? add(side, direct, -0.55) : add(side, direct, 0.25);
            ball.dir = lerpDir(ball.dir, norm(away), 0.65);
            step = 1.15;
        } else {
            const homeT = Math.max(1, ball.t - detourTicks);
            const bend = Math.max(0, 1 - homeT / arcTicks) * Math.min(1.0, Math.max(0, (dist - 1.5) / 2.5));
            const curved = norm(add(direct, side, bend * arcStrength));
            ball.dir = (dist < 2.0 || homeT >= arcTicks) ? direct : lerpDir(ball.dir, curved, 0.6);
            step = Math.min(baseSpeed, dist);
        }
    }
    const next = add(ball.pos, ball.dir, step);
    if (isSolidAt(ball.dim, next)) {
        particle(ball.dim, "xvoid:dust_puff", ball.pos);
        sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 0.9, 0.8);
        return startReturn(ball);
    }
    if (!inDetour) {
        const t = (ball.homing?.isValid && len(sub(chest(ball.homing), next)) <= 1.25)
            ? ball.homing
            : nearestTarget(ball.dim, next, 1.25, ball.ownerId);
        if (t) {

            if (ball.partner?.state === "trick") {
                ball.partner.detourTicks = Math.max(ball.partner.detourTicks ?? 0, ball.partner.t + 3);
            }
            moveTo(ball, chest(t));
            const dmg = ball.trickDmg ?? 6;
            unblockableHit(owner, t, dmg, ball.dir, 2.2, 0.45);
            sound(ball.dim, "xvoid.steelball_hit_L", ball.pos, 1.3);
            spawnImpactRing(ball.dim, chest(t), ball.dir, { radius: 3.2, time: 0.35, color: Colors.gold, alpha: 0.95 });
            particle(ball.dim, "xvoid:blood", chest(t));
            if (ball.charged) {
                spawnGlowFlash(ball.dim, chest(t), { size: 2.2, life: 0.25, color: Colors.gold, alpha: 0.95 });
            }
            return startReturn(ball);
        }
    }
    moveTo(ball, next);
    if (ball.t % 2 === 0) sound(ball.dim, "xvoid.steelball_turn", ball.pos, 1.6, 0.35);
    if (ball.travelled - ball.trickStart > 28 || ball.t > 32) startReturn(ball);
}

function tickFloat(ball, owner) {
    if (ball.state === "fly") {
        const next = add(ball.pos, ball.dir, 1.0);
        const hit = checkImpact(ball, next);
        if (!hit && ball.travelled < 12) return moveTo(ball, next);


        if (hit === "entity" && ball.target?.isValid) {
            moveTo(ball, chest(ball.target));
        } else if (!hit) {
            moveTo(ball, next);
        }

        ball.state = "hover";
        ball.t = 0;
        sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.0, 0.8);

        doFloatDamage(ball);
        return;
    }
    if (ball.state === "hover") {
        ball.t++;
        if (ball.satStorm > 0) {
            ball.satStorm--;
            if (ball.satOrbitEnts) {
                const r = 2.0;
                for (let i = 0; i < ball.satOrbitEnts.length; i++) {
                    const ent = ball.satOrbitEnts[i];
                    const ang = (ball.t * 0.48) + (i * Math.PI / 3);
                    const tilt = Math.sin(ang * 2 + ball.t * 0.18) * 0.55;
                    const satPos = {
                        x: ball.pos.x + Math.cos(ang) * r,
                        y: ball.pos.y + tilt,
                        z: ball.pos.z + Math.sin(ang) * r
                    };
                    try { if (ent?.isValid) ent.teleport(satPos); } catch { }
                }
            }
            if (ball.t % 6 === 0) {
                sound(ball.dim, "xvoid.steelball_turn", ball.pos, 1.75, 0.55);
                spawnImpactRing(ball.dim, ball.pos, { x: 0, y: 1, z: 0 }, {
                    radius: 2.4, time: 0.18, color: Colors.crimson, alpha: 0.85
                });
            }
            if (ball.satStorm === 0) {
                spreadFloatSatellites(ball, ball.charged, 45);
                cleanupFloatSatellites(ball);
            }
        }
        if (ball.t % 10 === 0) sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.2, 0.35);
        if (ball.t % 2 === 0) doFloatDamage(ball);
        if (ball.t >= 150) startReturn(ball);
        return;
    }
    if (ball.state === "trick") tickTrick(ball, owner);
}


function tryTrickShot(striker) {
    if (tryAnchorTrickShot(striker, nearestTarget)) return true;
    for (const fb of balls) {
        if (fb === striker || fb.mode !== "float" || fb.state !== "hover" || fb.dim.id !== striker.dim.id) continue;
        if (len(sub(fb.pos, striker.pos)) > 1.8) continue;

        if (fb.satOrbitEnts?.length) {
            spreadFloatSatellites(fb, fb.charged, 45);
            cleanupFloatSatellites(fb);
        }

        const specialAtThrow = striker.specialAtThrow ?? 0;

        const bonusPct = Math.min(100, Math.max(0, specialAtThrow)) / 100;
        const splitDmg = (15.6 * (1 + bonusPct)) / 2;
        const charged = specialAtThrow >= 50;
        const target = nearestTarget(fb.dim, fb.pos, 8, fb.ownerId);
        const baseSide = Math.random() < 0.5 ? -1 : 1;

        for (const [b, partner, sideSign, detourTicks, arcTicks, arcStrength, speed, retDelay] of [
            [fb, striker, baseSide, 0, 5, 0.65, 1.5, 0],
            [striker, fb, -baseSide, 4, 5, 0.9, 1.5, 4]
        ]) {
            b.state = "trick";
            b.t = 0;
            b.partner = partner;
            b.detourTicks = detourTicks;
            b.arcTicks = arcTicks;
            b.arcStrength = arcStrength;
            b.trickSpeed = speed;
            b.returnDelay = retDelay;
            b.trickStart = b.travelled;
            b.specialAtThrow = specialAtThrow;
            b.trickDmg = splitDmg;
            b.charged = charged;
            b.curveSide = sideSign;
            b.homing = target;
            try { b.entity?.setProperty("property:charged", charged ? 1 : 0); } catch { }

            const baseDir = target ? norm(sub(chest(target), b.pos)) : striker.dir;
            const side = { x: -baseDir.z * sideSign, y: 0.22, z: baseDir.x * sideSign };
            b.dir = detourTicks > 0 ? norm(add(side, baseDir, -0.35)) : norm(add(baseDir, side, arcStrength));
        }

        sound(fb.dim, "xvoid.steelball_hit_L", fb.pos, 1.3);
        spawnGlowFlash(fb.dim, fb.pos, { size: 2.2, life: 0.25, color: Colors.gold, alpha: 0.95 });
        return true;
    }
    return false;
}


function tickCurve(ball, owner) {
    if (ball.state === "impact") return tickImpact(ball);
    ball.t++;
    const s = owner?.isValid ? P(owner) : null;

    const maxDist = ball.maxDistance ?? 26;
    const minDist = ball.minDistance ?? 16;
    const maxTicks = ball.maxTicks ?? 42;


    const canHome = ball.travelled >= 5 && (ball.specialAtThrow ?? 0) >= 10 && Boolean(s && s.exact > 0);

    if (canHome && !ball.target?.isValid) {
        ball.target = nearestTarget(ball.dim, ball.pos, 10, ball.ownerId);
    }

    const hasTarget = canHome && Boolean(ball.target?.isValid);
    let targetDist = Infinity;
    let targetDir = null;

    if (hasTarget) {
        const to = sub(chest(ball.target), ball.pos);
        targetDist = len(to);
        targetDir = norm(to);
        setExact(owner, s, Math.max(0, s.exact - 0.6));
    }


    if (hasTarget && targetDir) {
        const side = { x: -targetDir.z * ball.curveSide, y: 0.16, z: targetDir.x * ball.curveSide };
        const bend = Math.max(0, 1 - ball.t / 16) * Math.min(1.0, targetDist / 3.0);
        const curved = norm(add(targetDir, side, bend * 0.85));

        ball.dir = targetDist < 2.2 ? targetDir : lerpDir(ball.dir, curved, 0.55);
        if (ball.t % 3 === 0) sound(ball.dim, "xvoid.steelball_turn", ball.pos, 1.5, 0.4);
    } else if (ball.t <= 12) {

        const side = { x: -ball.aim.z, y: 0, z: ball.aim.x };
        const k = ball.curveSide * 0.95 * Math.cos((ball.t / 12) * Math.PI);
        ball.dir = norm(add(ball.aim, side, k));
    } else if (!ball.target) {
        ball.dir = ball.aim;
    }

    const speed = hasTarget ? 1.3 : 1.2;
    const next = add(ball.pos, ball.dir, speed);


    if (isSolidAt(ball.dim, next)) {
        particle(ball.dim, "xvoid:dust_puff", ball.pos);
        sound(ball.dim, "xvoid.steelball_hit_S", ball.pos, 0.9, 0.8);
        return startReturn(ball);
    }


    const hitEnemy = nearestTarget(ball.dim, next, 1.5, ball.ownerId);
    if (hitEnemy) {
        ball.target = hitEnemy;
        ball.state = "impact";
        ball.hitTimer = 2;
        return;
    }

    if (tryTrickShot(ball)) return;
    moveTo(ball, next);


    if (ball.travelled >= maxDist || ball.t >= maxTicks || (!canHome && ball.travelled >= minDist)) {
        return startReturn(ball);
    }
}


function groundY(dim, x, y, z) {
    for (let dy = 2; dy >= -4; dy--) {
        const atY = Math.floor(y + dy);
        if (isSolidAt(dim, { x, y: atY, z }) && !isSolidAt(dim, { x, y: atY + 1, z })) {
            return atY + 0.05;
        }
    }
    return null;
}

function tornado(ball, owner) {
    ball.state = "tornado";
    ball.t = 0;
    ball.tornadoY = ball.pos.y + 0;
    const dim = ball.dim;
    sound(dim, "xvoid.groundHit", ball.pos, 0.9, 1.2);
    sound(dim, "xvoid.steelball_hit_L", ball.pos, 0.8, 1.2);
    particle(dim, "sfx:impact", ball.pos);
    particle(dim, "xvoid:earth_debris", ball.pos);


    for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        particle(dim, "xvoid:dust_puff", {
            x: ball.pos.x + Math.cos(ang) * 1.6,
            y: ball.pos.y + 0.15,
            z: ball.pos.z + Math.sin(ang) * 1.6
        });
    }

    for (let i = 0; i < 4; i++) {
        particle(dim, "xvoid:tornado", { x: ball.pos.x, y: ball.pos.y - 0.4 + i * 0.5, z: ball.pos.z });
    }
    spawnImpactRing(dim, ball.pos, { x: 0, y: 1, z: 0 }, { radius: 4.5, time: 0.5, color: Colors.white, alpha: 0.9, soft: true });
    spawnVortexRing(dim, { x: ball.pos.x, y: ball.pos.y + 0.3, z: ball.pos.z }, { x: 0, y: 1, z: 0 }, { radius: 2.5, thickness: 0.4 });

    const initialDmg = (ball.dmg || 0.75) * 1.5;
    for (const e of targetsNear(dim, ball.pos, 4.5, ball.ownerId)) {
        try { if (e.hasTag("blocking")) breakGuard(e, "heavy"); } catch { }
        hitTarget(ball, e, initialDmg);
        if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
            try { e.applyKnockback({ x: 0, z: 0 }, 1); } catch { }
        }
    }
}

function tickLow(ball, owner) {
    if (ball.state === "fly") {
        const s = owner?.isValid ? P(owner) : null;
        if (owner?.isValid && !owner.isSneaking && s?.lowArmed) return tornado(ball, owner);
        if (owner?.isSneaking) {
            if (s) s.lowArmed = true;
            const look = owner.getViewDirection();
            ball.dir = lerpDir(ball.dir, norm({ x: look.x, y: 0, z: look.z }), 0.35);
        }

        const flat = norm({ x: ball.dir.x, y: 0, z: ball.dir.z });
        const nx = ball.pos.x + flat.x * 0.45;
        const nz = ball.pos.z + flat.z * 0.45;
        const gy = groundY(ball.dim, nx, ball.pos.y, nz);
        if (gy === null) return tornado(ball, owner);

        ball.dir = flat;
        moveTo(ball, { x: nx, y: gy + 1, z: nz });
        if (ball.t++ % 4 === 0) {
            particle(ball.dim, "xvoid:dust_puff", { x: nx, y: gy, z: nz });
            sound(ball.dim, "xvoid.steelball_turn", ball.pos, 1.4, 0.35);
        }
        if (ball.travelled >= 20) tornado(ball, owner);
        return;
    }
    if (ball.state === "tornado") {
        ball.t++;
        const baseY = (ball.tornadoY ?? ball.pos.y) - 0.7;
        const hoverY = (ball.tornadoY ?? ball.pos.y) + Math.sin(ball.t * 0.3) * 0.25;
        moveTo(ball, { x: ball.pos.x, y: hoverY, z: ball.pos.z });


        if (ball.t % 3 === 0) {
            const targets = targetsNear(ball.dim, ball.pos, 4.5, ball.ownerId);
            const tickDmg = ball.dmg || 0.75;
            for (const e of targets) {
                if (e.hasTag("blocking")) {
                    try { breakGuard(e, "heavy"); } catch { }
                }
                hitTarget(ball, e, tickDmg);

                const dx = ball.pos.x - e.location.x;
                const dz = ball.pos.z - e.location.z;
                const d = Math.hypot(dx, dz) || 1;
                if (!e.hasTag("tusk_detached") && !e.hasTag("tusk_spatial")) {
                    try {
                        e.applyKnockback({ x: (dx / d) * 0.22, z: (dz / d) * 0.22 }, 0.25);
                    } catch { }
                }
            }
        }


        if (ball.t % 2 === 0) {
            particle(ball.dim, "xvoid:tornado", { x: ball.pos.x, y: baseY, z: ball.pos.z });
            particle(ball.dim, "xvoid:tornado", { x: ball.pos.x, y: baseY + 1.5, z: ball.pos.z });
            sound(ball.dim, "xvoid.steelball_turn2", ball.pos, 1.4, 0.45);
        }


        if (ball.t % 2 === 0) {
            const groundAngle = (ball.t * 37) * (Math.PI / 180);
            const rBase = 1.0 + Math.random() * 1.6;
            particle(ball.dim, "xvoid:dust_puff", {
                x: ball.pos.x + Math.cos(groundAngle) * rBase,
                y: baseY + 0.1,
                z: ball.pos.z + Math.sin(groundAngle) * rBase
            });
        }


        for (let h = 0; h < 3; h++) {
            const heightOff = 0.5 + h * 1.3;
            const coneRadius = 0.7 + h * 0.85;
            const spinAngle = (ball.t * 22 + h * 120) * (Math.PI / 180);
            particle(ball.dim, "xvoid:dust_puff", {
                x: ball.pos.x + Math.cos(spinAngle) * coneRadius,
                y: baseY + heightOff,
                z: ball.pos.z + Math.sin(spinAngle) * coneRadius
            });
        }


        if (ball.t % 6 === 0) {
            spawnImpactRing(ball.dim, { x: ball.pos.x, y: ball.tornadoY ?? ball.pos.y, z: ball.pos.z }, { x: 0, y: 1, z: 0 }, {
                radius: 2.8 + (ball.t / 60) * 1.2,
                time: 0.28,
                color: Colors.white,
                alpha: 0.85,
                soft: true
            });
            spawnVortexRing(ball.dim, { x: ball.pos.x, y: baseY + 1.0, z: ball.pos.z }, { x: 0, y: 1, z: 0 }, {
                radius: 2.0 + (ball.t / 60) * 1.5,
                thickness: 0.35
            });
        }

        if (ball.t >= 60) startReturn(ball);
    }
}


const projectiles = new Set();

function blockBaseDamage(id) {
    if (/obsidian|netherite|ancient_debris|anvil|reinforced|bedrock/.test(id)) return 16;
    if (/iron_block|gold_block|diamond_block|emerald_block|deepslate|_ore|copper_block/.test(id)) return 11;
    if (/stone|cobble|brick|andesite|diorite|granite|concrete|terracotta|basalt|tuff|calcite|prismarine|quartz/.test(id)) return 8;
    if (/log|plank|wood|stem|hyphae|bookshelf/.test(id)) return 6;
    if (/dirt|sand|gravel|grass|clay|wool|snow|leaves|glass|mud|soul|hay/.test(id)) return 4;
    return 6;
}

const NonFullSolid = /slab|stairs|wall|fence|gate|door|trapdoor|pane|leaves|torch|lantern|chain|bars|bed|banner|candle|pot|rod|skull|head|scaffolding|conduit|shulker|hopper|cauldron|composter|anvil|grindstone|stonecutter|bell|ladder|carpet|(?:^|:)snow_layer$|(?:^|:)snow$|web|rail|vine|water|lava|light|sign|button|lever|plate|sensor|repeater|comparator|redstone|wire|spore|dripleaf|azalea|lily|cactus|bamboo|sugar_cane|lichen|mushroom|fungus|roots|sprout|nether_wart|coral|chest|air/;

function isFullSolidBlock(typeId) {
    if (!typeId || Passable.test(typeId) || NonFullSolid.test(typeId)) return false;
    try {
        const perm = BlockPermutation.resolve(typeId);
        return Boolean(perm);
    } catch {
        return false;
    }
}

function heldBlockPermutation(player) {
    const it = held(player);
    if (!it || it.typeId === BallItem || it.typeId === WbItem || !isFullSolidBlock(it.typeId)) return null;
    try { return { item: it, perm: BlockPermutation.resolve(it.typeId) }; } catch { return null; }
}

function throwBlock(player) {
    if (!isSpinUser(player)) return false;
    const s = P(player);
    if (!s.blockMode || tick - s.lastBlockThrow < 4) return false;
    const hb = heldBlockPermutation(player);
    if (!hb || !removeHeldOne(player)) return false;
    s.lastBlockThrow = tick;


    const dmg = blockBaseDamage(hb.item.typeId) + s.exact * 0.15;


    setExact(player, s, 0);
    setBlockMode(player, s, false);

    const dir = getTimDetachedShootDir(player) ?? player.getViewDirection();
    projectiles.add({
        ownerId: player.id,
        dim: player.dimension,
        pos: add(eyeOf(player), dir, 1.0),
        vel: { x: dir.x * 1.4, y: dir.y * 1.4, z: dir.z * 1.4 },
        perm: hb.perm,
        itemId: hb.item.typeId,
        dmg,
        travelled: 0,
        t: 0
    });
    sound(player.dimension, "xvoid.steelball_turn", player.location, 1.3, 0.9);
    return true;
}

function crumble(p) {
    projectiles.delete(p);
    particle(p.dim, "xvoid:dust_puff", p.pos);
    sound(p.dim, "dig.stone", p.pos, 1, 1);
    try { p.dim.spawnItem(new ItemStack(p.itemId, 1), p.pos); } catch { }
}

function tickProjectiles() {
    for (const p of projectiles) {
        if (isTimeStopped()) { drawProjectile(p); continue; }
        p.t++;

        const step = len(p.vel);
        p.travelled = (p.travelled || 0) + step;
        const next = add(p.pos, p.vel);


        if (isSolidAt(p.dim, next) || p.travelled >= 35 || p.t > 30) {
            crumble(p);
            continue;
        }

        const t = nearestTarget(p.dim, next, 2.0, p.ownerId);
        p.pos = next;
        if (t) {
            const owner = world.getEntity(p.ownerId);
            try { owner?.isValid ? applyHitscanDamage(owner, t, p.dmg) : t.applyDamage(p.dmg, { cause: "override" }); } catch { }
            sound(p.dim, "xvoid.steelball_hit_L", p.pos, 1.2, 0.8);
            crumble(p);
            continue;
        }
        drawProjectile(p);
    }
}

function drawProjectile(p) {
    try {
        renderer ??= new BlockRenderer();
        const yaw = (p.t * 36) % 360;
        renderer.drawBlock({ permutation: p.perm }, {
            dimension: p.dim,
            location: { x: p.pos.x - 0.5, y: p.pos.y - 0.5, z: p.pos.z - 0.5 },
            lifetimeSeconds: 0.05,
            scale: 0.5,
            rotation: { x: 0, y: yaw, z: 0 }
        });
        if (p.t % 2 === 0) particle(p.dim, "xvoid:dust_puff", p.pos);
    } catch { }
}


function damageFor(spent, base, bonus, avail) {
    const f = Math.min(50, Math.max(0, spent)) / 50;
    return { dmg: base + bonus * f, charged: avail >= 50 };
}

function castMove(player, hold, sneak) {
    if (!isSpinUser(player)) return;
    const s = P(player);
    if (s.blockMode) return;
    syncExact(player, s);
    const avail = s.exact;
    const charged = avail >= 50;

    if (!sneak) {
        const spent = Math.min(50, avail);
        const { dmg } = hold ? damageFor(spent, 0.35, 0.25, avail) : damageFor(spent, 2.3, 1.7, avail);
        if (!spawnBall(player, hold ? "float" : "throw", { dmg, charged, maxHits: 3, specialAtThrow: avail })) return;
        setExact(player, s, avail - spent);
        return;
    }
    if (!hold) {

        const spent = Math.min(40, avail);
        const f = spent / 40;
        const dmg = 2.3 * (1 + 0.20 * f);
        const aim = player.getViewDirection();
        if (!spawnBall(player, "curve", {
            dmg,
            charged,
            maxHits: 3,
            aim,
            specialAtThrow: avail,
            minDistance: 16,
            maxDistance: 24,
            maxTicks: 40
        })) return;
        setExact(player, s, avail - spent);
        return;
    }
    const spent = Math.min(50, avail);
    const { dmg } = damageFor(spent, 0.75, 0.55, avail);
    const ball = spawnBall(player, "low", { immune: true, charged, dmg, specialAtThrow: avail });
    if (!ball) return;
    s.lowArmed = player.isSneaking;
    setExact(player, s, avail - spent);
    if (player.getViewDirection().y <= -0.75) {
        const gy = groundY(player.dimension, player.location.x, player.location.y, player.location.z);
        moveTo(ball, { x: player.location.x, y: (gy ?? player.location.y) + 1, z: player.location.z });
        tornado(ball, player);
    }
}

world.afterEvents.itemStartUse.subscribe(({ source, itemStack }) => {
    if (itemStack?.typeId !== BallItem || source?.typeId !== "minecraft:player") return;
    P(source).use = { start: tick, sneak: source.isSneaking, fired: false };
});

world.afterEvents.itemStopUse.subscribe(({ source, itemStack }) => {
    if (source?.typeId !== "minecraft:player") return;
    if (!isSpinUser(source)) return;
    const s = P(source);
    const u = s.use;
    s.use = null;
    if (!u || u.fired || (itemStack && itemStack.typeId !== BallItem)) return;
    castMove(source, false, u.sneak);
});


world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    const s = players.get(ev.player.id);
    if (!s?.blockMode || ev.itemStack?.typeId === BallItem || ev.itemStack?.typeId === WbItem || !ev.itemStack) return;
    ev.cancel = true;
    const p = ev.player;
    system.run(() => p.isValid && throwBlock(p));
});
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
    const s = players.get(ev.player.id);
    if (!s?.blockMode || !ev.itemStack || ev.itemStack.typeId === BallItem || ev.itemStack.typeId === WbItem) return;
    try { BlockPermutation.resolve(ev.itemStack.typeId); } catch { return; }
    ev.cancel = true;
});
world.afterEvents.itemUse.subscribe(({ source }) => { if (source?.typeId === "minecraft:player" && players.get(source.id)?.blockMode) throwBlock(source); });
world.afterEvents.entityHitBlock.subscribe(({ damagingEntity: e }) => { if (e?.typeId === "minecraft:player" && players.get(e.id)?.blockMode) throwBlock(e); });

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    if (ev.target?.typeId !== BallEntity || ev.target.hasTag("wrecking")) return;
    ev.cancel = true;
    const player = ev.player;
    const target = ev.target;
    system.run(() => {
        if (!player?.isValid || !target?.isValid) return;
        for (const b of balls) {
            if (b.entity?.id === target.id) {
                balls.delete(b);
                break;
            }
        }
        const dim = target.dimension;
        const pos = target.location;
        try { target.remove(); } catch { }
        giveBall(player, dim, pos);
    });
});

world.afterEvents.entityHitEntity.subscribe(({ damagingEntity: e, hitEntity }) => {
    if (hitEntity?.typeId === BallEntity && !hitEntity.hasTag("wrecking") && e?.typeId === "minecraft:player") {
        for (const b of balls) {
            if (b.entity?.id === hitEntity.id) {
                balls.delete(b);
                break;
            }
        }
        const dim = hitEntity.dimension;
        const pos = hitEntity.location;
        try { hitEntity.remove(); } catch { }
        giveBall(e, dim, pos);
        return;
    }
    if (e?.typeId === "minecraft:player" && players.get(e.id)?.blockMode) throwBlock(e);
});

function ownedBalls(id) { return [...balls].filter(b => b.ownerId === id); }

function onDoubleSneak(player, s) {
    if (!isSpinUser(player)) return;
    const mine = ownedBalls(player.id);
    if (mine.length) {
        for (const b of mine) if (b.state !== "return") startReturn(b);
        sound(player.dimension, "xvoid.steelball_turn2", player.location, 1.3, 0.8);
        return;
    }
    if (hasActiveWBBallsOrMines(player.id)) return;

    if (s.blockMode) return setBlockMode(player, s, false);
    if ((holdingAnySpinBall(player) || (s.spinUser && heldBlockPermutation(player))) && s.exact > 0) setBlockMode(player, s, true);
}

function setBlockMode(player, s, on) {
    s.blockMode = on;
    const loc = player.location;
    if (on) {
        sound(player.dimension, "xvoid.chargeMax", loc, 1.2, 1);
        sound(player.dimension, "xvoid.flash1", loc, 1.0, 0.7);
        spawnImpactRing(player.dimension, add(loc, { x: 0, y: 0.1, z: 0 }), { x: 0, y: 1, z: 0 }, { radius: 3, time: 0.35, color: Colors.gold, alpha: 0.95 });
        spawnGlowFlash(player.dimension, add(loc, { x: 0, y: 1, z: 0 }), { size: 2.4, life: 0.25, color: Colors.gold, alpha: 0.85 });
    } else {
        sound(player.dimension, "xvoid.steelball_turn", loc, 0.7, 0.7);
        try { player.setProperty("property:spin_item", 0); } catch { }
        updateItemSpinAnimation(player, s);
    }
}

function updateItemSpinAnimation(player, s) {
    const isUser = isSpinUser(player);
    const spinItem = isUser && holdingAnySpinBall(player);
    const solidBlock = Boolean(isUser && s.blockMode && heldBlockPermutation(player));
    const shouldSpin = spinItem || solidBlock;


    const propVal = shouldSpin ? 1 : 0;
    try {
        if (player.getProperty("property:spin_item") !== propVal) {
            player.setProperty("property:spin_item", propVal);
        }
    } catch { }

    if (solidBlock) {
        if (!player.hasTag("spin_block")) {
            try { player.addTag("spin_block"); } catch { }
        }
    } else {
        if (player.hasTag("spin_block")) {
            try { player.removeTag("spin_block"); } catch { }
        }
    }

    if (shouldSpin) {
        if (!s.spinningItem || tick % 30 === 0) {
            s.spinningItem = true;
            try { player.runCommand("playanimation @s animation.ball.spinItem"); } catch { }
            try { player.playAnimation("spin_item"); } catch { }
        }
    } else if (s.spinningItem) {
        s.spinningItem = false;
        try { player.runCommand("playanimation @s animation.ball.spinItem_stop"); } catch { }
        try { player.playAnimation("spin_item_stop"); } catch { }
    }
}


system.runInterval(() => {
    tick++;
    const stopped = isTimeStopped();

    for (const player of world.getAllPlayers()) {
        const isUser = isSpinUser(player);
        const s = P(player);
        const ball = isUser && holdingBall(player);
        const spinItem = isUser && holdingAnySpinBall(player);
        const sneak = player.isSneaking;
        syncExact(player, s);

        updateItemSpinAnimation(player, s);

        if (!isUser) {
            s.spinUser = false;
            if (s.blockMode) setBlockMode(player, s, false);
            continue;
        }

        s.spinUser = true;


        if (sneak && !s.wasSneak) {
            s.sneakTaps = s.sneakTaps.filter(t => tick - t <= DoubleSneakWindow);
            s.sneakTaps.push(tick);
            if (s.sneakTaps.length >= 2) { s.sneakTaps = []; onDoubleSneak(player, s); }
        }
        s.wasSneak = sneak;


        if (s.use && !s.use.fired && tick - s.use.start >= HoldTicks) {
            if (ball) { s.use.fired = true; castMove(player, true, s.use.sneak); }
            else s.use = null;
        }

        if (stopped && !player.hasTag("ts")) continue;

        setSpecialCooldown(player, 2);

        const curveOut = ownedBalls(player.id).some(b => b.mode === "curve" && b.state !== "return");

        if (s.blockMode) {

            try {
                const sp1 = world.scoreboard.getObjective("sp1")?.getScore(player.scoreboardIdentity ?? player);
                if (sp1 === 19 && heldBlockPermutation(player)) {
                    throwBlock(player);
                    continue;
                }
            } catch { }

            setExact(player, s, s.exact - BlockModeDrain);
            if (tick % 3 === 0) particle(player.dimension, "xvoid:spin_aura", player.location);
            if (s.exact <= 0) setBlockMode(player, s, false);
            continue;
        }

        if (spinItem) {
            s.awayTicks = 0;
            if (!curveOut && s.exact < 100) {
                if (sneak) {
                    setExact(player, s, s.exact + ChargePerTick);
                    if (s.chargeLoop-- <= 0) { s.chargeLoop = 30; sound(player.dimension, "xvoid.heart_chargeLP", player.location, 1, 0.6); }


                    if (tick % 2 === 0) {
                        particle(player.dimension, "xvoid:spin_charge", player.location);
                        particle(player.dimension, "xvoid:spin_aura", player.location);
                    }
                } else {

                    setExact(player, s, s.exact + AutoChargePerTick);
                    s.chargeLoop = 0;
                }
                s.maxed = false;
            } else s.chargeLoop = 0;

            if (s.exact >= 100 && !s.maxed) {
                s.maxed = true;
                sound(player.dimension, "xvoid.chargeMax", player.location, 1, 1);

                spawnGlowFlash(player.dimension, add(player.location, { x: 0, y: 1.0, z: 0 }), {
                    size: 2.8,
                    life: 0.35,
                    color: Colors.gold,
                    alpha: 0.85
                });
                spawnImpactRing(player.dimension, player.location, { x: 0, y: 1, z: 0 }, {
                    radius: 3.0,
                    time: 0.35,
                    color: Colors.gold,
                    alpha: 0.9
                });
                spawnStarburst(player.dimension, add(player.location, { x: 0, y: 1.2, z: 0 }), {
                    size: 2.0,
                    life: 0.28
                });
            }


            if (s.exact >= 50) {
                if (s.exact >= 100) {

                    if (tick % 2 === 0) {
                        particle(player.dimension, "xvoid:spin_aura", player.location);
                    }
                    if (tick % 12 === 0) {
                        spawnImpactRing(player.dimension, player.location, { x: 0, y: 1, z: 0 }, {
                            radius: 2.0,
                            time: 0.3,
                            color: Colors.gold,
                            alpha: 0.6,
                            soft: true
                        });
                    }
                } else {

                    if (tick % 3 === 0) {
                        particle(player.dimension, "xvoid:spin_aura", player.location);
                    }
                }
            }
        } else {
            const standC = (() => {
                try { return world.scoreboard.getObjective("standC")?.getScore(player.scoreboardIdentity ?? player) ?? 0; } catch { return 0; }
            })();
            const isOnSkill = player.hasTag("onSkill");
            if (s.standRegenCd > 0) s.standRegenCd--;
            if (standC === 1 && isOnSkill && !s.wasOnSkill) {
                triggerTuskSpinCooldown(player, StandRegenCdStep, StandRegenCdMax);
            }
            s.wasOnSkill = isOnSkill;

            const heldId = held(player)?.typeId;
            const holdingTuskStand = standC === 1 && (heldId === "jjba:stand" || heldId === "jjba:stand2");
            if (holdingTuskStand) {


                s.awayTicks = 0;
                s.chargeLoop = 0;
                if (!curveOut && s.standRegenCd <= 0 && s.exact < 100) {
                    setExact(player, s, s.exact + StandChargePerTick);
                    s.maxed = false;
                }
                if (s.exact >= 100 && !s.maxed) {
                    s.maxed = true;
                }
            } else if (!curveOut) {
                if (++s.awayTicks > DecayGrace && s.exact > 0) setExact(player, s, s.exact - DecayPerTick);
                if (s.exact <= 0 && s.awayTicks > DecayGrace) s.spinUser = false;
            }
        }
    }


    if (tick % 10 === 0) {
        const tracked = new Set();
        for (const b of balls) if (b.entity?.isValid) tracked.add(b.entity.id);

        for (const player of world.getAllPlayers()) {
            if (!player?.isValid) continue;
            try {
                const found = player.dimension.getEntities({
                    location: player.location,
                    maxDistance: 64,
                    type: BallEntity
                });
                for (const e of found) {
                    if (!e?.isValid || tracked.has(e.id)) continue;
                    adoptOrphan(e, player);
                    tracked.add(e.id);
                }
            } catch { }
        }
    }

    for (const ball of [...balls]) {
        if (!ball.entity?.isValid) { balls.delete(ball); giveBall(world.getEntity(ball.ownerId), ball.dim, ball.pos); continue; }

        if (ball.state === "return" || (ball.state === "tornado" && ball.t >= 20)) {
            const owner = world.getEntity(ball.ownerId);
            if (owner?.isValid && owner.dimension.id === ball.dim.id && len(sub(chest(owner), ball.pos)) < 1.4) {
                finishBall(ball, true);
                continue;
            }
        }
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
        if (ball.state === "trick") { tickTrick(ball, owner); continue; }
        if (ball.mode === "throw") tickThrow(ball, owner);
        else if (ball.mode === "float") tickFloat(ball, owner);
        else if (ball.mode === "curve") tickCurve(ball, owner);
        else if (ball.mode === "low") tickLow(ball, owner);
    }

    tickProjectiles();
}, 1);

world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!player?.isValid) return;
    system.runTimeout(() => {
        if (!player?.isValid) return;
        try {
            const tracked = new Set();
            for (const b of balls) if (b.entity?.isValid) tracked.add(b.entity.id);
            const found = player.dimension.getEntities({
                location: player.location,
                maxDistance: 96,
                type: BallEntity
            });
            for (const e of found) {
                if (!e?.isValid || tracked.has(e.id)) continue;
                adoptOrphan(e, player);
                tracked.add(e.id);
            }
        } catch { }
    }, 5);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    players.delete(playerId);
    for (const b of [...balls]) if (b.ownerId === playerId) dropBall(b);
});
