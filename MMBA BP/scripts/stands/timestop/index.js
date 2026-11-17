import { world, system } from "@minecraft/server";
import { getEnergy, setEnergy, useEnergy } from "../../energy.js";
import { Colors, spawnImpactRing, spawnStarburst, spawnVortexRing } from "../../utils/vfx.js";
import { isTimeStopped, tsStopperIds } from "../../utils/tsState.js";


const activeCharges = new Map();

export function isOtherTimeStopActive(player) {
    if (!player?.isValid) return false;
    for (const id of tsStopperIds) {
        if (id !== player.id) return true;
    }
    return false;
}

export function isPlayerChargingTimeStop(player) {
    return activeCharges.has(player?.id);
}

function getScore(entity, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(entity.scoreboardIdentity ?? entity) ?? 0;
    } catch {
        return 0;
    }
}

function setScore(entity, objectiveName, value) {
    try {
        world.scoreboard.getObjective(objectiveName)?.setScore(entity.scoreboardIdentity ?? entity, Math.round(value));
    } catch {
        try {
            entity.runCommand(`scoreboard players set @s ${objectiveName} ${Math.round(value)}`);
        } catch { }
    }
}

function getHeldItemTypeId(player) {
    try {
        const inv = player.getComponent("minecraft:inventory") ?? player.getComponent("inventory");
        const item = inv?.container?.getItem(player.selectedSlotIndex);
        if (item?.typeId) return item.typeId;
    } catch { }
    try {
        const eq = player.getComponent("minecraft:equippable") ?? player.getComponent("equippable");
        const item = eq?.getEquipment("Mainhand");
        if (item?.typeId) return item.typeId;
    } catch { }
    return null;
}


export function calculateChargeTicks(player, durationTicks) {
    const maxChargeTicks = Math.round(durationTicks * 1.5);
    const minChargeTicks = Math.max(10, Math.round(durationTicks * 0.16));
    const baseHighChargeTicks = Math.round(maxChargeTicks * 0.9);

    const currentEnergy = Math.max(0, Math.min(100, getEnergy(player)));
    if (currentEnergy <= 25) {
        return maxChargeTicks;
    }

    const ratio = (currentEnergy - 25) / 75.0;
    return Math.round(baseHighChargeTicks - ratio * (baseHighChargeTicks - minChargeTicks));
}


export function startTimeStopCharge(player, stand, requestedDuration) {
    if (!player?.isValid) return;
    if (typeof requestedDuration !== "number" || isNaN(requestedDuration) || requestedDuration <= 0) return;


    if (player.hasTag("ts_exhausted") && !activeCharges.has(player.id)) {
        try { player.removeTag("ts_exhausted"); } catch { }
        try { player.removeTag("ts_counter_charge"); } catch { }
    }


    if (
        activeCharges.has(player.id) ||
        player.hasTag("clashing") ||
        player.hasTag("ts") ||
        getScore(player, "ts") > 1
    ) {
        return;
    }

    const isInsideOtherTS = isOtherTimeStopActive(player) || player.hasTag("tsed");
    const currentEnergy = Math.max(0, getEnergy(player));

    let chargeTicks = 0;
    let finalDurationTicks = requestedDuration;
    let isRechargingEnergy = false;


    if (isInsideOtherTS) {
        if (currentEnergy < 50) {

            chargeTicks = 30;
            finalDurationTicks = Math.max(2, Math.round(requestedDuration * 0.5));
            isRechargingEnergy = true;
        } else {

            chargeTicks = calculateChargeTicks(player, requestedDuration);
            finalDurationTicks = Math.max(2, Math.round(requestedDuration * (currentEnergy / 100)));
            isRechargingEnergy = false;
        }
    } else {

        const stun = getScore(player, "stun");
        if (stun > 1) return;

        chargeTicks = calculateChargeTicks(player, requestedDuration);
        finalDurationTicks = requestedDuration;
        isRechargingEnergy = false;
    }

    const startAnim = `animation.${stand}.ts_start`;
    const endAnim = `animation.${stand}.ts_end`;
    const initialSlot = player.selectedSlotIndex;
    const initialItem = getHeldItemTypeId(player) ?? "jjba:stand2";

    const state = {
        playerId: player.id,
        stand,
        startAnim,
        endAnim,
        durationTicks: finalDurationTicks,
        chargeTicks,
        maxChargeTicks: Math.max(1, chargeTicks),
        elapsedTicks: 0,
        initialSlot,
        initialItem,
        isCounterTS: isInsideOtherTS,
        isRechargingEnergy,
        startEnergy: currentEnergy,
        targetEnergy: 50
    };
    activeCharges.set(player.id, state);

    try {
        player.addTag("ts_exhausted");
        player.removeTag("onSkill");
        player.removeTag("tsed");
        setScore(player, "tser", 1);
        player.setProperty("property:attack", 1);

        player.runCommand("camera @s clear");
        player.runCommand("effect @s blindness 0");
        player.runCommand("effect @s slowness 0");

        try {
            player.playAnimation(startAnim);
        } catch { }


        spawnVortexRing(player.dimension, { x: player.location.x, y: player.location.y + 0.15, z: player.location.z }, { x: 0, y: 1, z: 0 }, {
            radius: 1.4,
            thickness: 0.25,
            id: "xvoid:ts_vortex_ring"
        });
        player.dimension.spawnParticle("xvoid:ki_spark", { x: player.location.x, y: player.location.y + 0.2, z: player.location.z });
    } catch { }
}


export function cancelTimeStopCharge(player, playBreakFeedback = false) {
    if (!player?.isValid) return;
    activeCharges.delete(player.id);
    try {
        player.removeTag("ts_exhausted");
        player.removeTag("ts_counter_charge");
        player.setProperty("property:attack", 0);
        player.runCommand("function util/returnMovement");
        player.runCommand("inputpermission set @s movement enabled");
        player.runCommand("inputpermission set @s lateral_movement enabled");
        player.runCommand("inputpermission set @s jump enabled");
        player.runCommand("effect @s slowness 0");
        player.runCommand("effect @s blindness 0");
        player.runCommand("camera @s clear");
        if (playBreakFeedback) {
            player.dimension.playSound("random.break", player.location, { volume: 0.9, pitch: 1.1 });
            player.dimension.spawnParticle("xvoid:dust_puff", { x: player.location.x, y: player.location.y + 0.5, z: player.location.z });
        }
    } catch { }
}


export function finishTimeStopCharge(player, state) {
    if (!player?.isValid) return;
    activeCharges.delete(player.id);

    try {
        player.removeTag("ts_exhausted");
        player.removeTag("ts_counter_charge");
        player.removeTag("tsed");
        player.setProperty("property:attack", 0);

        if (state.endAnim) {
            try {
                player.playAnimation(state.endAnim);
            } catch { }
        }

        player.runCommand("function util/returnMovement");
        player.runCommand("inputpermission set @s movement enabled");
        player.runCommand("inputpermission set @s lateral_movement enabled");
        player.runCommand("inputpermission set @s jump enabled");
        player.runCommand("effect @s slowness 0");
        player.runCommand("effect @s blindness 0");
        player.runCommand("camera @s clear");

        spawnVortexRing(player.dimension, { x: player.location.x, y: player.location.y + 0.2, z: player.location.z }, { x: 0, y: 1, z: 0 }, {
            radius: 3.6,
            thickness: 0.35,
            id: "xvoid:ts_vortex_ring"
        });
        spawnImpactRing(player.dimension, { x: player.location.x, y: player.location.y + 0.1, z: player.location.z }, { x: 0, y: 1, z: 0 }, {
            radius: 5.0,
            time: 0.32,
            color: Colors.gold,
            alpha: 0.95,
            soft: false
        });
        spawnStarburst(player.dimension, { x: player.location.x, y: player.location.y + 1.0, z: player.location.z }, {
            size: 2.6,
            life: 0.24
        });
        player.dimension.spawnParticle("xvoid:ki_spark", { x: player.location.x, y: player.location.y + 0.5, z: player.location.z });


        if (state.isCounterTS) {
            const cost = Math.max(2, Math.round(getEnergy(player)));
            useEnergy(player, cost, 40);
        } else {
            useEnergy(player, 80, 60);
        }


        setScore(player, "ts", state.durationTicks);
        setScore(player, "tser", 1);
        setScore(player, "tsed", -1);
        setScore(player, "stun", 0);
        setScore(player, "cd", 20);
        player.addTag("ts");
    } catch { }
}


system.runInterval(() => {

    for (const p of world.getPlayers()) {
        if (p?.isValid && p.hasTag("ts_exhausted") && !activeCharges.has(p.id)) {
            cancelTimeStopCharge(p, false);
        }
    }

    for (const [playerId, state] of activeCharges) {
        const player = world.getEntity(playerId);
        if (!player?.isValid) {
            activeCharges.delete(playerId);
            continue;
        }

        const stun = getScore(player, "stun");
        const currentItem = getHeldItemTypeId(player);


        const swappedItem = state.initialItem === "jjba:stand2"
            ? (currentItem && currentItem !== "jjba:stand2")
            : (currentItem && currentItem !== state.initialItem);

        if (swappedItem) {
            cancelTimeStopCharge(player, true);
            continue;
        }


        const isTimeStopStun = player.hasTag("tsed") || isTimeStopped();
        const isRealStun = !isTimeStopStun && stun > 1;

        if (
            !player.hasTag("ts_exhausted") ||
            isRealStun ||
            player.hasTag("clashing")
        ) {
            cancelTimeStopCharge(player, false);
            continue;
        }

        state.chargeTicks--;
        state.elapsedTicks++;


        setScore(player, "tser", 1);
        player.removeTag("tsed");

        if (state.isRechargingEnergy) {

            const progress = Math.min(1.0, state.elapsedTicks / state.maxChargeTicks);
            const energyNow = state.startEnergy + (state.targetEnergy - state.startEnergy) * progress;
            setEnergy(player, energyNow);
        }

        try {
            const maxTicks = Math.max(1, state.maxChargeTicks);
            const progressRatio = Math.min(1.0, state.elapsedTicks / maxTicks);


            player.runCommand("inputpermission set @s lateral_movement disabled");
            player.runCommand("inputpermission set @s jump disabled");


            const progressPct = Math.min(100, Math.max(1, Math.round(progressRatio * 100)));
            player.setProperty("property:attack", progressPct);
            player.addEffect("slowness", 5, { amplifier: 6, showParticles: false });


            if (state.elapsedTicks % 2 === 0) {
                player.dimension.spawnParticle("xvoid:ki_aura", player.location);
            }


            if (state.elapsedTicks % 3 === 0) {
                player.dimension.spawnParticle("xvoid:ki_spark", player.location);
            }


            if (state.elapsedTicks % 12 === 0) {
                spawnVortexRing(player.dimension, {
                    x: player.location.x,
                    y: player.location.y + 0.15,
                    z: player.location.z
                }, { x: 0, y: 1, z: 0 }, {
                    radius: 1.0 + progressRatio * 1.1,
                    thickness: 0.2 + progressRatio * 0.08,
                    id: "xvoid:ts_vortex_ring"
                });
            }


            if (state.chargeTicks % 25 === 0) {
                player.dimension.playSound("xvoid.heart_chargeLP", player.location, {
                    volume: 0.7,
                    pitch: 1.0 + progressRatio * 0.25
                });
            }
        } catch { }

        if (state.chargeTicks <= 0) {
            finishTimeStopCharge(player, state);
        }
    }
}, 1);


system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id.startsWith("ts:")) {
        const stand = event.id.substring(3).trim().toLowerCase();
        const player = event.sourceEntity;
        if (!player || player.typeId !== "minecraft:player" || !player.isValid) return;

        const duration = parseInt(event.message?.trim(), 10);
        if (isNaN(duration) || duration <= 0) return;

        startTimeStopCharge(player, stand, duration);
    }
});
