import { world, system } from "@minecraft/server";
import { getSlotArmor } from './def';

const attackGenerations = new Map();
const damageHitListeners = new Set();

export function registerDamageHitListener(listener) {
    if (typeof listener === "function") {
        damageHitListeners.add(listener);
    }
}

function notifyDamageHitListeners(payload) {
    for (const listener of damageHitListeners) {
        try {
            listener(payload);
        } catch { }
    }
}
import { parseAttackModifiers, parseParticleParameter } from './modifiers';
import {
    getAttackerStatMultiplier,
    getDefStatReduction,
    getPenetrationFactor,
    getEffectiveDefReduction,
    rollDodge,
    rollCrit,
    getCritMultiplier
} from './rpgStats';
import { applyHeavyKnockback } from './physics';
import { applyDownslam } from './knockdown.js';
import { isTimeStopped, tsStopperIds } from '../utils/tsState.js';
import { recordDamageOverride } from './indicator.js';
import { getEnergy, setEnergy, useEnergy, addEnergy, setEnergyCooldown } from '../energy.js';
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from '../stands/tim/timHitboxState.js';
import { stopBlocking, breakGuard, isAttackInFront, getMemory, isParrying } from '../stands/basic_combat.js';
import { cancelTimeStopCharge } from '../stands/timestop/index.js';
import { cancelMandomWindup, isPlayerWindingMandom } from '../stands/mandom/mandom.js';
import { playBlockImpactVFX, playParryVFX } from '../stands/blocking/vfx.js';
import {
    Colors,
    spawnImpactRing,
    spawnGlowFlash,
    spawnStarburst,
    spawnPunchShockwave,
    spawnConeSparks,
    spawnBezierSlash,
    triggerImpactFrame
} from '../utils/vfx.js';

function getStandColor(caster) {
    try {
        const s = caster?.getProperty?.("property:stand") ?? 0;
        if (s === 1) return Colors.blue;
        if (s === 3) return Colors.pink;
        if (s === 2) return Colors.gold;
        if (s === 12) {
            const act = caster?.getProperty?.("property:act") ?? 0;
            if (act === 0 && caster?.hasTag?.("chargeM")) return Colors.cyan;
            return Colors.crimson;
        }
    } catch { }
    return Colors.hot;
}


const pendingHits = new Map();


function addPending(target, damage, dirX, dirZ) {

    const kbScale = damage * 0.2;

    const existing = pendingHits.get(target.id);
    if (existing) {
        existing.totalDamage += damage;
        existing.netX += dirX * kbScale;
        existing.netZ += dirZ * kbScale;
    } else {
        pendingHits.set(target.id, {
            entity: target,
            totalDamage: damage,
            netX: dirX * kbScale,
            netZ: dirZ * kbScale
        });
    }
}


export function flushPendingHits() {
    for (const [id, hit] of pendingHits) {
        const { entity, totalDamage, netX, netZ } = hit;
        if (!entity?.isValid) continue;

        const dim = entity.dimension;
        const loc = entity.location;
        const hitLoc = { x: loc.x, y: loc.y + 1.0, z: loc.z };

        try {
            entity.applyDamage(totalDamage, { cause: "override" });
        } catch (e) { }

        if (totalDamage > 0) {
            try {
                dim.playSound("random.explode", loc, { volume: 1.25, pitch: 0.95 });
                dim.playSound("xvoid.groundHit", loc, { volume: 1.0, pitch: 1.0 });
                dim.runCommand(`camerashake add @a[x=${loc.x.toFixed(1)},y=${loc.y.toFixed(1)},z=${loc.z.toFixed(1)},r=24] 0.35 0.2 positional`);
            } catch (e) { }

            try {
                dim.spawnParticle("minecraft:knockback_roar_particle", hitLoc);
                dim.spawnParticle("xvoid:blood", hitLoc);
                dim.spawnParticle("sfx:impact", loc);
                spawnImpactRing(dim, hitLoc, { x: 0, y: 1, z: 0 }, { radius: 2.8, time: 0.3, color: Colors.crimson, alpha: 0.95 });
                spawnStarburst(dim, hitLoc, { size: 2.5, life: 0.25 });
                spawnGlowFlash(dim, hitLoc, { size: 3.0, life: 0.3, color: Colors.hot, alpha: 0.85 });
                spawnPunchShockwave(dim, hitLoc, { x: 0, y: 1, z: 0 });
            } catch (e) { }
        }

        const vecLen = Math.sqrt(netX * netX + netZ * netZ);
        const cappedH = Math.min(vecLen, 10);
        const cappedV = Math.min(totalDamage * 0.02, 1.5);
        const nx = vecLen > 0.001 ? netX / vecLen : 0;
        const nz = vecLen > 0.001 ? netZ / vecLen : 0;

        const e = entity;
        system.run(() => {
            try {
                if (!e?.isValid) return;
                if (cappedH > 0.001) {
                    e.applyKnockback({ x: nx * cappedH, z: nz * cappedH }, cappedV);
                } else if (cappedV > 0) {
                    e.applyKnockback({ x: 0, z: 0 }, cappedV);
                }
            } catch (err) {
                console.warn(`[TS flush] applyKnockback failed: ${err}`);
            }
        });
    }
    pendingHits.clear();
}


export function accumulateVanillaHit(target, rawDamage, dirX, dirZ) {
    if (!target?.isValid) return;
    addPending(target, rawDamage / 2, dirX, dirZ);
}


function spawnParticleAtLocation(dimension, location, particleName, offsetObj) {
    try {
        const finalLocation = {
            x: location.x + offsetObj.x,
            y: location.y + offsetObj.y,
            z: location.z + offsetObj.z
        };
        dimension.spawnParticle(particleName, finalLocation);
    } catch (e) {
        console.warn(`Failed to spawn particle ${particleName}: ${e}`);
    }
}


function isInCustomBox(entityPos, playerPos, playerViewDir, offset, distance, height, width) {
    const dx = entityPos.x - playerPos.x;
    const dy = entityPos.y - playerPos.y;
    const dz = entityPos.z - playerPos.z;

    const viewLength = Math.sqrt(playerViewDir.x * playerViewDir.x + playerViewDir.y * playerViewDir.y + playerViewDir.z * playerViewDir.z);
    if (viewLength === 0) return false;

    const viewDirX = playerViewDir.x / viewLength;
    const viewDirY = playerViewDir.y / viewLength;
    const viewDirZ = playerViewDir.z / viewLength;

    const hLength = Math.sqrt(viewDirX * viewDirX + viewDirZ * viewDirZ);
    let hForwardX = viewDirX;
    let hForwardZ = viewDirZ;

    if (hLength > 0.001) {
        hForwardX /= hLength;
        hForwardZ /= hLength;
    } else {
        hForwardZ = -1;
        hForwardX = 0;
    }

    const forwardDist = dx * hForwardX + dz * hForwardZ;
    if (forwardDist < offset || forwardDist > offset + distance) return false;

    const rightX = -hForwardZ;
    const rightZ = hForwardX;
    const rightDist = Math.abs(dx * rightX + dz * rightZ);
    if (rightDist > width / 2) return false;

    const fullForwardDist = dx * viewDirX + dy * viewDirY + dz * viewDirZ;
    const perpX = dx - fullForwardDist * viewDirX;
    const perpY = dy - fullForwardDist * viewDirY;
    const perpZ = dz - fullForwardDist * viewDirZ;

    const rightComp = perpX * rightX + perpZ * rightZ;
    const vertPerpX = perpX - rightComp * rightX;
    const vertPerpY = perpY;
    const vertPerpZ = perpZ - rightComp * rightZ;

    const verticalPerpDist = Math.sqrt(vertPerpX * vertPerpX + vertPerpY * vertPerpY + vertPerpZ * vertPerpZ);
    if (verticalPerpDist > height / 2) return false;

    return true;
}


function applyDamageToTargets(caster, offset, distance, height, width, rawDamage, damageMultiplier = 1, particleInfo = null, modifiers = null, originPos = null, originViewDir = null, onlyTarget = null, hitOpts = null) {
    const casterId = caster.id;
    const casterPos = originPos || caster.location;
    let casterViewDir = originViewDir;

    if (!casterViewDir) {
        try {
            casterViewDir = caster.getViewDirection();
        } catch (e) {
            casterViewDir = { x: 0, y: 0, z: -1 };
        }
    }

    const dimension = caster.dimension || world.getDimension("minecraft:overworld");

    const searchRadius = Math.sqrt((offset + distance) * (offset + distance) + (width / 2) * (width / 2) + height * height) + 2;

    const excludeTypes = [
        "armor_stand", "thrown_trident", "arrow", "area_effect_cloud", "minecart", "chest_minecart", "command_block_minecart", "dragon_fireball", "egg", "snowball", "ender_crystal", "ender_pearl", "evocation_fang", "falling_block", "fireball", "fireworks_rocket", "fishing_hook", "leash_knot", "lightning_bolt", "lingering_potion", "llama_spit", "item", "minecraft:item", "xp_orb", "minecraft:xp_orb", "xp_bottle", "experience_bottle"
    ];
    const excludeFamilies = ["damage", "atk", "inanimate"];


    const targets = onlyTarget ? [onlyTarget] : dimension.getEntities({
        location: casterPos,
        maxDistance: searchRadius,
        excludeTypes,
        excludeFamilies
    });

    const undeadTargets = onlyTarget ? (onlyTarget.matches({ families: ["undead"] }) ? [onlyTarget] : []) : dimension.getEntities({
        location: casterPos,
        maxDistance: searchRadius,
        families: ["undead"],
        excludeTypes,
        excludeFamilies
    });

    const arthropodTargets = onlyTarget ? (onlyTarget.matches({ families: ["arthropod"] }) ? [onlyTarget] : []) : dimension.getEntities({
        location: casterPos,
        maxDistance: searchRadius,
        families: ["arthropod"],
        excludeTypes,
        excludeFamilies
    });

    const undeadIds = new Set(undeadTargets.map(t => t.id));
    const arthropodIds = new Set(arthropodTargets.map(t => t.id));

    const isDownSlam = Boolean(
        !onlyTarget &&
        (caster?.hasTag?.("high") || modifiers?.downslam || (modifiers?.staggerType === "barrage" && modifiers.barrageDown >= 3))
    );
    let hitAnyTarget = false;
    const resolvedHits = new Set();

    targets.forEach(rawTarget => {
        if (!rawTarget?.isValid) return;
        const isProxy = rawTarget.typeId === TimHitboxType;
        if (isProxy && isOwnTimHitbox(casterId, rawTarget)) return;
        const target = isProxy ? getTimHitboxOwner(rawTarget) : rawTarget;
        if (!target?.isValid || (!hitOpts?.allowSelfDamage && target.id === casterId)) return;
        if (target.hasTag("tusk_rotation")) return;

        if (!onlyTarget && !isInCustomBox(rawTarget.location, casterPos, casterViewDir, offset, distance, height, width)) return;
        if (resolvedHits.has(target.id)) return;
        resolvedHits.add(target.id);
        hitAnyTarget = true;


        if (rollDodge(target)) {
            try {
                dimension.spawnParticle("ds:parry2", target.location);
            } catch (e) { }
            return;
        }

        if (isDownSlam) {
            try { caster.addTag("foundTarget"); } catch (e) { }
        }


        let strengthLevel = 0;
        try {
            strengthLevel = caster.getEffects().find(e => e.typeId === "strength")?.amplifier || 0;
        } catch (e) { }


        let weaknessLevel = 0;
        try {
            weaknessLevel = caster.getEffects().find(e => e.typeId === "weakness")?.amplifier || 0;
        } catch (e) { }


        let itemStack = null;
        try {
            const inventory = caster.getComponent("minecraft:inventory");
            const container = inventory?.container;
            itemStack = container?.getItem(caster.selectedSlotIndex);
        } catch (e) { }
        let sharpnessLevel = 0;
        let smiteLevel = 0;
        let baneLevel = 0;
        const typeId = itemStack?.typeId || "";
        if (itemStack) {
            const enchComponent = itemStack.getComponent("minecraft:enchantable");
            if (enchComponent) {
                sharpnessLevel = enchComponent.getEnchantment("sharpness")?.level || 0;
                smiteLevel = enchComponent.getEnchantment("smite")?.level || 0;
                baneLevel = enchComponent.getEnchantment("bane_of_arthropods")?.level || 0;
            }
            console.log(`Attacking with ${typeId}, Sharpness: ${sharpnessLevel}, Smite: ${smiteLevel}, Bane: ${baneLevel}`);
        }

        let strengthFactor = Math.pow(1.3, strengthLevel);
        let strengthBonus = (rawDamage + (strengthFactor - 1) / 0.3) - rawDamage;


        const weaknessFactor = Math.pow(0.8, weaknessLevel);
        let damageAfterWeakness = (rawDamage + strengthBonus) * weaknessFactor + (weaknessFactor - 1) / 0.4;
        damageAfterWeakness = Math.max(0, damageAfterWeakness);


        const enchantmentBonus = (typeId ? 1.5 * sharpnessLevel : 0) +
            (undeadIds.has(target.id) ? 2.5 * smiteLevel : 0) +
            (arthropodIds.has(target.id) ? 2.5 * baneLevel : 0);


        let finalDamage = (damageAfterWeakness + enchantmentBonus) * damageMultiplier;

        finalDamage *= getAttackerStatMultiplier(caster);


        if (target.hasTag("ataxia")) {
            try {
                const vd = target.getViewDirection();
                const vLen = Math.hypot(vd.x, vd.z) || 1;
                const leftX = vd.z / vLen, leftZ = -vd.x / vLen;
                const dx = casterPos.x - target.location.x, dz = casterPos.z - target.location.z;
                const dLen = Math.hypot(dx, dz) || 1;
                if ((leftX * (dx / dLen) + leftZ * (dz / dLen)) > 0.15) {
                    finalDamage *= 1.35;
                }
            } catch { }
        }

        const isCrit = rollCrit(caster, target);
        if (isCrit) {
            finalDamage *= getCritMultiplier(caster);
            try {
                dimension.spawnParticle("xvoid:blood", target.location);
            } catch (e) { }
        }


        let blocked = false;
        let guardBroken = false;
        let exhaustionPunished = false;


        if (target.hasTag("century_active")) {
            finalDamage = 0;
            blocked = true;
            try {
                const loc = target.location;
                const hitLoc = { x: loc.x, y: loc.y + 1, z: loc.z };
                target.dimension.spawnParticle("xvoid:parry_sparks", hitLoc);
                spawnImpactRing(target.dimension, hitLoc, casterViewDir, { radius: 1.9, time: 0.24, color: Colors.gold, alpha: 0.85 });
                spawnStarburst(target.dimension, hitLoc, { size: 1.5, life: 0.2 });
                target.dimension.playSound("random.anvil_land", loc, { volume: 0.5, pitch: 1.8 });
            } catch { }
        }

        const attackInFront = hitOpts?.unblockable
            ? false
            : (hitOpts?.alwaysInFront
                ? true
                : (hitOpts?.checkPosFromOrigin && originPos
                    ? (() => {
                        try {
                            const tv = target.getViewDirection();
                            const tl = Math.hypot(tv.x, tv.z) || 1;
                            const dx = originPos.x - target.location.x;
                            const dz = originPos.z - target.location.z;
                            const dl = Math.hypot(dx, dz) || 1;
                            return ((tv.x / tl) * (dx / dl) + (tv.z / tl) * (dz / dl)) > -0.2;
                        } catch {
                            return isAttackInFront(target, caster);
                        }
                    })()
                    : isAttackInFront(target, caster)));


        if (!blocked && !hitOpts?.noParry && attackInFront && isParrying(target) && finalDamage > 0) {
            const returnedDamage = finalDamage * 1.5;
            finalDamage = 0;
            blocked = true;
            try {
                target.removeTag("parry");
                const mem = getMemory(target.id);
                if (mem) mem.blockTicks = Math.max(mem.blockTicks, 11);
                addEnergy(target, 25);
                setEnergyCooldown(target, 0);

                const loc = target.location;
                const hitLoc = { x: loc.x, y: loc.y + 1.0, z: loc.z };


                playParryVFX(target, casterViewDir, hitLoc);


                if (caster?.isValid && !caster.hasTag("uncancelable")) {
                    stopPlayerDamage(caster.id);
                    try {
                        caster.runCommand("scriptevent xvoid:damage stop");
                        caster.removeTag("onSkill");
                        caster.removeTag("chargeT");
                        caster.removeTag("chargeM");
                        const stunObj = world.scoreboard.getObjective("stun");
                        if (stunObj) stunObj.setScore(caster, 28);
                        caster.applyKnockback({ x: -casterViewDir.x * 1.5, z: -casterViewDir.z * 1.5 }, 0.25);
                        caster.applyDamage(returnedDamage, {
                            cause: "override",
                            damagingEntity: target
                        });
                    } catch { }
                }
            } catch { }
        }


        if (!blocked && target.hasTag("blocking") && finalDamage > 0) {
            if (attackInFront) {
                const isHeavyBreak = Boolean(
                    modifiers && !modifiers.blockable && (
                        modifiers.downslam ||
                        (modifiers.heavy && (modifiers.heavyBack ?? 0) >= 8)
                    )
                );
                if (isHeavyBreak) {


                    guardBroken = true;
                    finalDamage *= 1.5;
                    breakGuard(target, "heavy");
                } else {

                    blocked = true;
                    const blockedDamage = finalDamage * 0.9;
                    finalDamage *= 0.1;


                    const maxHp = target.getComponent("minecraft:health")?.effectiveMax || 20;
                    const energyChipped = (blockedDamage * 0.5 / maxHp) * 100;

                    const currentEnergy = getEnergy(target);
                    const nextEnergy = Math.max(0, currentEnergy - energyChipped);
                    setEnergy(target, nextEnergy);

                    const blockInObj = world.scoreboard.getObjective("blockIn");
                    if (blockInObj) {
                        try { blockInObj.setScore(target, Math.ceil(blockedDamage)); } catch (e) { }
                    }
                    try { target.runCommand("scriptevent xvoid:block"); } catch (e) { }


                    try {
                        const hitLoc = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
                        playBlockImpactVFX(target, casterViewDir, hitLoc);
                    } catch { }


                    if (nextEnergy <= 0) {
                        breakGuard(target, "energy");
                    }
                }
            }


        }


        if (!blocked && (target.hasTag("ts_exhausted") || isPlayerWindingMandom(target)) && finalDamage > 0) {
            finalDamage *= 1.5;
            exhaustionPunished = true;
            try {
                if (target.hasTag("ts_exhausted")) cancelTimeStopCharge(target, true);
                if (isPlayerWindingMandom(target)) cancelMandomWindup(target, true);
                target.removeTag("ts_exhausted");
                const hitLoc = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
                target.dimension.spawnParticle("xvoid:blood", hitLoc);
                target.dimension.spawnParticle("sfx:impact", target.location);
                spawnImpactRing(target.dimension, hitLoc, casterViewDir, { radius: 2.8, time: 0.3, color: Colors.crimson, alpha: 0.95 });
                spawnStarburst(target.dimension, hitLoc, { size: 2.2, life: 0.24 });
                target.dimension.playSound("random.break", target.location, { volume: 1.2, pitch: 0.75 });
                target.dimension.playSound("xvoid.hit_M", target.location, { volume: 1.0, pitch: 0.85 });
            } catch { }
        }


        const headArmor = getSlotArmor(target, "Head");
        const chestArmor = getSlotArmor(target, "Chest");
        const legsArmor = getSlotArmor(target, "Legs");
        const feetArmor = getSlotArmor(target, "Feet");

        const totalDefense = headArmor.defense + chestArmor.defense + legsArmor.defense + feetArmor.defense;
        const totalToughness = headArmor.toughness + chestArmor.toughness + legsArmor.toughness + feetArmor.toughness;

        const reduction = totalDefense > 0
            ? Math.min(20, Math.max(totalDefense / 5, totalDefense - finalDamage / (2 + totalToughness / 4))) / 25
            : 0;
        let damageTaken = finalDamage * (1 - reduction);

        const resistanceLevel = target.getEffects().find(e => e.typeId === "resistance")?.amplifier || 0;
        damageTaken *= (1 - 0.2 * Math.min(5, resistanceLevel));

        damageTaken *= (1 - getEffectiveDefReduction(caster, target));

        const isTuskSpatial = target.hasTag("tusk_spatial") || target.hasTag("tim_unravel");
        const isTuskDetached = !isTuskSpatial && target.hasTag("tusk_detached");
        if (isTuskSpatial) {
            damageTaken *= 0.25;
        } else if (isTuskDetached) {
            damageTaken *= 0.5;
        }

        if (damageTaken > 0 || !blocked) {


            if (!blocked && !hitOpts?.noEnergyGain && caster?.typeId === "minecraft:player" && target.id !== casterId && (!modifiers || (modifiers.hit ?? 1) <= 1)) {
                try {
                    const mem = getMemory(caster.id);
                    const recentlyDashed = mem && (system.currentTick - (mem.lastDashTick ?? -9999)) <= 60;
                    if (recentlyDashed) {
                        useEnergy(caster, 1, 15);
                    } else {
                        addEnergy(caster, 1);
                    }
                } catch { }
            }

            if (isTimeStopped() && !tsStopperIds.has(target.id)) {

                let dx = target.location.x - casterPos.x;
                let dz = target.location.z - casterPos.z;
                const dLen = Math.sqrt(dx * dx + dz * dz);
                if (dLen > 0) { dx /= dLen; dz /= dLen; }

                addPending(target, damageTaken, dx, dz);
            } else {


                const applyOptions = {
                    cause: "override",
                    ...(blocked ? {} : (caster?.isValid ? { damagingEntity: caster } : {}))
                };

                if (damageTaken < 1 && target.typeId === "minecraft:player") {
                    try {
                        const healthComp = target.getComponent("minecraft:health");
                        if (healthComp) {
                            const overage = 1 - damageTaken;
                            healthComp.setCurrentValue(Math.min(healthComp.effectiveMax, healthComp.currentValue + overage));
                        }
                    } catch (e) { }

                    recordDamageOverride(target, damageTaken);
                    target.applyDamage(1, applyOptions);
                } else {
                    target.applyDamage(damageTaken, applyOptions);
                }

                if (blocked) {
                    try { target.clearVelocity(); } catch { }
                }
            }

            if (!hitOpts?.skipPinPassive) {
                notifyDamageHitListeners({
                    caster,
                    target,
                    rawDamage,
                    damageTaken,
                    blocked,
                    guardBroken,
                    isMelee: !onlyTarget || Boolean(hitOpts?.melee),
                    isStrongKnockback: Boolean(
                        modifiers && (modifiers.downslam || (modifiers.heavy && (modifiers.heavyBack ?? 0) >= 6))
                    ),
                    hitOpts
                });
            }
        }

        if (!blocked && !isTimeStopped() && !isTuskSpatial && !isTuskDetached) {
            const stunTicks = hitOpts?.noStun ? 0 : (guardBroken ? 20 : exhaustionPunished ? 35 : 3);
            if (stunTicks > 0) {
                try {
                    const stunObj = world.scoreboard.getObjective("stun");
                    if (stunObj) {
                        const existingStun = stunObj.getScore(target) ?? 0;
                        stunObj.setScore(target, Math.max(existingStun, stunTicks));
                    }
                } catch (e) { }
            }

            if (guardBroken || exhaustionPunished) {
                try {
                    target.teleport(target.location);
                } catch (e) { }
            } else if (modifiers && modifiers.staggerType === "stagger") {
                try {
                    target.teleport(target.location);
                } catch (e) {
                    console.warn(`Failed to apply stagger to target: ${e}`);
                }
            } else if (modifiers && modifiers.staggerType === "barrage") {
                try {
                    let dirX = 0, dirZ = -1;
                    try {
                        const rot = caster.getRotation();
                        const yawRad = (rot.y + 90) * (Math.PI / 180);
                        dirX = Math.cos(yawRad);
                        dirZ = Math.sin(yawRad);
                    } catch (e) { }

                    const pushDist = modifiers.barragePush;
                    const downDist = modifiers.barrageDown;


                    const horizontalForce = pushDist * 0.25;
                    const verticalForce = -downDist * 0.3;

                    try {
                        target.applyKnockback(
                            { x: dirX * horizontalForce, z: dirZ * horizontalForce },
                            verticalForce
                        );
                    } catch (e) {
                        if (e.name !== "InvalidEntityError" && !e.message.includes("not a function")) {
                            console.warn(`Failed to apply barrage knockback: ${e}`);
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to apply barrage to target: ${e}`);
                }
            } else if (modifiers && modifiers.downslam) {
                try {
                    applyDownslam(target, caster, {
                        durationTicks: modifiers.downslamTicks,
                        push: modifiers.downslamPush,
                        craterWave: false,
                        bonusDamage: 3.5
                    });
                } catch (e) { }
            } else if (modifiers && modifiers.heavy) {
                try {
                    let viewDir = { x: 0, y: 0, z: -1 };
                    try { viewDir = caster.getViewDirection(); } catch (e) { }
                    applyHeavyKnockback(target, viewDir, modifiers.heavyBack, modifiers.heavyUp);

                } catch (e) { }
            }
        }


        if (particleInfo && particleInfo.name) {
            try {
                spawnParticleAtLocation(dimension, isProxy && rawTarget?.isValid ? rawTarget.location : target.location, particleInfo.name, particleInfo.offset);
            } catch (e) {
                if (e.name !== "InvalidEntityError" && !e.message.includes("not a function")) {
                    console.warn(`Failed to spawn particle at target location: ${e}`);
                }
            }
        }


        if (!onlyTarget && !blocked) {
            try {
                const vfxBase = isProxy && rawTarget?.isValid ? rawTarget.location : target.location;
                const hitLoc = {
                    x: vfxBase.x + (particleInfo?.offset?.x ?? 0),
                    y: vfxBase.y + (particleInfo?.offset?.y ?? (isProxy ? 0.2 : 1.0)),
                    z: vfxBase.z + (particleInfo?.offset?.z ?? 0)
                };
                const standColor = getStandColor(caster);
                const isHeavy = Boolean(modifiers?.heavy && (modifiers.heavyBack >= 6 || rawDamage >= 12));
                const standId = caster?.getProperty?.("property:stand") ?? 0;

                spawnStarburst(dimension, hitLoc, {
                    size: isHeavy ? 2.2 : 1.25,
                    life: isHeavy ? 0.28 : 0.18
                });
                spawnGlowFlash(dimension, hitLoc, {
                    size: isHeavy ? 3.0 : 1.7,
                    life: isHeavy ? 0.34 : 0.22,
                    color: standColor,
                    alpha: isHeavy ? 0.75 : 0.55
                });
                spawnImpactRing(dimension, hitLoc, casterViewDir, {
                    radius: isHeavy ? 3.4 : 1.85,
                    time: isHeavy ? 0.32 : 0.22,
                    color: standColor,
                    alpha: isHeavy ? 0.88 : 0.72,
                    soft: false
                });

                if (standId === 12 || (particleInfo?.name && /slash|sm:/i.test(particleInfo.name))) {
                    spawnBezierSlash(dimension, hitLoc, casterViewDir, {
                        color: standColor,
                        reach: 1.6,
                        span: 1.35,
                        width: 0.24
                    });
                }

                if (isHeavy) {
                    spawnPunchShockwave(dimension, hitLoc, casterViewDir);
                    spawnConeSparks(dimension, hitLoc, casterViewDir);
                    spawnImpactRing(dimension, hitLoc, casterViewDir, {
                        radius: 4.5,
                        time: 0.42,
                        color: Colors.white,
                        alpha: 0.6,
                        soft: true
                    });
                    if (rawDamage >= 14) {
                        triggerImpactFrame(dimension, hitLoc, 2);
                    }
                }
            } catch { }
        }
    });
}

function applyDamageFromCaster(caster, offset, distance, height, width, rawDamage, damageMultiplier = 1, particleInfo = null, modifiers = null, originPos = null, originViewDir = null) {
    applyDamageToTargets(caster, offset, distance, height, width, rawDamage, damageMultiplier, particleInfo, modifiers, originPos, originViewDir);
}


export function applyHitscanDamage(caster, target, rawDamage, opts = null) {
    const resolvedTarget = target?.typeId === TimHitboxType ? getTimHitboxOwner(target) : target;
    if (!resolvedTarget?.isValid) return;
    applyDamageToTargets(
        caster, 0, 0, 0, 0, rawDamage, 1, null,
        opts?.modifiers || null,
        opts?.originPos || null,
        opts?.originViewDir || null,
        resolvedTarget,
        opts
    );
}

export function stopPlayerDamage(playerId) {
    if (!playerId) return;
    attackGenerations.set(playerId, (attackGenerations.get(playerId) || 0) + 1);
}

export function triggerDamage(player, message) {
    if (!player) {
        console.warn("xvoid:damage event triggered but no source entity");
        return;
    }

    const playerId = player.id;
    const msgStr = Array.isArray(message) ? message.join(" ") : String(message ?? "");

    if (msgStr.toLowerCase() === "stop") {
        stopPlayerDamage(playerId);
        return;
    }


    const args = msgStr.split(' ');
    if (args.length < 3) return;

    const offsetArg = parseFloat(args[0]);
    if (Number.isNaN(offsetArg)) return;

    const boxArg = args[1];
    const damageArg = args[2];
    const modifierArgs = args.slice(3);


    const boxParts = boxArg.split('/');
    let distance, height, width;

    if (boxParts.length === 1) {
        const dist = parseFloat(boxParts[0]);
        if (Number.isNaN(dist)) return;
        distance = dist;
        height = dist;
        width = dist;
    } else if (boxParts.length === 2) {
        distance = parseFloat(boxParts[0]);
        const both = parseFloat(boxParts[1]);
        if (Number.isNaN(distance) || Number.isNaN(both)) return;
        height = both;
        width = both;
    } else if (boxParts.length === 3) {
        distance = parseFloat(boxParts[0]);
        height = parseFloat(boxParts[1]);
        width = parseFloat(boxParts[2]);
        if (Number.isNaN(distance) || Number.isNaN(height) || Number.isNaN(width)) return;
    } else {
        return;
    }

    const modifiers = parseAttackModifiers(modifierArgs);

    let particleInfo = null;
    let playerViewDir = { x: 0, y: 0, z: -1 };
    try {
        playerViewDir = player.getViewDirection();
    } catch (e) { }
    particleInfo = parseParticleParameter(args, playerViewDir);

    const currentGeneration = attackGenerations.get(playerId) || 0;


    const originPos = modifiers.stay ? { x: player.location.x, y: player.location.y, z: player.location.z } : null;
    const originViewDir = modifiers.stay ? { x: playerViewDir.x, y: playerViewDir.y, z: playerViewDir.z } : null;

    let baseDamage = parseFloat(damageArg);
    if (Number.isNaN(baseDamage)) baseDamage = 0;
    let damageMultiplier = 1;


    const executeAttack = () => {
        if ((attackGenerations.get(playerId) || 0) !== currentGeneration) return;

        let totalTimeouts = 0;

        if (modifiers.hitCount !== null) {
            totalTimeouts = modifiers.hitCount;
            for (let i = 0; i < modifiers.hitCount; i++) {
                const delay = 1 + i * modifiers.intervalTicks;
                let currentModifiers = { ...modifiers };
                if (modifiers.stagger) currentModifiers.staggerType = "stagger";
                else if (modifiers.barrage) currentModifiers.staggerType = "barrage";
                else currentModifiers.staggerType = false;

                system.runTimeout(() => {
                    if ((attackGenerations.get(playerId) || 0) === currentGeneration) {
                        applyDamageFromCaster(player, offsetArg, distance, height, width, baseDamage, damageMultiplier, particleInfo, currentModifiers, originPos, originViewDir);
                    }
                }, delay);
            }
        } else if (modifiers.durationSeconds !== null) {
            const totalTicks = Math.max(1, Math.floor(modifiers.durationSeconds * 20));
            const intervalTicks = Math.max(1, modifiers.intervalTicks);
            const hitCount = Math.ceil(totalTicks / intervalTicks);
            totalTimeouts = hitCount;

            for (let i = 0; i < hitCount; i++) {
                const delay = 1 + i * intervalTicks;
                let currentModifiers = { ...modifiers };
                if (modifiers.stagger) currentModifiers.staggerType = "stagger";
                else if (modifiers.barrage) currentModifiers.staggerType = "barrage";
                else currentModifiers.staggerType = false;

                system.runTimeout(() => {
                    if ((attackGenerations.get(playerId) || 0) === currentGeneration) {
                        applyDamageFromCaster(player, offsetArg, distance, height, width, baseDamage, damageMultiplier, particleInfo, currentModifiers, originPos, originViewDir);
                    }
                }, delay);
            }
        } else {
            let currentModifiers = { ...modifiers };
            if (modifiers.stagger) currentModifiers.staggerType = "stagger";
            else if (modifiers.barrage) currentModifiers.staggerType = "barrage";
            else currentModifiers.staggerType = false;

            applyDamageFromCaster(player, offsetArg, distance, height, width, baseDamage, damageMultiplier, particleInfo, currentModifiers, originPos, originViewDir);
        }


    };

    if (modifiers.delayTicks > 0) {
        system.runTimeout(executeAttack, modifiers.delayTicks);
    } else {
        executeAttack();
    }
}

system.afterEvents.scriptEventReceive.subscribe(data => {
    if (data.id === "xvoid:damage") {
        triggerDamage(data.sourceEntity, data.message);
    }
});
