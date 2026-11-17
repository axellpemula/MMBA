import { world, system } from "@minecraft/server";
import { isTimeStopped, tsStopperIds } from "../utils/tsState.js";
import {
    Colors,
    spawnImpactRing,
    spawnPunchShockwave,
    spawnGlowFlash,
    spawnStarburst,
    spawnConeSparks
} from "../utils/vfx.js";

const fallingDownslams = new Map();
const knockedDownEntities = new Map();
const pendingTsDownslams = new Map();

function getScore(entity, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(entity.scoreboardIdentity ?? entity) ?? 0;
    } catch {
        return 0;
    }
}

function setScore(entity, objectiveName, value) {
    try {
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(entity.scoreboardIdentity ?? entity, Math.round(value));
    } catch {
        try {
            entity.runCommand(`scoreboard players set @s ${objectiveName} ${Math.round(value)}`);
        } catch { }
    }
}

function isEntityGrounded(entity) {
    if (!entity?.isValid) return false;
    try {
        if (entity.isOnGround) return true;
    } catch { }
    try {
        const loc = entity.location;
        const b = entity.dimension.getBlock({
            x: Math.floor(loc.x),
            y: Math.floor(loc.y - 0.25),
            z: Math.floor(loc.z)
        });
        if (b && !b.isAir && !b.isLiquid) {
            return true;
        }
    } catch { }
    return false;
}

function getHorizontalDir(caster, target) {
    let dirX = 0, dirZ = -1;
    try {
        if (caster?.isValid) {
            const vd = caster.getViewDirection();
            const len = Math.hypot(vd.x, vd.z);
            if (len > 0.001) {
                return { x: vd.x / len, z: vd.z / len };
            }
        }
    } catch { }
    try {
        if (caster?.isValid && target?.isValid) {
            const dx = target.location.x - caster.location.x;
            const dz = target.location.z - caster.location.z;
            const len = Math.hypot(dx, dz);
            if (len > 0.001) {
                return { x: dx / len, z: dz / len };
            }
        }
    } catch { }
    return { x: dirX, z: dirZ };
}

export function isKnockedDown(entity) {
    if (!entity?.isValid) return false;
    return knockedDownEntities.has(entity.id) || entity.hasTag("knocked_down");
}

function enterKnockedDownState(target, caster, opts, impactDropHeight) {
    if (!target?.isValid) return;

    const dim = target.dimension;
    const loc = target.location;
    const hitLoc = { x: loc.x, y: loc.y + 0.35, z: loc.z };

    const wasAirborne = Boolean(opts.wasAirborne || impactDropHeight > 0.85);
    const baseDuration = opts.durationTicks ?? 28;
    const durationTicks = wasAirborne ? Math.max(baseDuration, Math.min(40, baseDuration + 6)) : baseDuration;


    const spikeBonus = wasAirborne
        ? Math.min(5.5, (opts.bonusDamage ?? 3.5) + Math.max(0, impactDropHeight - 1.0) * 0.45)
        : (opts.bonusDamage ?? 0);

    if (spikeBonus > 0.2) {
        try {
            const applyOpts = {
                cause: "override",
                ...(caster?.isValid ? { damagingEntity: caster } : {})
            };
            target.applyDamage(spikeBonus, applyOpts);
        } catch { }
    }


    try {
        dim.spawnParticle("sfx:impact", { x: loc.x, y: loc.y + 0.1, z: loc.z });
        spawnImpactRing(dim, hitLoc, { x: 0, y: 1, z: 0 }, { radius: 3.4, time: 0.3, color: Colors.gold, alpha: 0.9 });
        spawnPunchShockwave(dim, hitLoc, { x: 0, y: 1, z: 0 });
        spawnConeSparks(dim, hitLoc, { x: 0, y: 1, z: 0 });
        dim.playSound("dig.stone", loc, { volume: 1.2, pitch: 0.75 });
        spawnGlowFlash(dim, hitLoc, { size: 2.8, life: 0.28, color: Colors.hot, alpha: 0.8 });
        spawnStarburst(dim, hitLoc, { size: 2.2, life: 0.24 });
        dim.playSound("xvoid.groundHit", loc, { volume: 1.25, pitch: 0.9 });
        dim.playSound("diego.gdcrash_01", loc, { volume: 1.0, pitch: 1.0 });
        dim.runCommand(`camerashake add @a[x=${loc.x.toFixed(1)},y=${loc.y.toFixed(1)},z=${loc.z.toFixed(1)},r=16] 0.45 0.25 positional`);
    } catch { }


    try {
        target.removeTag("blocking");
        target.removeTag("parry");
        target.removeTag("onSkill");
        target.removeTag("chargeT");
        target.removeTag("chargeM");
        target.addTag("knocked_down");
        if (target.typeId === "minecraft:player") {
            target.setProperty("property:blocking", 0);
            target.triggerEvent("xvoid:remove_damage_blocking");
        }
    } catch { }

    const existingStun = getScore(target, "stun");
    setScore(target, "stun", Math.max(existingStun, durationTicks));

    try {
        target.clearVelocity();
        target.teleport(target.location);
    } catch { }

    if (target.typeId === "minecraft:player") {
        try {
            target.playAnimation("animation.player.knockdown", { blendOutTime: 0.22 });
        } catch { }
    }

    knockedDownEntities.set(target.id, {
        entity: target,
        ticksLeft: durationTicks,
        totalTicks: durationTicks
    });
}


export function applyDownslam(target, caster, opts = {}) {
    if (!target?.isValid) return;
    if (target.hasTag("tusk_detached") || target.hasTag("tusk_spatial") || target.hasTag("tusk_rotation")) return;

    const dir = getHorizontalDir(caster, target);
    const push = opts.push ?? 0.35;

    if (isTimeStopped() && !tsStopperIds.has(target.id)) {
        pendingTsDownslams.set(target.id, {
            entity: target,
            caster,
            dir,
            opts: { ...opts, push }
        });
        return;
    }

    const startGrounded = isEntityGrounded(target);
    const startY = target.location.y;

    try {
        target.applyKnockback({ x: dir.x * push, z: dir.z * push }, startGrounded ? -0.45 : -1.25);
    } catch { }

    if (startGrounded) {
        enterKnockedDownState(target, caster, { ...opts, wasAirborne: false }, 0);
        return;
    }

    fallingDownslams.set(target.id, {
        entity: target,
        caster,
        startY,
        ticks: 0,
        maxTicks: 28,
        opts: { ...opts, wasAirborne: true }
    });
}

system.runInterval(() => {

    if (pendingTsDownslams.size > 0 && !isTimeStopped()) {
        for (const [id, item] of pendingTsDownslams.entries()) {
            pendingTsDownslams.delete(id);
            if (!item.entity?.isValid) continue;
            applyDownslam(item.entity, item.caster, item.opts);
        }
    }


    for (const [id, state] of fallingDownslams.entries()) {
        const { entity, caster, startY, opts } = state;
        if (!entity?.isValid) {
            fallingDownslams.delete(id);
            continue;
        }
        state.ticks++;


        if (state.ticks > 1 && !isEntityGrounded(entity)) {
            try {
                const v = entity.getVelocity();
                if (v.y > -0.65) {
                    entity.applyKnockback({ x: 0, z: 0 }, -0.85);
                }
            } catch { }
        }

        if (state.ticks >= 1 && (isEntityGrounded(entity) || state.ticks >= state.maxTicks)) {
            fallingDownslams.delete(id);
            const dropHeight = Math.max(0, startY - entity.location.y);
            enterKnockedDownState(entity, caster, opts, dropHeight);
        }
    }


    for (const [id, state] of knockedDownEntities.entries()) {
        const { entity } = state;
        if (!entity?.isValid) {
            knockedDownEntities.delete(id);
            continue;
        }


        let isDead = false;
        try {
            const hp = entity.getComponent("minecraft:health");
            if (hp && hp.currentValue <= 0) isDead = true;
        } catch { }
        const stunScore = getScore(entity, "stun");
        if (isDead || (stunScore <= 1 && state.ticksLeft > 2)) {
            try { entity.removeTag("knocked_down"); } catch { }
            knockedDownEntities.delete(id);
            continue;
        }

        state.ticksLeft--;

        if (state.ticksLeft % 4 === 0) {
            try {
                const loc = entity.location;
                entity.dimension.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.15, z: loc.z });
                entity.dimension.spawnParticle("minecraft:crit", { x: loc.x, y: loc.y + 0.45, z: loc.z });
            } catch { }
        }

        if (state.ticksLeft <= 0) {
            knockedDownEntities.delete(id);
            try { entity.removeTag("knocked_down"); } catch { }

            const curIf = getScore(entity, "iFrames");
            if (curIf < 6) setScore(entity, "iFrames", 6);
        }
    }
}, 1);
