import { world, system } from "@minecraft/server";
import "./Vec3";
import "./use";
import "./damage/damage.js";
import "./damage/knockdown.js";
import "./damage/def.js";
import "./damage/indicator.js";
import "./utils/ts";
import "./stands/basic_combat";
import "./stands/twau/twau.js";
import { cancelTimeStopCharge } from "./stands/timestop/index.js";
import "./energy";
import "./utils/gun";
import "./stands/mandom/reverse.js";
import { cancelMandomWindup, isPlayerWindingMandom } from "./stands/mandom/mandom.js";
import "./stands/tim/tim.js";
import "./stands/century/century.js";
import "./stands/boku/boku.js";
import "./stands/sm/sm.js";
import "./stands/special/spin.js";
import "./stands/special/wrecking_ball.js";
import "./stands/tusk/tusk.js";
import "./stands/tusk/wheel.js";
import "./stands/tusk/bleed.js";
import "./stands/tusk/nail_shot.js";
import "./stands/tusk/abilities.js";
import "./stands/colorway_ui.js";
import "./stands/player_menu_ui.js";
import "./items/progression_items.js";
import "./utils/DCA.js";
import { triggerBlockWave, triggerWaveShards, trackDownSlamLanding, triggerImpactFrame, Colors, spawnImpactRing, spawnStarburst } from "./utils/vfx.js";
import { playBlockImpactVFX, playParryVFX } from "./stands/blocking/vfx.js";
import { getEnergy, setEnergy, addEnergy, setEnergyCooldown } from "./energy.js";
import { stopBlocking, breakGuard, isAttackInFront, getMemory, isParrying } from "./stands/basic_combat.js";
import { calculateArmorReduction } from "./damage/def.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "./stands/tim/timHitboxState.js";

const ArmorSlots = ["Head", "Chest", "Legs", "Feet"];
const NetheriteArmorBonus = -0.1;

function parseBlockWaveArgs(message) {
    const parts = (message ?? "").trim().split(/\s+/).filter(Boolean);
    const isLanding = parts[0] === "landing";
    const numArgs = isLanding ? parts.slice(1) : parts;

    const spreadVal = numArgs.length > 0 ? parseFloat(numArgs[0]) : NaN;
    const jumpVal = numArgs.length > 1 ? parseFloat(numArgs[1]) : NaN;

    const options = {};
    if (!Number.isNaN(spreadVal) && spreadVal > 0) options.spread = spreadVal;
    if (!Number.isNaN(jumpVal)) options.jump = Math.max(0, Math.min(1, jumpVal));

    return { isLanding, options };
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    const { id, message } = event;

    let player = event.sourceEntity ?? event.initiator;
    if (!player) {
        const allPlayers = world.getAllPlayers();
        if (allPlayers.length === 1) {
            player = allPlayers[0];
        }
    }

    if (id === "xvoid:blockwave" || id === "xvoid:block_wave") {
        const { isLanding, options } = parseBlockWaveArgs(message);
        if (isLanding) {
            if (player?.isValid) trackDownSlamLanding(player, false, options);
            return;
        }
        const source = player?.isValid ? player : (event.sourceBlock?.isValid ? event.sourceBlock : null);
        if (source) {
            triggerBlockWave(source.dimension, source.location, options);
        }
        return;
    }

    if (id === "xvoid:waveshard") {
        const raw = parseFloat((message ?? "").trim().split(/\s+/)[0]);
        const options = Number.isNaN(raw) ? {} : { intensity: raw };
        const source = player?.isValid ? player : (event.sourceBlock?.isValid ? event.sourceBlock : null);
        if (source) {
            triggerWaveShards(source.dimension, source.location, options);
        }
        return;
    }

    if (!player?.isValid) return;

    switch (id) {

        case "apply:knockback":
            applyKnockbackFromScriptEvent(player, message);
            break;

        case "xvoid:impact_frame": {
            const ticks = parseInt(message.trim()) || 2;
            triggerImpactFrame(player.dimension, player.location, ticks);
            break;
        }

    }
});

function getArmorMultiplier(player) {
    if (player.typeId !== "minecraft:player") return 1;
    try {
        const equippable = player.getComponent("minecraft:equippable") ?? player.getComponent("equippable");
        if (!equippable) return 1;
        return ArmorSlots.reduce((mult, slot) => {
            const eq = equippable.getEquipmentSlot ? equippable.getEquipmentSlot(slot) : null;
            const item = eq ? eq.getItem?.() : (equippable.getEquipment ? equippable.getEquipment(slot) : null);
            return item && item.typeId && item.typeId.includes("netherite") ? mult + NetheriteArmorBonus : mult;
        }, 1);
    } catch {
        return 1;
    }
}

function applyKnockbackFromScriptEvent(entity, msg) {
    if (!entity?.isValid || entity.hasTag("tusk_detached") || entity.hasTag("tusk_spatial") || entity.hasTag("tim_unravel")) return;

    const viewDir = entity.getViewDirection();
    const multiplier = getArmorMultiplier(entity);

    let x = viewDir.x, z = viewDir.z;
    let horizontal = 0, vertical = 0;

    if (msg.startsWith("left =>") || msg.startsWith("right =>")) {
        const [dir, values] = msg.split("=>").map(s => s.trim());
        [horizontal, vertical] = values.split(",").map(Number);
        if (dir === "right") { x = -viewDir.z; z = viewDir.x; }
        else if (dir === "left") { x = viewDir.z; z = -viewDir.x; }
    } else {
        [horizontal, vertical] = msg.split(",").map(Number);
    }

    if (isNaN(horizontal)) horizontal = 0;
    if (isNaN(vertical)) vertical = 0;

    try {
        entity.applyKnockback(
            { x: x * horizontal * multiplier, z: z * horizontal * multiplier },
            vertical * multiplier
        );
    } catch { }
}

let kbResetDone = false;
system.runInterval(() => {
    if (!kbResetDone) {
        const players = world.getAllPlayers();
        if (players.length > 0) {
            kbResetDone = true;
            for (const p of players) {
                try { p.triggerEvent("xvoid:remove_damage_blocking"); } catch { }
                try { p.triggerEvent("xvoid:jatuh"); } catch { }
            }
        }
    }

    const objective = world.scoreboard.getObjective("standC");
    if (!objective) return;
    const actObjective = world.scoreboard.getObjective("act");
    const m1Objective = world.scoreboard.getObjective("m1");

    for (const player of world.getAllPlayers()) {
        let score = 0;
        try {
            score = objective.getScore(player);
        } catch { }
        player.setProperty("property:stand", score ?? 0);

        let actScore = 0;
        try {
            actScore = actObjective?.getScore(player) ?? 0;
        } catch { }
        const clampedAct = Math.max(0, Math.min(100, actScore | 0));
        try {
            if (player.getProperty("property:act") !== clampedAct) {
                player.setProperty("property:act", clampedAct);
            }
        } catch { }

        let m1Score = 0;
        try {
            m1Score = m1Objective?.getScore(player) ?? 0;
        } catch { }
        const inCombatAnim =
            m1Score > 0 ||
            player.hasTag("onSkill") ||
            player.hasTag("low") ||
            player.hasTag("high") ||
            player.hasTag("chargeT") ||
            player.hasTag("chargeM");
        try {
            const clampedM1 = inCombatAnim ? Math.max(1, Math.min(100, m1Score | 0)) : 0;
            if (player.getProperty("property:m1") !== clampedM1) {
                player.setProperty("property:m1", clampedM1);
            }
            const isRainbow = player.hasTag("rainbowStand") ? 1 : 0;
            if (player.getProperty("property:stand_rainbow") !== isRainbow) {
                player.setProperty("property:stand_rainbow", isRainbow);
            }
        } catch { }
    }
}, 1);


world.afterEvents.playerSpawn.subscribe(({ player }) => {
    try {
        player.runCommand("event entity @s xvoid:remove_damage_blocking");
    } catch (e) { }
    try { player.removeTag("parry"); } catch (e) { }
    try { player.removeTag("blocking"); } catch (e) { }
    try { player.removeTag("ultimate"); } catch (e) { }
    try { player.removeTag("tim_grapple"); } catch (e) { }
    try { player.triggerEvent("xvoid:kb_normal"); } catch (e) { }
    try { player.triggerEvent("xvoid:hitbox_normal"); } catch (e) { }
    for (const prop of ["property:tim_limb", "property:tim_detach", "property:stand_preview", "property:ts_fx", "property:boku_smoke"]) {
        try { player.setProperty(prop, 0); } catch (e) { }
    }
});

world.beforeEvents.entityHurt.subscribe((event) => {

    if (event.damageSource.cause === "override") return;


    if (event.hurtEntity?.typeId === TimHitboxType) {
        event.cancel = true;
        const owner = getTimHitboxOwner(event.hurtEntity);
        const srcEntity = event.damageSource.damagingEntity;
        if (srcEntity) {
            try {
                const held = srcEntity.getComponent("equippable")?.getEquipment("Mainhand");
                if (held?.typeId === "jjba:stand" || held?.typeId === "jjba:stand2") return;
            } catch { }
        }
        if (owner?.isValid && srcEntity?.id !== owner.id && event.damage > 0) {
            const rawDmg = event.damage;
            system.run(() => {
                if (!owner?.isValid) return;
                const mult = owner.hasTag("tim_unravel") ? 0.25 : 1.0;
                let scaledDmg = rawDmg * mult;
                const armorRed = calculateArmorReduction(owner, scaledDmg);
                scaledDmg *= (1 - armorRed);
                const resLevel = owner.getEffects?.()?.find(e => e.typeId === "resistance")?.amplifier || 0;
                scaledDmg *= (1 - 0.2 * Math.min(5, resLevel));
                try {
                    if (scaledDmg > 0) {
                        owner.applyDamage(scaledDmg, {
                            cause: "override",
                            damagingEntity: srcEntity?.isValid ? srcEntity : undefined
                        });
                    }
                    owner.clearVelocity();
                } catch { }
            });
        }
        return;
    }

    if (event.hurtEntity?.hasTag("century_active")) {
        event.cancel = true;
        try {
            const loc = event.hurtEntity.location;
            event.hurtEntity.dimension.spawnParticle("xvoid:parry_sparks", { x: loc.x, y: loc.y + 1, z: loc.z });
            event.hurtEntity.dimension.playSound("random.anvil_land", loc, { volume: 0.5, pitch: 1.8 });
        } catch { }
        return;
    }


    if (event.hurtEntity?.typeId === "minecraft:player" && (event.hurtEntity.hasTag("tusk_spatial") || event.hurtEntity.hasTag("tusk_detached") || event.hurtEntity.hasTag("tim_unravel"))) {
        const defenderTusk = event.hurtEntity;
        const attackerTusk = event.damageSource.damagingEntity;
        const rawDmg = event.damage;
        if (rawDmg > 0) {
            const mult = (defenderTusk.hasTag("tusk_spatial") || defenderTusk.hasTag("tim_unravel")) ? 0.25 : 0.5;
            let scaledDmg = rawDmg * mult;
            const armorRed = calculateArmorReduction(defenderTusk, scaledDmg);
            scaledDmg *= (1 - armorRed);
            const resLevel = defenderTusk.getEffects?.()?.find(e => e.typeId === "resistance")?.amplifier || 0;
            scaledDmg *= (1 - 0.2 * Math.min(5, resLevel));
            event.cancel = true;
            system.run(() => {
                if (!defenderTusk?.isValid) return;
                try {
                    if (scaledDmg > 0) {
                        defenderTusk.applyDamage(scaledDmg, {
                            cause: "override",
                            damagingEntity: attackerTusk?.isValid ? attackerTusk : undefined
                        });
                    }
                    defenderTusk.clearVelocity();
                } catch { }
            });
            return;
        }
    }

    const defender = event.hurtEntity;
    const attacker = event.damageSource.damagingEntity;
    const projectile = event.damageSource.damagingProjectile;

    if (attacker) {
        const held = attacker.getComponent("equippable")?.getEquipment("Mainhand");
        if (held) {
            const id = held.typeId;
            if (id === "jjba:stand" || id === "jjba:stand2") {
                event.cancel = true;
                return;
            }
        }
    }


    if (defender?.typeId === "minecraft:player" && (defender.hasTag("ts_exhausted") || isPlayerWindingMandom(defender))) {
        const rawDmg = event.damage;
        if (rawDmg > 0) {
            event.cancel = true;
            const totalDmg = rawDmg * 1.5;

            system.run(() => {
                if (!defender?.isValid) return;

                if (defender.hasTag("ts_exhausted")) cancelTimeStopCharge(defender, true);
                if (isPlayerWindingMandom(defender)) cancelMandomWindup(defender, true);


                try {
                    const stunObj = world.scoreboard.getObjective("stun");
                    if (stunObj) stunObj.setScore(defender, 35);
                } catch { }


                try {
                    const loc = defender.location;
                    const hitLoc = { x: loc.x, y: loc.y + 1, z: loc.z };
                    defender.dimension.spawnParticle("xvoid:blood", hitLoc);
                    defender.dimension.spawnParticle("sfx:impact", loc);
                    defender.dimension.spawnParticle("xvoid:dust_puff", hitLoc);
                    spawnImpactRing(defender.dimension, hitLoc, { x: 0, y: 1, z: 0 }, { radius: 2.8, time: 0.3, color: Colors.crimson, alpha: 0.95 });
                    spawnStarburst(defender.dimension, hitLoc, { size: 2.2, life: 0.24 });
                    defender.dimension.playSound("random.break", loc, { volume: 1.2, pitch: 0.75 });
                    defender.dimension.playSound("xvoid.hit_M", loc, { volume: 1.0, pitch: 0.85 });
                } catch { }


                try {
                    defender.applyDamage(totalDmg, {
                        cause: "override",
                        damagingEntity: attacker?.isValid ? attacker : undefined
                    });
                } catch { }
            });
            return;
        }
    }


    const isDefenderBlocking = defender?.typeId === "minecraft:player" &&
        (defender.hasTag("blocking") || defender.hasTag("parry")) &&
        Boolean(defender.isSneaking || defender.getProperty?.("property:blocking") === 1);

    if (isDefenderBlocking) {
        let sourceLoc = attacker?.isValid ? attacker.location : null;
        if (!sourceLoc && projectile?.isValid) {
            sourceLoc = projectile.location;
            try {
                const vel = projectile.getVelocity?.();
                if (vel && (vel.x !== 0 || vel.z !== 0)) {
                    sourceLoc = { x: sourceLoc.x - vel.x * 5, y: sourceLoc.y - vel.y * 5, z: sourceLoc.z - vel.z * 5 };
                }
            } catch { }
        }

        const inFront = isAttackInFront(defender, sourceLoc);

        if (inFront) {

            if (isParrying(defender)) {
                event.cancel = true;
                const rawDmg = event.damage;
                const returnedDamage = rawDmg * 1.5;

                system.run(() => {
                    try {
                        if (!defender?.isValid) return;
                        defender.removeTag("parry");
                        const mem = getMemory(defender.id);
                        if (mem) mem.blockTicks = Math.max(mem.blockTicks, 11);
                        addEnergy(defender, 25);
                        setEnergyCooldown(defender, 0);

                        const loc = defender.location;
                        const hitLoc = { x: loc.x, y: loc.y + 1, z: loc.z };


                        playParryVFX(defender, { x: 0, y: 1, z: 0 }, hitLoc);


                        if (attacker?.isValid) {
                            try {
                                const stunObj = world.scoreboard.getObjective("stun");
                                if (stunObj) stunObj.setScore(attacker, 28);
                                const attLoc = attacker.location;
                                const kx = attLoc.x - loc.x;
                                const kz = attLoc.z - loc.z;
                                const kDist = Math.sqrt(kx * kx + kz * kz) || 1;
                                attacker.applyKnockback({ x: (kx / kDist) * 1.5, z: (kz / kDist) * 1.5 }, 0.25);
                                attacker.applyDamage(returnedDamage, {
                                    cause: "override",
                                    damagingEntity: defender
                                });
                            } catch { }
                        }
                        if (projectile?.isValid) {
                            try { projectile.kill(); } catch { }
                        }
                    } catch { }
                });
                return;
            }


            if (defender.hasTag("blocking")) {
                const rawDmg = event.damage;
                if (rawDmg > 0) {
                    const blockedDmg = rawDmg * 0.9;
                    let playerDmg = rawDmg * 0.1;


                    const maxHp = defender.getComponent("minecraft:health")?.effectiveMax || 20;
                    const energyChipped = (blockedDmg * 0.5 / maxHp) * 100;

                    const currentEnergy = getEnergy(defender);
                    const nextEnergy = Math.max(0, currentEnergy - energyChipped);
                    setEnergy(defender, nextEnergy);

                    event.cancel = true;


                    const armorRed = calculateArmorReduction(defender, playerDmg);
                    playerDmg *= (1 - armorRed);

                    const resLevel = defender.getEffects?.()?.find(e => e.typeId === "resistance")?.amplifier || 0;
                    playerDmg *= (1 - 0.2 * Math.min(5, resLevel));


                    system.run(() => {
                        try {
                            if (!defender?.isValid) return;
                            const loc = defender.location;
                            const hitLoc = { x: loc.x, y: loc.y + 1, z: loc.z };
                            playBlockImpactVFX(defender, { x: 0, y: 1, z: 0 }, hitLoc);
                            defender.runCommand("scriptevent xvoid:block");
                        } catch { }
                    });


                    if (nextEnergy <= 0) {
                        system.run(() => {
                            if (defender?.isValid) {
                                breakGuard(defender, "energy");
                            }
                        });
                    }


                    if (playerDmg > 0) {
                        system.run(() => {
                            if (defender?.isValid) {
                                defender.applyDamage(playerDmg, {
                                    cause: "override"
                                });
                                try { defender.clearVelocity(); } catch { }
                            }
                        });
                    }
                    return;
                }
            }
        }


    }
});
