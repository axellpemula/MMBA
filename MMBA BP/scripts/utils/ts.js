import { world } from "@minecraft/server";
import * as mc from '@minecraft/server';
import { tsStopperIds, tsInvertActiveIds, tsMutedActiveIds, isTimeStopped } from './tsState.js';
import { pushPlayerHudTitle } from '../energy.js';
import { flushPendingHits, accumulateVanillaHit } from '../damage/damage.js';
import { Colors, triggerImpactFrame, spawnImpactRing, spawnStarburst, spawnVortexRing } from './vfx.js';

const radius = 50;
const TsCloseTicks = 6;
const TsInvertHoldTicks = 14;
const TsInvertEndTick = 20;
const TsMutedStartTick = 16;
const TsVictimMuteDelayTicks = 28;

const AmbientSoundsToMute = [
    "music.game",
    "music.game.creative",
    "music.game.nether",
    "music.game.end",
    "music.game.water",
    "ambient.weather.rain",
    "ambient.weather.thunder",
    "ambient.cave",
    "ambient.underwater.loop",
    "ambient.underwater.enter",
    "ambient.underwater.additions",
    "ambient.nether_wastes.loop",
    "ambient.crimson_forest.loop",
    "ambient.warped_forest.loop",
    "ambient.soulsand_valley.loop",
    "ambient.basalt_deltas.loop",
    "liquid.water",
    "liquid.lava",
    "fire.fire",
    "portal.portal",
    "beacon.ambient",
    "conduit.ambient"
];

const timeStopAffectedEntities = new Map();
const closingPlayers = new Map();
let activeStopperIds = new Set();
let tsActiveTick = 0;

function getScore(entity, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(entity.scoreboardIdentity ?? entity) ?? 0;
    } catch {
        return 0;
    }
}

function setTsFx(player, fxValue, mutedActive = false) {
    if (!player?.isValid) return;
    const wasInvert = tsInvertActiveIds.has(player.id);
    const shouldInvert = fxValue > 0;
    const wasMuted = tsMutedActiveIds.has(player.id);
    const shouldMuted = Boolean(mutedActive);

    if (shouldInvert) {
        tsInvertActiveIds.add(player.id);
    } else {
        tsInvertActiveIds.delete(player.id);
    }

    if (shouldMuted) {
        tsMutedActiveIds.add(player.id);
    } else {
        tsMutedActiveIds.delete(player.id);
    }

    try {
        if (player.getProperty("property:ts_fx") !== fxValue) {
            player.setProperty("property:ts_fx", fxValue);
        }
    } catch { }

    if (wasInvert !== shouldInvert || wasMuted !== shouldMuted) {
        pushPlayerHudTitle(player);
    }
}

function isNearAnyTimeStop(entity, tsEntities) {
    if (!entity?.isValid) return false;
    const dimId = entity.dimension.id;
    const { x, y, z } = entity.location;
    for (const ts of tsEntities) {
        if (!ts?.isValid || ts.dimension.id !== dimId) continue;
        const dx = ts.location.x - x;
        const dy = ts.location.y - y;
        const dz = ts.location.z - z;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) return true;
    }
    return false;
}

function muteAmbientForStopper(player) {
    if (!player?.isValid) return;
    for (const soundId of AmbientSoundsToMute) {
        try {
            player.runCommand(`stopsound @s ${soundId}`);
        } catch { }
    }
}

function tickClosingTransitions() {
    for (const [playerId, ticksLeft] of closingPlayers) {
        const player = world.getEntity(playerId);
        if (!player?.isValid) {
            closingPlayers.delete(playerId);
            tsInvertActiveIds.delete(playerId);
            tsMutedActiveIds.delete(playerId);
            continue;
        }
        if (ticksLeft <= 1) {
            closingPlayers.delete(playerId);
            setTsFx(player, 0, tsMutedActiveIds.has(playerId));
        } else {
            closingPlayers.set(playerId, ticksLeft - 1);
            setTsFx(player, 2, tsMutedActiveIds.has(playerId));
        }
    }
}

mc.world.afterEvents?.playerLeave?.subscribe(({ playerId }) => {
    closingPlayers.delete(playerId);
    tsInvertActiveIds.delete(playerId);
    tsMutedActiveIds.delete(playerId);
});

mc.system.runInterval(() => {
    const playerDimensions = new Set(
        mc.world.getPlayers().map(p => p.dimension.id)
    );

    const tsEntities = [];
    for (const dimensionId of playerDimensions) {
        const dimension = mc.world.getDimension(dimensionId);
        tsEntities.push(...dimension.getEntities({
            tags: ["ts"]
        }));
    }

    if (tsEntities.length === 0) {
        const wasActive = activeStopperIds.size > 0 || tsStopperIds.size > 0;
        activeStopperIds.clear();
        tsStopperIds.clear();
        tsActiveTick = 0;

        for (const [entity, {
            velocity,
            rotation
        }] of timeStopAffectedEntities) {
            if (!entity?.isValid) continue;
            applyMomentum(entity, velocity, rotation);
        }
        timeStopAffectedEntities.clear();

        if (wasActive) {
            flushPendingHits();

            for (const player of mc.world.getPlayers()) {
                if (!player?.isValid) continue;
                if (tsInvertActiveIds.has(player.id) && !closingPlayers.has(player.id)) {
                    closingPlayers.set(player.id, TsCloseTicks);
                    setTsFx(player, 2, false);
                } else if (tsMutedActiveIds.has(player.id)) {
                    setTsFx(player, 0, false);
                }
                try {
                    player.playSound("xvoid.world_ed");
                } catch (e) { }
            }
        }

        tickClosingTransitions();
        return;
    }

    tsActiveTick++;
    const prevStoppers = new Set(activeStopperIds);
    activeStopperIds.clear();
    tsStopperIds.clear();
    let hasNewStopper = false;
    for (const ts of tsEntities) {
        activeStopperIds.add(ts.id);
        tsStopperIds.add(ts.id);
        if (!prevStoppers.has(ts.id)) {
            hasNewStopper = true;
            try {
                const center = { x: ts.location.x, y: ts.location.y + 1.0, z: ts.location.z };
                triggerImpactFrame(ts.dimension, ts.location, 3);
                spawnImpactRing(ts.dimension, center, { x: 0, y: 1, z: 0 }, { radius: 6.5, time: 0.4, color: Colors.gold, alpha: 0.9, soft: false });
                spawnStarburst(ts.dimension, center, { size: 2.8, life: 0.26 });
                spawnVortexRing(ts.dimension, center, { x: 0, y: 1, z: 0 }, { radius: 3.2, thickness: 0.35 });
            } catch (e) { }
        }
    }

    if (hasNewStopper) {
        tsActiveTick = 1;
        try { mc.world.stopMusic?.(); } catch { }
        for (const player of mc.world.getPlayers()) {
            if (!player?.isValid) continue;
            const isStopperOrExempt =
                activeStopperIds.has(player.id) ||
                player.hasTag("ts") ||
                player.hasTag("ts_exhausted") ||
                getScore(player, "tser") > 0;

            if (isStopperOrExempt || isNearAnyTimeStop(player, tsEntities)) {

                try { player.runCommand("stopsound @s"); } catch { }
            }

            try {
                player.playSound("xvoid.world_st");
                if (!isStopperOrExempt) {
                    player.addEffect("blindness", 20, { showParticles: false });
                }
            } catch (e) { }
        }
    }


    if (tsActiveTick % 10 === 0) {
        try { mc.world.stopMusic?.(); } catch { }
    }
    const startFxValue =
        tsActiveTick <= TsInvertHoldTicks ? 1 :
        tsActiveTick <= TsInvertEndTick ? 2 :
        0;
    const shouldShowMuted = tsActiveTick >= TsMutedStartTick;

    for (const player of mc.world.getPlayers()) {
        if (!player?.isValid) continue;
        const isStopper = activeStopperIds.has(player.id) || player.hasTag("ts") || getScore(player, "ts") >= 2;
        const canSeeInTS = isStopper || (getScore(player, "tser") >= 1 && isNearAnyTimeStop(player, tsEntities));

        if (canSeeInTS) {
            closingPlayers.delete(player.id);
            setTsFx(player, startFxValue, shouldShowMuted);
            if (tsActiveTick % 10 === 0) {
                muteAmbientForStopper(player);
            }
        } else {
            if (tsInvertActiveIds.has(player.id) && !closingPlayers.has(player.id)) {
                closingPlayers.set(player.id, TsCloseTicks);
                setTsFx(player, 2, false);
            } else if (tsMutedActiveIds.has(player.id)) {
                setTsFx(player, 0, false);
            }
            if (tsActiveTick > TsVictimMuteDelayTicks && tsActiveTick % 2 === 0 && isNearAnyTimeStop(player, tsEntities)) {

                try { player.runCommand("stopsound @s"); } catch { }
            }
        }
    }
    tickClosingTransitions();

    for (const dimensionId of playerDimensions) {
        const dimension = world.getDimension(dimensionId);

        for (const ts of dimension.getEntities({
            tags: ["ts"]
        })) {
            const {
                x: tx,
                y: ty,
                z: tz
            } = ts.location;

            for (const entity of dimension.getEntities({
                excludeTags: ["ts", "ts_exhausted"]
            })) {
                if (!entity?.isValid) continue;
                if (entity.typeId === "xvoid:dmg" || entity.typeId === "xvoid:impact_frame" || entity.typeId === "xvoid:tim_hitbox") continue;

                const {
                    x,
                    y,
                    z
                } = entity.location;
                const dx = tx - x;
                const dy = ty - y;
                const dz = tz - z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist > radius) continue;

                if (!timeStopAffectedEntities.has(entity)) {
                    timeStopAffectedEntities.set(entity, {
                        velocity: entity.getVelocity(),
                        rotation: entity.typeId !== "minecraft:player" ? entity.getRotation() : null
                    });
                }

                const stored = timeStopAffectedEntities.get(entity);

                if (entity.typeId !== "minecraft:player") entity.clearVelocity();
                entity.teleport(entity.location, {
                    keepVelocity: entity.typeId !== "minecraft:player",
                    rotation: stored?.rotation ?? entity.getRotation()
                });

                if (entity.typeId === "minecraft:tnt") {
                    entity.triggerEvent("hold_explosion");
                }
                if (entity.typeId === "jjba:steelball" || entity.typeId === "jjba:nail") {
                    try { entity.setProperty("property:stopped", 1); } catch { }
                }
            }
        }
    }

    for (const [entity, {
        velocity,
        rotation
    }] of timeStopAffectedEntities) {
        if (!entity?.isValid || entity.hasTag("ts") || entity.hasTag("ts_exhausted")) {
            timeStopAffectedEntities.delete(entity);
            continue;
        }

        const {
            x,
            y,
            z
        } = entity.location;
        let stillInside = false;

        for (const ts of tsEntities) {
            const {
                x: tx,
                y: ty,
                z: tz
            } = ts.location;
            const dx = tx - x;
            const dy = ty - y;
            const dz = tz - z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist <= radius) {
                stillInside = true;
                break;
            }
        }

        if (!stillInside) {
            applyMomentum(entity, velocity, rotation);
            timeStopAffectedEntities.delete(entity);
        }
    }
}, 1);

function applyMomentum(entity, velocity, rotation) {
    if (!entity?.isValid) return;

    if (entity.typeId === "minecraft:tnt") {
        entity.triggerEvent("release_explosion");
    }
    if (entity.typeId === "jjba:steelball" || entity.typeId === "jjba:nail") {
        try { entity.setProperty("property:stopped", 0); } catch { }
    }

    if (entity.typeId === "minecraft:player") {
        const fx = velocity.x * 2;
        const fy = velocity.y * 2;
        const fz = velocity.z * 2;
        const h = Math.sqrt(fx * fx + fz * fz);
        if (h > 0) entity.applyKnockback({ x: fx, z: fz }, fy);
    } else {
        entity.applyImpulse(velocity);
        if (rotation) entity.setRotation(rotation);
    }
}


world.beforeEvents.entityHurt.subscribe((event) => {
    if (!isTimeStopped()) return;


    if (event.damageSource.cause === "override") return;

    const attacker = event.damageSource.damagingEntity;
    const isStopperAttack = attacker && tsStopperIds.has(attacker.id);


    const projectile = event.damageSource.damagingProjectile;
    const isStopperProjectile = projectile && (() => {
        try {
            const owner = projectile.getComponent("minecraft:projectile")?.owner;
            return owner && tsStopperIds.has(owner.id);
        } catch (e) { return false; }
    })();

    if (!isStopperAttack && !isStopperProjectile) {

        event.cancel = true;
        return;
    }


    if (isStopperAttack && !isStopperProjectile) {
        const target = event.hurtEntity;
        if (target && tsStopperIds.has(target.id)) return;

        event.cancel = true;
        if (!target?.isValid) return;

        let dx = target.location.x - attacker.location.x;
        let dz = target.location.z - attacker.location.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0) { dx /= len; dz /= len; }

        accumulateVanillaHit(target, event.damage, dx, dz);
    }

});


const ProjectileTypes = new Set([
    "minecraft:arrow",
    "minecraft:spectral_arrow",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:fireball",
    "minecraft:small_fireball",
    "minecraft:thrown_trident",
    "minecraft:shulker_bullet",
    "minecraft:wind_charge_projectile",
    "minecraft:dragon_fireball",
    "minecraft:wither_skull",
    "minecraft:llama_spit",
    "minecraft:fishing_hook",
    "minecraft:ender_pearl",
    "minecraft:splash_potion",
    "minecraft:lingering_potion",
]);

world.afterEvents.entitySpawn.subscribe((event) => {
    if (!isTimeStopped()) return;

    const entity = event.entity;
    if (!entity?.isValid) return;
    if (!ProjectileTypes.has(entity.typeId)) return;


    try {
        const owner = entity.getComponent("minecraft:projectile")?.owner;
        if (owner && tsStopperIds.has(owner.id)) return;
    } catch (e) { }


    mc.system.run(() => {
        try {
            if (entity?.isValid) entity.remove();
        } catch (e) { }
    });
});
