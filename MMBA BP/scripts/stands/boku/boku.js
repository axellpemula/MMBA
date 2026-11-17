import { world, system } from "@minecraft/server";
import { applyHitscanDamage, registerDamageHitListener } from "../../damage/damage.js";
import { isTimeStopped, tsStopperIds } from "../../utils/tsState.js";
import { getEnergy, useEnergy } from "../../energy.js";
import {
    Colors,
    buildBasis,
    getBlockRenderer,
    sampleGroundPermutation,
    spawnVFX,
    spawnImpactRing,
    spawnGlowFlash,
    spawnStarburst,
    spawnPunchShockwave,
    spawnConeSparks
} from "../../utils/vfx.js";

const BokuStandId = 5;
const StandItemIds = new Set(["jjba:stand", "jjba:stand2"]);
const BokuPinBaseDamage = 2.4;
const MaxAccumulatedPinDamage = 50;
const PinFuseTicks = 60;
const PinFireworkStepTicks = 1;
const PinBlastKbCooldownTicks = 10;
const PinBlastRadius = 3.4;
const MaxPinsPerTarget = 50;
const PinDormantMaxTicks = 600;
const HitKbGraceTicks = 10;
const FastMoveHorizSpeed = 0.275;
const FastMoveSustainTicks = 4;
const StrongKbHorizSpeed = 1.15;
const FastVertSpeed = 1.0;


const SmokeEnergyCost = 50;
const SmokeEnergyRegenDelayTicks = 120;
const SmokeWindupMatchTick = 12;
const SmokeWindupPuffTick = 22;
const SmokeReleaseTick = 30;
const SmokeCastEndTick = 36;
const SmokeStartRadius = 0.65;
const SmokeRadius = 6.5;
const SmokeGrowTicks = 60;
const SmokeExhaleStreamTicks = 16;
const SmokeDriftSpeed = 0.032;
const SmokeMinYOffset = -1.2;
const SmokeMaxYOffset = 3.6;
const SmokeDurationTicks = 240;
const SmokePinAttachInterval = 2;
const SmokePinDamage = 1.2;
const SmokeMaxHitsPerTarget = 100;

const KickEnergyCost = 30;
const KickEnergyRegenDelayTicks = 120;
const KickSoftCooldownTicks = 20;
const KickImpactTick = 4;
const KickCastEndTick = 6;
const KickDebrisBombCount = 14;
const KickTriangleHalfAngleRad = (34 * Math.PI) / 180;
const KickDebrisMinDist = 0.65;
const KickDebrisMaxDist = 5.5;
const KickDebrisBombDamage = 5.0;
const KickDebrisBombRadius = 4.2;
const KickDecoShardCount = 12;

const PinkSmokePalette = [
    Colors.pink,
    { x: 1.0, y: 0.56, z: 0.88 },
    { x: 0.92, y: 0.24, z: 0.68 }
];

const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const Down = Object.freeze({ x: 0, y: -1, z: 0 });
const PinOrigColor = Object.freeze({ x: 1.0, y: 1.0, z: 1.0 });

const FireworkPalette = [
    Colors.gold,
    Colors.hot,
    Colors.crimson,
    { x: 1.0, y: 0.92, z: 0.55 }
];

const ExcludeTypes = new Set([
    "minecraft:item",
    "minecraft:xp_orb",
    "minecraft:arrow",
    "minecraft:spectral_arrow",
    "minecraft:thrown_trident",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:ender_pearl",
    "minecraft:fireball",
    "minecraft:small_fireball",
    "minecraft:wither_skull",
    "minecraft:armor_stand",
    "minecraft:boat",
    "minecraft:chest_boat",
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:command_block_minecart",
    "minecraft:tnt",
    "minecraft:falling_block",
    "minecraft:area_effect_cloud",
    "minecraft:lightning_bolt",
    "minecraft:fishing_hook",
    "minecraft:leash_knot",
    "minecraft:ender_crystal",
    "xvoid:dmg",
    "xvoid:impact_frame",
    "xvoid:tim_arm",
    "xvoid:frozen_rain",
    "jjba:steelball",
    "jjba:knife",
    "jjba:nail"
]);


const activeClusters = new Map();

const lastPinKnockbackTick = new Map();
let nextPinUid = 1;
let isDetonatingPin = false;

function getScore(entity, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(entity) ?? 0;
    } catch {
        return 0;
    }
}

function isBokuUser(entity) {
    return Boolean(entity?.isValid && entity.typeId === "minecraft:player" && getScore(entity, "standC") === BokuStandId);
}

function isHoldingStandItem(entity) {
    if (!entity?.isValid || entity.typeId !== "minecraft:player") return false;
    try {
        const equip = entity.getComponent("minecraft:equippable");
        const mainhand = equip?.getEquipment("Mainhand");
        return Boolean(mainhand && StandItemIds.has(mainhand.typeId));
    } catch {
        return false;
    }
}

function canApplyPinBlastKnockback(victimId, tick) {
    const prev = lastPinKnockbackTick.get(victimId) ?? -9999;
    if (tick - prev < PinBlastKbCooldownTicks) return false;
    lastPinKnockbackTick.set(victimId, tick);
    return true;
}

function isValidPinTarget(entity) {
    if (!entity?.isValid) return false;
    if (ExcludeTypes.has(entity.typeId)) return false;
    if (entity.hasTag("tusk_rotation")) return false;
    if (entity.typeId === "minecraft:player") {
        try {
            if (entity.getGameMode?.() === "spectator") return false;
        } catch { }
    }
    try {
        const hp = entity.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) return false;
    } catch {
        return false;
    }
    return true;
}

function getEntityBodyBounds(entity) {
    try {
        if (typeof entity.getAABB === "function") {
            const aabb = entity.getAABB();
            if (aabb?.extent && aabb?.center) {
                const halfH = Math.max(0.22, Math.min(2.2, aabb.extent.y));
                const halfR = Math.max(0.22, Math.min(1.4, Math.max(aabb.extent.x, aabb.extent.z)));
                const centerY = Math.max(0.22, aabb.center.y - entity.location.y);
                return {
                    centerY,
                    halfH,
                    halfR,
                    pinSizeScale: Math.max(0.7, Math.min(1.0, halfH / 0.72))
                };
            }
        }
    } catch { }
    try {
        const head = entity.getHeadLocation();
        const eyeOffset = Math.max(0.25, head.y - entity.location.y);
        const height = Math.max(0.45, Math.min(3.8, eyeOffset / 0.88));
        const halfH = height * 0.5;
        return {
            centerY: height * 0.52,
            halfH,
            halfR: Math.max(0.26, Math.min(0.75, height * 0.34)),
            pinSizeScale: Math.max(0.7, Math.min(1.0, halfH / 0.72))
        };
    } catch { }
    return { centerY: 0.95, halfH: 0.9, halfR: 0.35, pinSizeScale: 1.0 };
}

function randomPinOffset(bounds) {
    const { centerY, halfH, halfR } = bounds;
    const angle = Math.random() * Math.PI * 2;
    const radius = halfR + 0.04 + Math.random() * 0.14;
    const ySpread = Math.min(halfH * 0.72, Math.max(0.14, centerY - 0.14));
    const y = Math.max(0.14, centerY + (Math.random() * 2 - 1) * ySpread);
    return {
        x: Math.cos(angle) * radius,
        y,
        z: Math.sin(angle) * radius
    };
}

function getPinWorldPos(baseLoc, offset) {
    return {
        x: baseLoc.x + offset.x,
        y: baseLoc.y + offset.y,
        z: baseLoc.z + offset.z
    };
}

function getPinInwardDir(offset, centerY = 0.95) {
    const dx = -offset.x;
    const dy = centerY - offset.y;
    const dz = -offset.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) {
        return { x: 0, y: -1, z: 0 };
    }
    return { x: dx / len, y: dy / len, z: dz / len };
}

function spawnPinIcon(dimension, pos, dir, color, size = 0.09, alpha = 1.0, pulse = 0) {
    spawnVFX(dimension, "boku:pin_bomb", pos, {
        dir: dir ?? { x: 0, y: -1, z: 0 },
        color,
        size,
        alpha,
        pulse
    });
}

function capturePlayerActionSnapshot(entity) {
    if (!entity?.isValid || entity.typeId !== "minecraft:player") {
        return { gunShot: 0, gunReload: 0, slot: 0 };
    }
    let gunShot = 0;
    let gunReload = 0;
    try { gunShot = entity.getProperty("property:gun_shot") ?? 0; } catch { }
    try { gunReload = entity.getProperty("property:gun_reload") ?? 0; } catch { }
    return {
        gunShot,
        gunReload,
        slot: entity.selectedSlotIndex ?? 0
    };
}

function getClusterStoredDamage(cluster, stateFilter = null) {
    let total = 0;
    for (const p of cluster.pins) {
        if (stateFilter && p.state !== stateFilter) continue;
        total += p.damage ?? BokuPinBaseDamage;
    }
    return total;
}

function getOrCreateCluster(target, resetActionState = true) {
    const dim = target.dimension;
    const bounds = getEntityBodyBounds(target);
    let cluster = activeClusters.get(target.id);

    if (!cluster) {
        const snap = capturePlayerActionSnapshot(target);
        cluster = {
            target,
            targetId: target.id,
            dimension: dim,
            bounds,
            prevLoc: { ...target.location },
            lastLoc: { ...target.location },
            dormantTicks: 0,
            hitGraceTicks: resetActionState ? HitKbGraceTicks : 0,
            fastMoveTicks: 0,
            lastGunShot: snap.gunShot,
            lastGunReload: snap.gunReload,
            pins: []
        };
        activeClusters.set(target.id, cluster);
        return cluster;
    }

    cluster.target = target;
    cluster.dimension = dim;
    cluster.bounds = bounds;
    cluster.dormantTicks = 0;


    if (resetActionState) {
        const snap = capturePlayerActionSnapshot(target);
        cluster.hitGraceTicks = HitKbGraceTicks;
        cluster.fastMoveTicks = 0;
        cluster.lastGunShot = snap.gunShot;
        cluster.lastGunReload = snap.gunReload;
    }

    return cluster;
}

function appendClusterPins(caster, target, cluster, count, damagePerPin, opts = {}) {
    const dim = cluster.dimension;
    const bounds = cluster.bounds;
    const unblockable = Boolean(opts.unblockable);
    const noStun = Boolean(opts.noStun);
    const noEnergyGain = Boolean(opts.noEnergyGain);
    const iconColor = opts.iconColor ?? { x: 1.0, y: 1.0, z: 1.0 };
    const iconEmission = opts.iconEmission ?? 0;
    const spawnIcon = opts.spawnIcon !== false;

    let dormantDamage = getClusterStoredDamage(cluster, "dormant");
    let dormantCount = cluster.pins.reduce((acc, p) => acc + (p.state === "dormant" ? 1 : 0), 0);
    let attached = 0;
    let hitDamageCap = false;

    for (let i = 0; i < count; i++) {
        const remainingBudget = MaxAccumulatedPinDamage - dormantDamage;
        if (remainingBudget <= 0.05 || dormantCount >= MaxPinsPerTarget) {
            hitDamageCap = true;
            break;
        }

        const pinDamage = Math.min(damagePerPin, remainingBudget);
        dormantDamage += pinDamage;
        dormantCount++;
        attached++;

        const offset = randomPinOffset(bounds);
        const dir = getPinInwardDir(offset, bounds.centerY);
        const pin = {
            uid: nextPinUid++,
            caster,
            casterId: caster?.id ?? "",
            offset,
            dir,
            sizeScale: bounds.pinSizeScale,
            damage: pinDamage,
            unblockable,
            noStun,
            noEnergyGain,
            state: "dormant",
            fuseTicks: PinFuseTicks
        };
        cluster.pins.push(pin);

        if (spawnIcon) {
            spawnPinIcon(dim, getPinWorldPos(target.location, offset), dir, iconColor, 0.11 * bounds.pinSizeScale, 1.0, iconEmission);
        }
    }

    if (hitDamageCap || dormantDamage >= MaxAccumulatedPinDamage - 0.05) {
        triggerDormantPins(cluster);
    }

    return attached;
}


export function placePinBombs(caster, target, count = 2) {
    if (isDetonatingPin) return;
    if (!isBokuUser(caster) || !isHoldingStandItem(caster) || !isValidPinTarget(target)) return;
    if (target.id === caster.id) return;

    const pinCount = Math.max(1, Math.min(4, count | 0));
    const cluster = getOrCreateCluster(target, true);
    appendClusterPins(caster, target, cluster, pinCount, BokuPinBaseDamage);

    try {
        target.dimension.playSound("random.click", target.location, { volume: 0.75, pitch: 1.5 + Math.random() * 0.2 });
    } catch { }
}

function attachSmokePinBomb(caster, casterId, target, hitIndex) {
    if (isDetonatingPin || !isValidPinTarget(target) || target.id === casterId) return false;
    const cluster = getOrCreateCluster(target, false);
    const attached = appendClusterPins(caster, target, cluster, 1, SmokePinDamage, {
        unblockable: true,
        noStun: true,
        noEnergyGain: true,
        iconColor: PinOrigColor,
        iconEmission: 0,
        spawnIcon: (hitIndex % 3 === 0)
    });
    if (attached > 0 && hitIndex % 6 === 0) {
        try {
            target.dimension.playSound("random.click", target.location, { volume: 0.42, pitch: 1.65 + Math.random() * 0.2 });
        } catch { }
    }
    return attached > 0;
}

function triggerDormantPins(cluster) {
    const dormantPins = cluster.pins.filter(p => p.state === "dormant");
    if (dormantPins.length === 0) return;

    const dim = cluster.target?.isValid ? cluster.target.dimension : cluster.dimension;
    const baseLoc = cluster.target?.isValid ? cluster.target.location : cluster.lastLoc;


    let maxExistingFuse = 0;
    for (const p of cluster.pins) {
        if (p.state === "triggered" && p.fuseTicks > maxExistingFuse) {
            maxExistingFuse = p.fuseTicks;
        }
    }
    const baseFuse = maxExistingFuse >= PinFuseTicks
        ? maxExistingFuse + PinFireworkStepTicks
        : PinFuseTicks;

    dormantPins.forEach((pin, idx) => {
        pin.state = "triggered";
        pin.fuseTicks = baseFuse + idx * PinFireworkStepTicks;
        const pos = getPinWorldPos(baseLoc, pin.offset);
        const scale = pin.sizeScale ?? cluster.bounds?.pinSizeScale ?? 1.0;
        spawnPinIcon(dim, pos, pin.dir, { x: 1.0, y: 0.45, z: 0.25 }, 0.12 * scale, 1.0, 0.25);
    });

    const center = { x: baseLoc.x, y: baseLoc.y + (cluster.bounds?.centerY ?? 0.95), z: baseLoc.z };
    try {
        dim.playSound("random.click", center, { volume: 1.0, pitch: 1.9 });
        dim.playSound("xvoid.oramuda_button2", center, { volume: 0.85, pitch: 1.35 });
        spawnImpactRing(dim, center, { x: 0, y: 1, z: 0 }, {
            radius: 1.5,
            time: 0.24,
            color: Colors.gold,
            alpha: 0.9
        });
    } catch { }
}

function didClusterTargetAct(cluster) {
    const target = cluster.target;
    if (!target?.isValid) return false;

    const stun = getScore(target, "stun");

    if (target.typeId === "minecraft:player") {

        const sp1 = getScore(target, "sp1");
        if (sp1 === 19 || sp1 === 20) return true;
        if (target.isJumping) return true;
        if (
            target.hasTag("onSkill") ||
            target.hasTag("charging") ||
            target.hasTag("chargingS")
        ) {
            return true;
        }
        try {
            const gs = target.getProperty("property:gun_shot") ?? 0;
            const gr = target.getProperty("property:gun_reload") ?? 0;
            if (gs !== cluster.lastGunShot || gr !== cluster.lastGunReload) return true;
        } catch { }
    }

    const loc = target.location;
    const prev = cluster.prevLoc ?? loc;
    const stepH = Math.hypot(loc.x - prev.x, loc.z - prev.z);
    const stepV = Math.abs(loc.y - prev.y);

    let velH = 0;
    let velV = 0;
    try {
        const vel = target.getVelocity();
        if (vel) {
            velH = Math.hypot(vel.x, vel.z);
            velV = Math.abs(vel.y);
        }
    } catch { }

    const horizSpeed = Math.max(velH, stepH);
    const vertSpeed = Math.max(velV, stepV);


    if (horizSpeed >= StrongKbHorizSpeed || vertSpeed >= FastVertSpeed) {
        return true;
    }

    if (cluster.hitGraceTicks > 0) {
        cluster.hitGraceTicks--;
        cluster.fastMoveTicks = 0;
        return false;
    }


    if (stun > 0) {
        cluster.fastMoveTicks = 0;
        return false;
    }


    const isRunningFast = (target.typeId === "minecraft:player" && target.isSprinting) || horizSpeed >= FastMoveHorizSpeed;
    if (isRunningFast) {
        cluster.fastMoveTicks = (cluster.fastMoveTicks ?? 0) + 1;
        return cluster.fastMoveTicks >= FastMoveSustainTicks;
    }

    cluster.fastMoveTicks = 0;
    return false;
}

function randomRingNormal() {
    const nx = Math.random() - 0.5;
    const ny = 0.35 + Math.random() * 0.9;
    const nz = Math.random() - 0.5;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
}

function detonateSinglePin(cluster, pin, isFinale) {
    const dim = cluster.target?.isValid ? cluster.target.dimension : cluster.dimension;
    const baseLoc = cluster.target?.isValid ? cluster.target.location : cluster.lastLoc;
    const center = getPinWorldPos(baseLoc, pin.offset);
    const caster = pin.caster?.isValid ? pin.caster : null;
    const fwColor = FireworkPalette[pin.uid % FireworkPalette.length];

    isDetonatingPin = true;
    try {
        try {

            dim.playSound("random.explode", center, {
                volume: isFinale ? 1.15 : 0.78,
                pitch: isFinale ? 1.0 : (1.28 + Math.random() * 0.28)
            });
            dim.playSound("firework.blast", center, {
                volume: isFinale ? 1.25 : 0.95,
                pitch: 0.95 + Math.random() * 0.3
            });
            if (isFinale || pin.uid % 2 === 0) {
                dim.playSound("firework.twinkle", center, {
                    volume: 0.75,
                    pitch: 1.0 + Math.random() * 0.25
                });
            }


            spawnVFX(dim, "boku:firework_burst", center, { color: fwColor });
            spawnVFX(dim, "boku:firework_embers", center, { color: fwColor });
            spawnStarburst(dim, center, {
                size: isFinale ? 2.6 : 1.75,
                life: isFinale ? 0.24 : 0.18
            });
            spawnGlowFlash(dim, center, {
                size: isFinale ? 3.1 : 2.1,
                life: isFinale ? 0.26 : 0.18,
                color: fwColor,
                alpha: 0.85
            });
            spawnImpactRing(dim, center, randomRingNormal(), {
                radius: isFinale ? 3.8 : 2.5,
                time: isFinale ? 0.32 : 0.24,
                color: fwColor,
                alpha: 0.92
            });

            if (isFinale) {
                dim.spawnParticle("sfx:impact", baseLoc);
                dim.spawnParticle("xvoid:dust_puff", center);
                spawnPunchShockwave(dim, center, { x: 0, y: 1, z: 0 });
                spawnImpactRing(dim, center, { x: 0, y: 1, z: 0 }, {
                    radius: PinBlastRadius + 0.5,
                    time: 0.34,
                    color: Colors.crimson,
                    alpha: 0.85
                });
                dim.runCommand(`camerashake add @a[x=${center.x.toFixed(1)},y=${center.y.toFixed(1)},z=${center.z.toFixed(1)},r=14] 0.6 0.18 positional`);
            } else {
                dim.runCommand(`camerashake add @a[x=${center.x.toFixed(1)},y=${center.y.toFixed(1)},z=${center.z.toFixed(1)},r=10] 0.22 0.1 positional`);
            }
        } catch { }

        let entities = [];
        try {
            entities = dim.getEntities({
                location: center,
                maxDistance: PinBlastRadius
            });
        } catch { }

        const timeStopped = isTimeStopped();

        for (const victim of entities) {
            if (!isValidPinTarget(victim)) continue;

            const vLoc = victim.location;
            const dx = vLoc.x - center.x;
            const dy = (vLoc.y + 1.0) - center.y;
            const dz = vLoc.z - center.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > PinBlastRadius) continue;

            const falloff = dist <= 1.5 ? 1.0 : Math.max(0.5, 1 - (dist - 1.5) / (PinBlastRadius - 1.0));
            const basePinDamage = pin.damage ?? BokuPinBaseDamage;
            const scaledDamage = basePinDamage * falloff;

            if (caster?.isValid) {
                applyHitscanDamage(caster, victim, scaledDamage, {
                    originPos: center,
                    checkPosFromOrigin: true,
                    alwaysInFront: victim.id === cluster.targetId || victim.id === caster.id,
                    noParry: Boolean(pin.unblockable) || victim.id === caster.id,
                    unblockable: Boolean(pin.unblockable),
                    noStun: Boolean(pin.noStun),
                    noEnergyGain: Boolean(pin.noEnergyGain),
                    allowSelfDamage: true,
                    skipPinPassive: true
                });
            } else {
                try {
                    if (!victim.hasTag("century_active")) {
                        victim.applyDamage(scaledDamage, { cause: "override" });
                    }
                } catch { }
            }

            if (
                !timeStopped &&
                !victim.hasTag("century_active") &&
                !victim.hasTag("tusk_spatial") &&
                !victim.hasTag("tusk_detached") &&
                !victim.hasTag("blocking") &&
                canApplyPinBlastKnockback(victim.id, system.currentTick)
            ) {
                const hDist = Math.hypot(dx, dz);
                const pushX = hDist > 0.05 ? dx / hDist : (Math.random() - 0.5);
                const pushZ = hDist > 0.05 ? dz / hDist : (Math.random() - 0.5);
                const hStrength = 0.55 * falloff;
                const vStrength = 0.30 * falloff;
                try {
                    victim.applyKnockback({ x: pushX * hStrength, z: pushZ * hStrength }, vStrength);
                } catch { }
            }
        }
    } finally {
        isDetonatingPin = false;
    }
}


registerDamageHitListener(({ caster, target, rawDamage, damageTaken, blocked, isMelee, isStrongKnockback }) => {
    if (isDetonatingPin) return;
    if (!target?.isValid) return;


    if (isMelee && isBokuUser(caster) && isHoldingStandItem(caster) && !blocked && target.id !== caster.id) {
        const count = rawDamage >= 7.5 ? 3 : 2;
        placePinBombs(caster, target, count);
    }


    if (isMelee && isBokuUser(target) && isHoldingStandItem(target) && caster?.isValid && caster.id !== target.id && damageTaken > 0) {
        placePinBombs(target, caster, 2);
    }


    const targetCluster = activeClusters.get(target.id);
    if (targetCluster) {
        if (!blocked && isStrongKnockback) {
            triggerDormantPins(targetCluster);
        } else {
            targetCluster.hitGraceTicks = HitKbGraceTicks;
            targetCluster.fastMoveTicks = 0;
        }
    }
});


world.afterEvents.entityHurt.subscribe(({ hurtEntity, damageSource, damage }) => {
    if (isDetonatingPin) return;
    if (!hurtEntity?.isValid) return;

    const attacker = damageSource?.damagingEntity;

    if (damageSource?.cause === "entityAttack" && damage > 0) {
        if (isBokuUser(attacker) && isHoldingStandItem(attacker) && hurtEntity.id !== attacker.id) {
            placePinBombs(attacker, hurtEntity, damage >= 7 ? 3 : 2);
        }
        if (isBokuUser(hurtEntity) && isHoldingStandItem(hurtEntity) && attacker?.isValid && attacker.id !== hurtEntity.id) {
            placePinBombs(hurtEntity, attacker, 2);
        }
    }


    if (damageSource?.cause !== "override") {
        const hurtCluster = activeClusters.get(hurtEntity.id);
        if (hurtCluster) {
            hurtCluster.hitGraceTicks = HitKbGraceTicks;
            hurtCluster.fastMoveTicks = 0;
        }
    }


    if (attacker?.isValid) {
        const cluster = activeClusters.get(attacker.id);
        if (cluster) {
            triggerDormantPins(cluster);
        }
    }
});


world.afterEvents.itemStartUse.subscribe(({ itemStack, source }) => {
    if (!source?.isValid) return;
    const isSneaking = source.isSneaking || getScore(source, "sneak") === 1;
    if (itemStack?.typeId === "jjba:stand" && isSneaking) return;
    const cluster = activeClusters.get(source.id);
    if (cluster) {
        triggerDormantPins(cluster);
    }
});


system.runInterval(() => {
    if (activeClusters.size === 0) return;

    const timeStopped = isTimeStopped();
    const tick = system.currentTick;

    for (const [targetId, cluster] of activeClusters.entries()) {
        const target = cluster.target;
        const targetValid = Boolean(target?.isValid);

        if (targetValid) {
            cluster.prevLoc = cluster.lastLoc ?? { ...target.location };
            cluster.lastLoc = { ...target.location };
            cluster.dimension = target.dimension;
        }

        const frozenInTs = timeStopped && (!targetValid || !tsStopperIds.has(targetId));
        if (frozenInTs) {
            if (tick % 6 === 0 && targetValid) {
                for (const pin of cluster.pins) {
                    const scale = pin.sizeScale ?? cluster.bounds?.pinSizeScale ?? 1.0;
                    spawnPinIcon(
                        cluster.dimension,
                        getPinWorldPos(cluster.lastLoc, pin.offset),
                        pin.dir,
                        { x: 0.72, y: 0.88, z: 1.0 },
                        0.09 * scale,
                        0.9,
                        0
                    );
                }
            }
            continue;
        }

        const targetAlive = isValidPinTarget(target);
        if (!targetAlive) {

            cluster.pins = cluster.pins.filter(p => p.state === "triggered");
            if (cluster.pins.length === 0) {
                activeClusters.delete(targetId);
                continue;
            }
        }

        const hasDormant = cluster.pins.some(p => p.state === "dormant");
        if (hasDormant && targetAlive) {
            cluster.dormantTicks++;
            if (cluster.dormantTicks > PinDormantMaxTicks) {
                cluster.pins = cluster.pins.filter(p => p.state === "triggered");
                if (cluster.pins.length === 0) {
                    activeClusters.delete(targetId);
                    continue;
                }
            } else if (didClusterTargetAct(cluster)) {
                triggerDormantPins(cluster);
            }
        }


        let earliestTriggeredFuse = Infinity;
        const readyToDetonate = [];
        const remainingPins = [];

        for (const pin of cluster.pins) {
            if (pin.state === "triggered") {
                pin.fuseTicks--;
                if (pin.fuseTicks <= 0) {
                    readyToDetonate.push(pin);
                    continue;
                }
                if (pin.fuseTicks < earliestTriggeredFuse) {
                    earliestTriggeredFuse = pin.fuseTicks;
                }
            }
            remainingPins.push(pin);
        }

        cluster.pins = remainingPins;


        if (readyToDetonate.length > 0) {
            let burstIdx = 0;
            for (const pin of cluster.pins) {
                if (pin.state === "triggered") {
                    const snapFuse = burstIdx === 0 ? 1 : Math.min(2, 1 + (burstIdx % 2));
                    if (pin.fuseTicks > snapFuse) {
                        pin.fuseTicks = snapFuse;
                    }
                    if (pin.fuseTicks < earliestTriggeredFuse) {
                        earliestTriggeredFuse = pin.fuseTicks;
                    }
                    burstIdx++;
                }
            }
        }


        if (tick % 4 === 0) {
            const iconStride = cluster.pins.length > 18 ? Math.ceil(cluster.pins.length / 16) : 1;
            for (let i = 0; i < cluster.pins.length; i++) {
                if (i % iconStride !== 0) continue;
                const pin = cluster.pins[i];
                const pos = getPinWorldPos(cluster.lastLoc, pin.offset);
                const scale = pin.sizeScale ?? cluster.bounds?.pinSizeScale ?? 1.0;
                if (pin.state === "dormant") {
                    spawnPinIcon(cluster.dimension, pos, pin.dir, PinOrigColor, 0.09 * scale, 0.95, 0);
                } else {
                    const progress = Math.max(0, Math.min(1, 1 - pin.fuseTicks / PinFuseTicks));
                    spawnPinIcon(
                        cluster.dimension,
                        pos,
                        pin.dir,
                        { x: 1.0, y: 0.45 - 0.25 * progress, z: 0.2 * (1 - progress) },
                        (0.10 + 0.03 * progress) * scale,
                        1.0,
                        0.25
                    );
                }
            }
        }

        if (Number.isFinite(earliestTriggeredFuse) && earliestTriggeredFuse > 0) {
            const tickInterval = earliestTriggeredFuse <= 14 ? 2 : (earliestTriggeredFuse <= 30 ? 4 : 8);
            if (earliestTriggeredFuse % tickInterval === 0) {
                const progress = Math.max(0, Math.min(1, 1 - earliestTriggeredFuse / PinFuseTicks));
                try {
                    cluster.dimension.playSound("note.hat", cluster.lastLoc, {
                        volume: 0.65,
                        pitch: 1.05 + progress * 0.85
                    });
                } catch { }
            }
        }


        const hasTriggeredLeft = cluster.pins.some(p => p.state === "triggered");
        for (let i = 0; i < readyToDetonate.length; i++) {
            const isFinale = !hasTriggeredLeft && i === readyToDetonate.length - 1;
            detonateSinglePin(cluster, readyToDetonate[i], isFinale);
        }

        if (cluster.pins.length === 0) {
            activeClusters.delete(targetId);
        }
    }
}, 1);


const activeBokuCasts = new Map();
const lastKickCastTick = new Map();
const activeSmokeZones = [];
const activeDebrisBombs = [];

function setScore(entity, objectiveName, value) {
    try {
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(entity, Math.round(value));
    } catch { }
}

function getHorizontalForward(player) {
    try {
        const v = player.getViewDirection();
        const len = Math.hypot(v.x, v.z);
        if (len > 1e-4) return { x: v.x / len, y: 0, z: v.z / len };
    } catch { }
    try {
        const yawRad = (player.getRotation().y * Math.PI) / 180;
        return { x: -Math.sin(yawRad), y: 0, z: Math.cos(yawRad) };
    } catch { }
    return { x: 0, y: 0, z: -1 };
}

function finishBokuCast(player) {
    if (!player?.isValid) return;
    try { player.removeTag("onSkill"); } catch { }
    try { player.setProperty("property:boku_smoke", 0); } catch { }
    try { player.runCommand("function util/returnMovement"); } catch { }
    setScore(player, "cd", 0);
}

function beginBokuCast(player, type, energyCost, regenDelayTicks, animationId, slownessTicks, slownessAmp, onStart = null) {
    if (!player?.isValid || !isBokuUser(player)) return false;
    if (activeBokuCasts.has(player.id) || player.hasTag("onSkill")) return false;

    if (getEnergy(player) < 1) {
        return false;
    }

    useEnergy(player, energyCost, regenDelayTicks);
    setScore(player, "cd", 0);

    try {
        player.addTag("onSkill");
        if (onStart) onStart(player);
        player.playAnimation(animationId);
        player.addEffect("slowness", slownessTicks, { amplifier: slownessAmp, showParticles: false });
    } catch { }

    activeBokuCasts.set(player.id, { type, player, ticks: 0 });
    return true;
}

function startSmokeCast(player) {
    beginBokuCast(
        player,
        "smoke",
        SmokeEnergyCost,
        SmokeEnergyRegenDelayTicks,
        "animation.boku.smoke",
        SmokeCastEndTick,
        1,
        (p) => p.setProperty("property:boku_smoke", 1)
    );
}

function startKickCast(player) {
    if (!player?.isValid) return;
    const tick = system.currentTick;
    if (tick - (lastKickCastTick.get(player.id) ?? -9999) < KickSoftCooldownTicks) return;

    if (beginBokuCast(
        player,
        "kick",
        KickEnergyCost,
        KickEnergyRegenDelayTicks,
        "animation.boku.kick_ground",
        8,
        3
    )) {
        lastKickCastTick.set(player.id, tick);
    }
}

function getCigaretteTipPos(player) {
    const fwd = getHorizontalForward(player);
    const { right } = buildBasis(fwd);
    let viewY = 0;
    try {
        viewY = player.getViewDirection().y ?? 0;
    } catch { }
    return {
        x: player.location.x + fwd.x * 0.48 - right.x * 0.07,
        y: player.location.y + 1.54 + viewY * 0.14,
        z: player.location.z + fwd.z * 0.48 - right.z * 0.07
    };
}

function spawnSmokePuffBurst(dim, center, radius, count, life = 1.15, sizeScale = 1.0, baseY = null, ySpread = 2.0) {
    const minY = baseY !== null ? baseY : (center.y + 0.35);
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius * 0.92;
        const px = center.x + Math.cos(angle) * r;
        const pz = center.z + Math.sin(angle) * r;
        const py = minY + (Math.random() - 0.25) * ySpread;
        const color = PinkSmokePalette[Math.floor(Math.random() * PinkSmokePalette.length)];
        spawnVFX(dim, "boku:pink_smoke", { x: px, y: py, z: pz }, {
            size: (0.95 + Math.random() * 0.85) * sizeScale,
            life,
            color,
            alpha: 0.46 + Math.random() * 0.22,
            speed: 0.25 + 0.55 * sizeScale
        });
    }
}

function spawnCigarExhaleJet(dim, cigarPos, dir, growthRatio) {
    for (let i = 0; i < 3; i++) {
        const step = 0.08 + Math.random() * (0.45 + growthRatio * 0.6);
        const jitter = 0.10 + growthRatio * 0.18;
        const pos = {
            x: cigarPos.x + dir.x * step + (Math.random() - 0.5) * jitter,
            y: cigarPos.y + (Math.random() - 0.3) * jitter * 0.7,
            z: cigarPos.z + dir.z * step + (Math.random() - 0.5) * jitter
        };
        const color = PinkSmokePalette[Math.floor(Math.random() * PinkSmokePalette.length)];
        spawnVFX(dim, "boku:pink_smoke", pos, {
            size: 0.34 + Math.random() * 0.28 + growthRatio * 0.35,
            life: 0.85 + Math.random() * 0.35,
            color,
            alpha: 0.58 + Math.random() * 0.16,
            speed: 0.22
        });
    }
}

function releaseSmokeZone(player) {
    const dim = player.dimension;
    const fwd = getHorizontalForward(player);
    const cigarPos = getCigaretteTipPos(player);
    const center = {
        x: cigarPos.x + fwd.x * 0.25,
        y: player.location.y,
        z: cigarPos.z + fwd.z * 0.25
    };

    try {
        dim.playSound("xvoid.5Prosciutto_smoke1", cigarPos, { volume: 1.0, pitch: 1.05 });
        dim.playSound("xvoid.wind2", cigarPos, { volume: 0.75, pitch: 0.92 });
        dim.playSound("xvoid.fireHit", cigarPos, { volume: 0.45, pitch: 1.35 });
    } catch { }

    spawnGlowFlash(dim, cigarPos, {
        size: 0.65,
        life: 0.20,
        color: Colors.pink,
        alpha: 0.88
    });
    spawnCigarExhaleJet(dim, cigarPos, fwd, 0.0);

    activeSmokeZones.push({
        caster: player,
        casterId: player.id,
        dimension: dim,
        center,
        dir: fwd,
        startMouthPos: { ...cigarPos },
        radius: SmokeStartRadius,
        maxRadius: SmokeRadius,
        remainingTicks: SmokeDurationTicks,
        elapsedTicks: 0,
        hitsByTarget: new Map()
    });
}

function executeKickGround(player) {
    const dim = player.dimension;
    const loc = player.location;
    const fwd = getHorizontalForward(player);
    const { right } = buildBasis(fwd);

    const kickX = loc.x + fwd.x * 0.85;
    const kickZ = loc.z + fwd.z * 0.85;
    const kickGround = sampleGroundPermutation(dim, Math.floor(kickX), Math.floor(loc.y), Math.floor(kickZ));
    const startY = Math.max(loc.y, kickGround.groundY + 1.0) + 0.22;
    const kickOrigin = { x: kickX, y: startY, z: kickZ };

    try {
        dim.playSound("xvoid.groundHit", kickOrigin, { volume: 1.0, pitch: 1.05 });
        dim.playSound("dig.stone", kickOrigin, { volume: 1.15, pitch: 0.85 });
        dim.playSound("xvoid.brk_rock", kickOrigin, { volume: 0.95, pitch: 1.0 });
        dim.playSound("xvoid.swing08", kickOrigin, { volume: 0.85, pitch: 1.15 });
        dim.spawnParticle("xvoid:dust_puff", kickOrigin);
        dim.runCommand(`camerashake add @a[x=${kickOrigin.x.toFixed(1)},y=${kickOrigin.y.toFixed(1)},z=${kickOrigin.z.toFixed(1)},r=14] 0.35 0.16 positional`);
    } catch { }

    spawnConeSparks(dim, kickOrigin, fwd);
    spawnImpactRing(dim, kickOrigin, UP, {
        radius: 2.1,
        time: 0.24,
        color: Colors.gold,
        alpha: 0.88
    });

    const renderer = getBlockRenderer();
    const soundGroup = nextPinUid++;


    for (let i = 0; i < KickDebrisBombCount; i++) {

        const d = KickDebrisMinDist + Math.pow(Math.random(), 1.75) * (KickDebrisMaxDist - KickDebrisMinDist);
        const rawAng = Math.random() * 2 - 1;
        const angle = Math.sign(rawAng) * Math.pow(Math.abs(rawAng), 0.78) * KickTriangleHalfAngleRad + (Math.random() - 0.5) * 0.20;
        const dirX = fwd.x * Math.cos(angle) + right.x * Math.sin(angle);
        const dirZ = fwd.z * Math.cos(angle) + right.z * Math.sin(angle);

        const spawnPos = {
            x: kickOrigin.x + (Math.random() - 0.5) * 0.40,
            y: kickOrigin.y + (Math.random() - 0.5) * 0.12,
            z: kickOrigin.z + (Math.random() - 0.5) * 0.40
        };
        const tx = kickOrigin.x + dirX * d + (Math.random() - 0.5) * 0.45;
        const tz = kickOrigin.z + dirZ * d + (Math.random() - 0.5) * 0.45;
        const sample = sampleGroundPermutation(dim, Math.floor(tx), Math.floor(loc.y), Math.floor(tz));
        const perm = sample?.perm ?? kickGround.perm;
        if (!perm) continue;

        const endY = (sample?.groundY ?? Math.floor(loc.y) - 1) + 1.06 + Math.random() * 0.12;
        const flightTicks = Math.max(3, Math.round(3 + (d / KickDebrisMaxDist) * 5 + Math.random() * 3));
        const flightSec = flightTicks / 20;

        const vx = (tx - spawnPos.x) / flightSec;
        const vz = (tz - spawnPos.z) / flightSec;
        const vy = (endY - spawnPos.y + 9.8 * flightSec * flightSec) / flightSec;

        const scale = 0.15 + Math.random() * 0.16;
        const rot = {
            x: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 34),
            y: Math.random() * 360,
            z: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 34)
        };
        const spin = (Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 380);

        try {
            renderer.drawBlock(
                { permutation: perm },
                {
                    dimension: dim,
                    location: { x: spawnPos.x - 0.5, y: spawnPos.y - 0.5, z: spawnPos.z - 0.5 },
                    lifetimeSeconds: flightSec,
                    scale,
                    rotation: rot,
                    velocity: { x: vx, y: vy, z: vz },
                    spin
                }
            );
        } catch { }

        const totalFuse = flightTicks + 5 + Math.floor(Math.random() * 9);
        activeDebrisBombs.push({
            caster: player,
            casterId: player.id,
            dimension: dim,
            startPos: spawnPos,
            targetPos: { x: tx, y: endY, z: tz },
            perm,
            scale,
            rot,
            vel: { x: vx, y: vy, z: vz },
            flightTicks,
            elapsedTicks: 0,
            landed: false,
            fuseTicks: totalFuse,
            totalFuseTicks: totalFuse,
            soundGroup
        });
    }


    for (let i = 0; i < KickDecoShardCount; i++) {
        const angle = (Math.random() * 2 - 1) * KickTriangleHalfAngleRad * 1.15;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const dirX = fwd.x * cosA + right.x * sinA;
        const dirZ = fwd.z * cosA + right.z * sinA;
        const speed = 1.8 + Math.random() * 5.2;
        const vy = 2.4 + Math.random() * 3.4;
        const life = Math.min(0.65, Math.max(0.28, (2 * vy) / 19.6));
        const sample = sampleGroundPermutation(dim, Math.floor(kickOrigin.x + dirX * 1.4), Math.floor(loc.y), Math.floor(kickOrigin.z + dirZ * 1.4));
        const perm = sample?.perm ?? kickGround.perm;
        if (!perm) continue;

        try {
            renderer.drawBlock(
                { permutation: perm },
                {
                    dimension: dim,
                    location: {
                        x: kickOrigin.x - 0.5 + (Math.random() - 0.5) * 0.35,
                        y: kickOrigin.y - 0.5,
                        z: kickOrigin.z - 0.5 + (Math.random() - 0.5) * 0.35
                    },
                    lifetimeSeconds: life,
                    scale: 0.11 + Math.random() * 0.12,
                    rotation: { x: Math.random() * 48 - 24, y: Math.random() * 360, z: Math.random() * 48 - 24 },
                    velocity: { x: dirX * speed, y: vy, z: dirZ * speed },
                    spin: (Math.random() < 0.5 ? -1 : 1) * (280 + Math.random() * 360)
                }
            );
        } catch { }
    }
}

function detonateDebrisBomb(bomb) {
    const dim = bomb.dimension;
    const center = bomb.targetPos;
    const caster = bomb.caster?.isValid ? bomb.caster : null;
    const fwColor = FireworkPalette[Math.floor(Math.random() * FireworkPalette.length)];

    isDetonatingPin = true;
    try {
        try {
            dim.playSound("random.explode", center, { volume: 0.85, pitch: 1.12 + Math.random() * 0.28 });
            dim.playSound("firework.blast", center, { volume: 0.95, pitch: 1.05 + Math.random() * 0.25 });
            spawnVFX(dim, "boku:firework_burst", center, { color: fwColor });
            spawnVFX(dim, "boku:firework_embers", center, { color: fwColor });
            spawnStarburst(dim, center, { size: 1.8, life: 0.20 });
            spawnGlowFlash(dim, center, { size: 2.8, life: 0.22, color: fwColor, alpha: 0.78 });
            spawnImpactRing(dim, center, randomRingNormal(), {
                radius: KickDebrisBombRadius,
                time: 0.26,
                color: fwColor,
                alpha: 0.65
            });
        } catch { }

        let entities = [];
        try {
            entities = dim.getEntities({ location: center, maxDistance: KickDebrisBombRadius + 0.8 });
        } catch { }

        const timeStopped = isTimeStopped();
        for (const victim of entities) {
            if (!isValidPinTarget(victim) || victim.id === bomb.casterId) continue;

            const vLoc = victim.location;
            const dx = vLoc.x - center.x;
            const dy = (vLoc.y + 1.0) - center.y;
            const dz = vLoc.z - center.z;
            if (Math.hypot(dx, dy, dz) > KickDebrisBombRadius) continue;

            if (caster) {
                applyHitscanDamage(caster, victim, KickDebrisBombDamage, {
                    originPos: center,
                    checkPosFromOrigin: true,
                    noEnergyGain: true,
                    skipPinPassive: true
                });
            } else if (!victim.hasTag("century_active")) {
                try { victim.applyDamage(KickDebrisBombDamage, { cause: "override" }); } catch { }
            }

            if (
                !timeStopped &&
                !victim.hasTag("century_active") &&
                !victim.hasTag("tusk_spatial") &&
                !victim.hasTag("tusk_detached") &&
                !victim.hasTag("blocking") &&
                canApplyPinBlastKnockback(victim.id, system.currentTick)
            ) {
                const hDist = Math.hypot(dx, dz);
                const pushX = hDist > 0.05 ? dx / hDist : (Math.random() - 0.5);
                const pushZ = hDist > 0.05 ? dz / hDist : (Math.random() - 0.5);
                try {
                    victim.applyKnockback({ x: pushX * 0.32, z: pushZ * 0.32 }, 0.18);
                } catch { }
            }
        }
    } finally {
        isDetonatingPin = false;
    }
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "xvoid:boku") return;
    const player = event.sourceEntity ?? event.initiator;
    if (!player?.isValid) return;

    const action = (event.message ?? "").trim().toLowerCase();
    if (action === "smoke") {
        startSmokeCast(player);
    } else if (action === "kick") {
        startKickCast(player);
    }
});

system.runInterval(() => {
    const timeStopped = isTimeStopped();
    const tick = system.currentTick;


    for (const [playerId, cast] of activeBokuCasts.entries()) {
        const player = cast.player;
        if (!player?.isValid || !isBokuUser(player) || getScore(player, "stun") >= 2 || player.hasTag("clashing")) {
            activeBokuCasts.delete(playerId);
            if (player?.isValid) finishBokuCast(player);
            continue;
        }
        if (timeStopped && !tsStopperIds.has(playerId)) continue;

        cast.ticks++;
        if (cast.type === "smoke") {
            if (cast.ticks === SmokeWindupMatchTick) {
                const fwd = getHorizontalForward(player);
                const { right } = buildBasis(fwd);
                const matchPos = {
                    x: player.location.x + fwd.x * 0.42 + right.x * 0.12,
                    y: player.location.y + 1.48,
                    z: player.location.z + fwd.z * 0.42 + right.z * 0.12
                };
                try {
                    player.dimension.playSound("fire.ignite", matchPos, { volume: 0.9, pitch: 1.25 });
                    player.dimension.playSound("xvoid.spark1", matchPos, { volume: 0.65, pitch: 1.35 });
                } catch { }
                spawnGlowFlash(player.dimension, matchPos, { size: 0.45, life: 0.18, color: Colors.hot, alpha: 0.95 });
                spawnVFX(player.dimension, "boku:firework_embers", matchPos, { color: Colors.hot });
            } else if (cast.ticks > SmokeWindupMatchTick && cast.ticks < SmokeWindupPuffTick && cast.ticks % 4 === 0) {
                const fwd = getHorizontalForward(player);
                const { right } = buildBasis(fwd);
                const flamePos = {
                    x: player.location.x + fwd.x * 0.42 + right.x * 0.08,
                    y: player.location.y + 1.50,
                    z: player.location.z + fwd.z * 0.42 + right.z * 0.08
                };
                spawnGlowFlash(player.dimension, flamePos, { size: 0.28, life: 0.14, color: Colors.hot, alpha: 0.78 });
            } else if (cast.ticks === SmokeWindupPuffTick) {
                const cherryPos = getCigaretteTipPos(player);
                spawnGlowFlash(player.dimension, cherryPos, { size: 0.25, life: 0.14, color: Colors.crimson, alpha: 0.85 });
                spawnVFX(player.dimension, "boku:pink_smoke", cherryPos, {
                    size: 0.30,
                    life: 0.45,
                    color: Colors.pink,
                    alpha: 0.62,
                    speed: 0.20
                });
            } else if (cast.ticks > SmokeWindupPuffTick && cast.ticks < SmokeReleaseTick && cast.ticks % 2 === 0) {
                const cherryPos = getCigaretteTipPos(player);
                spawnVFX(player.dimension, "boku:pink_smoke", cherryPos, {
                    size: 0.24,
                    life: 0.40,
                    color: Colors.pink,
                    alpha: 0.48,
                    speed: 0.16
                });
            } else if (cast.ticks === SmokeReleaseTick) {
                releaseSmokeZone(player);
            } else if (cast.ticks >= SmokeCastEndTick) {
                activeBokuCasts.delete(playerId);
                finishBokuCast(player);
            }
        } else if (cast.type === "kick") {
            if (cast.ticks === KickImpactTick) {
                executeKickGround(player);
            } else if (cast.ticks >= KickCastEndTick) {
                activeBokuCasts.delete(playerId);
                finishBokuCast(player);
            }
        }
    }


    if (!timeStopped) {
        for (let i = activeSmokeZones.length - 1; i >= 0; i--) {
            const zone = activeSmokeZones[i];
            if (zone.remainingTicks <= 0) {
                activeSmokeZones.splice(i, 1);
                continue;
            }
            const t = Math.min(1, zone.elapsedTicks / SmokeGrowTicks);
            zone.radius = SmokeStartRadius + (zone.maxRadius - SmokeStartRadius) * t;
            zone.center.x += zone.dir.x * SmokeDriftSpeed;
            zone.center.z += zone.dir.z * SmokeDriftSpeed;

            const shouldAttachPin = (zone.elapsedTicks % SmokePinAttachInterval === 0);
            const isExhaling = zone.elapsedTicks < SmokeExhaleStreamTicks;
            zone.elapsedTicks++;
            zone.remainingTicks--;

            if (isExhaling) {
                const streamOrigin = zone.caster?.isValid ? getCigaretteTipPos(zone.caster) : zone.startMouthPos;
                spawnCigarExhaleJet(zone.dimension, streamOrigin, zone.dir, t);
            }

            if (tick % 2 === 0) {
                const puffCount = Math.max(2, Math.round(2 + 6 * t));
                const puffScale = 0.42 + 1.08 * t;
                const puffBaseY = zone.startMouthPos.y * (1 - t) + (zone.center.y + 0.85) * t;
                const ySpread = 0.35 + 1.85 * t;
                spawnSmokePuffBurst(zone.dimension, zone.center, zone.radius, puffCount, 0.95 + 0.3 * t, puffScale, puffBaseY, ySpread);
            }
            if (tick % 12 === 0 && t >= 0.2) {
                spawnImpactRing(zone.dimension, { x: zone.center.x, y: zone.center.y + 0.18, z: zone.center.z }, UP, {
                    radius: zone.radius,
                    time: 0.55,
                    color: Colors.pink,
                    alpha: 0.24 * t,
                    soft: true
                });
            }

            if (!shouldAttachPin) continue;

            let nearby = [];
            try {
                nearby = zone.dimension.getEntities({
                    location: zone.center,
                    maxDistance: zone.radius + 1.5
                });
            } catch { }

            for (const ent of nearby) {
                if (!isValidPinTarget(ent) || ent.id === zone.casterId) continue;

                const dx = ent.location.x - zone.center.x;
                const dz = ent.location.z - zone.center.z;
                const dy = ent.location.y - zone.center.y;
                if (Math.hypot(dx, dz) > zone.radius) continue;
                if (dy < SmokeMinYOffset || dy > SmokeMaxYOffset) continue;

                const hits = zone.hitsByTarget.get(ent.id) ?? 0;
                if (hits >= SmokeMaxHitsPerTarget) continue;

                if (attachSmokePinBomb(zone.caster, zone.casterId, ent, hits)) {
                    zone.hitsByTarget.set(ent.id, hits + 1);
                }
            }
        }
    }


    if (activeDebrisBombs.length > 0 && !timeStopped) {
        const soundedGroups = new Set();
        const renderer = getBlockRenderer();

        for (let i = activeDebrisBombs.length - 1; i >= 0; i--) {
            const bomb = activeDebrisBombs[i];
            bomb.elapsedTicks++;
            bomb.fuseTicks--;

            if (!bomb.landed && bomb.elapsedTicks >= bomb.flightTicks) {
                bomb.landed = true;
                const remainingSec = Math.max(0.1, bomb.fuseTicks / 20);
                try {
                    renderer.drawBlock(
                        { permutation: bomb.perm },
                        {
                            dimension: bomb.dimension,
                            location: {
                                x: bomb.targetPos.x - 0.5,
                                y: bomb.targetPos.y - 0.5,
                                z: bomb.targetPos.z - 0.5
                            },
                            lifetimeSeconds: remainingSec,
                            scale: bomb.scale,
                            rotation: bomb.rot,
                            jumpHeight: 0
                        }
                    );
                } catch { }
            }

            let curPos;
            if (bomb.landed) {
                curPos = bomb.targetPos;
            } else {
                const t = bomb.elapsedTicks / 20;
                curPos = {
                    x: bomb.startPos.x + bomb.vel.x * t,
                    y: bomb.startPos.y + bomb.vel.y * t - 9.8 * t * t,
                    z: bomb.startPos.z + bomb.vel.z * t
                };
            }

            if (bomb.fuseTicks <= 0) {
                activeDebrisBombs.splice(i, 1);
                detonateDebrisBomb(bomb);
                continue;
            }

            if (bomb.elapsedTicks % 2 === 0) {
                const progress = Math.max(0, Math.min(1, 1 - bomb.fuseTicks / bomb.totalFuseTicks));
                spawnPinIcon(
                    bomb.dimension,
                    { x: curPos.x, y: curPos.y + 0.18, z: curPos.z },
                    Down,
                    PinOrigColor,
                    0.11 + 0.04 * progress,
                    1.0,
                    0.34 + 0.18 * progress
                );
            }

            if (!soundedGroups.has(bomb.soundGroup) && bomb.fuseTicks % 3 === 0) {
                soundedGroups.add(bomb.soundGroup);
                const progress = Math.max(0, Math.min(1, 1 - bomb.fuseTicks / bomb.totalFuseTicks));
                try {
                    bomb.dimension.playSound("note.hat", curPos, {
                        volume: 0.65,
                        pitch: 1.1 + progress * 0.8
                    });
                } catch { }
            }
        }
    }
}, 1);

world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!player?.isValid) return;
    activeBokuCasts.delete(player.id);
    finishBokuCast(player);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    activeClusters.delete(playerId);
    lastPinKnockbackTick.delete(playerId);
    activeBokuCasts.delete(playerId);
    lastKickCastTick.delete(playerId);
});
