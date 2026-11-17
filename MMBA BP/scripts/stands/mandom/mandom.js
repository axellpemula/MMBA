import { world, system } from "@minecraft/server";
import { getEnergy, useEnergy } from "../../energy.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { Colors, spawnImpactRing, spawnStarburst, spawnVortexRing } from "../../utils/vfx.js";
import {
    activateMandom,
    freezeCheckpoint,
    clearFrozenCheckpoint,
    toggleClockMode,
    ClockModeOff,
    ClockModeHolding,
    ClockModeAlways
} from "./reverse.js";

const MandomStandId = 4;
const WindupTicksMaxEnergy = 20;
const WindupTicks1Energy = 70;
const WindupTicksZeroEnergy = 100;
const RewindEnergyCost = 80;
const RewindRegenDelayTicks = 60;

const ClockModeLabels = {
    [ClockModeOff]: "§7Clock Indicator: §cOff",
    [ClockModeHolding]: "§7Clock Indicator: §eWhen Holding",
    [ClockModeAlways]: "§7Clock Indicator: §aAlways Active"
};


const activeWindups = new Map();

export function isPlayerWindingMandom(player) {
    return Boolean(player?.id && activeWindups.has(player.id));
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
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(entity.scoreboardIdentity ?? entity, Math.round(value));
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

function isMandomUser(player) {
    return Boolean(player?.isValid && getScore(player, "standC") === MandomStandId);
}


export function calculateMandomWindupTicks(player) {
    const energy = Math.max(0, Math.min(100, getEnergy(player)));
    if (energy < 1) return WindupTicksZeroEnergy;
    const ratio = (energy - 1) / 99;
    return Math.round(WindupTicks1Energy - ratio * (WindupTicks1Energy - WindupTicksMaxEnergy));
}

function restoreWindupMovement(player) {
    try {
        player.runCommand("function util/returnMovement");
        player.runCommand("inputpermission set @s movement enabled");
        player.runCommand("inputpermission set @s lateral_movement enabled");
        player.runCommand("inputpermission set @s jump enabled");
        player.runCommand("effect @s slowness 0");
    } catch { }
}


export function cancelMandomWindup(player, playBreakFeedback = false) {
    if (!player?.isValid) return;
    activeWindups.delete(player.id);
    clearFrozenCheckpoint(player);
    try {
        player.removeTag("mandom_windup");
        player.setProperty("property:attack", 0);
        restoreWindupMovement(player);
        if (playBreakFeedback) {
            player.dimension.playSound("random.break", player.location, { volume: 0.9, pitch: 1.1 });
            player.dimension.spawnParticle("xvoid:dust_puff", {
                x: player.location.x,
                y: player.location.y + 0.5,
                z: player.location.z
            });
        } else {
            player.playSound("random.click", { volume: 0.5, pitch: 0.7 });
        }
    } catch { }
}

function finishMandomWindup(player, state) {
    if (!player?.isValid) return;
    activeWindups.delete(player.id);
    try {
        player.removeTag("mandom_windup");
        player.setProperty("property:attack", 0);
        restoreWindupMovement(player);

        if (!isMandomUser(player)) {
            clearFrozenCheckpoint(player);
            return;
        }


        useEnergy(player, RewindEnergyCost, RewindRegenDelayTicks);
        setScore(player, "iFrames", Math.max(getScore(player, "iFrames"), 5));
        setScore(player, "sp1", -15);
        setScore(player, "cd", 1);

        try {
            player.runCommand("camerashake add @s 0.4 0.2");
            player.runCommand("camera @s fade time 0.2 0.0 0.2 color 255 255 255");
        } catch { }

        const loc = player.location;
        spawnImpactRing(player.dimension, { x: loc.x, y: loc.y + 0.15, z: loc.z }, { x: 0, y: 1, z: 0 }, {
            radius: 4.5,
            time: 0.28,
            color: Colors.gold,
            alpha: 0.95,
            soft: false
        });
        spawnStarburst(player.dimension, { x: loc.x, y: loc.y + 1.0, z: loc.z }, {
            size: 2.4,
            life: 0.22
        });

        activateMandom(player, state.frozenTargetTick);
    } catch {
        clearFrozenCheckpoint(player);
    }
}

function handleClockToggle(player) {
    if (!isMandomUser(player) || isPlayerWindingMandom(player)) return;
    if (getScore(player, "stun") > 1 || player.hasTag("onSkill") || player.hasTag("clashing")) return;

    const mode = toggleClockMode(player);
    try {
        player.onScreenDisplay.setActionBar(ClockModeLabels[mode] ?? ClockModeLabels[ClockModeHolding]);
        player.playSound("random.click", {
            volume: 0.65,
            pitch: mode === ClockModeOff ? 0.85 : mode === ClockModeHolding ? 1.2 : 1.55
        });
    } catch { }
}

function handleRewind(player) {
    if (!isMandomUser(player)) return;


    if (player.hasTag("mandom_windup") && !activeWindups.has(player.id)) {
        try {
            player.removeTag("mandom_windup");
            player.setProperty("property:attack", 0);
        } catch { }
    }


    if (activeWindups.has(player.id)) {
        cancelMandomWindup(player, false);
        return;
    }

    if (isTimeStopped() || player.hasTag("tsed") || player.hasTag("onSkill") || player.hasTag("clashing")) return;
    if (getScore(player, "stun") > 1) return;

    const windupTicks = calculateMandomWindupTicks(player);
    const frozenTargetTick = freezeCheckpoint(player);

    activeWindups.set(player.id, {
        playerId: player.id,
        frozenTargetTick,
        windupTicks,
        maxWindupTicks: Math.max(1, windupTicks),
        elapsedTicks: 0,
        initialItem: getHeldItemTypeId(player) ?? "jjba:stand2"
    });

    try {
        player.addTag("mandom_windup");
        player.removeTag("onSkill");
        player.setProperty("property:attack", 1);
        player.dimension.playSound("random.click", player.location, { volume: 0.8, pitch: 1.4 });
        spawnVortexRing(player.dimension, {
            x: player.location.x,
            y: player.location.y + 0.15,
            z: player.location.z
        }, { x: 0, y: 1, z: 0 }, {
            radius: 1.15,
            thickness: 0.2,
            id: "xvoid:ts_vortex_ring"
        });
    } catch { }
}


system.runInterval(() => {
    for (const p of world.getPlayers()) {
        if (p?.isValid && p.hasTag("mandom_windup") && !activeWindups.has(p.id)) {
            cancelMandomWindup(p, false);
        }
    }

    for (const [playerId, state] of activeWindups) {
        const player = world.getEntity(playerId);
        if (!player?.isValid) {
            activeWindups.delete(playerId);
            continue;
        }

        const currentItem = getHeldItemTypeId(player);
        const swappedItem = currentItem !== "jjba:stand2";
        const realStun = !isTimeStopped() && !player.hasTag("tsed") && getScore(player, "stun") > 1;

        if (
            !isMandomUser(player) ||
            swappedItem ||
            isTimeStopped() ||
            player.hasTag("tsed") ||
            realStun ||
            player.hasTag("clashing") ||
            !player.hasTag("mandom_windup")
        ) {
            cancelMandomWindup(player, false);
            continue;
        }

        state.windupTicks--;
        state.elapsedTicks++;

        try {
            const progressRatio = Math.min(1.0, state.elapsedTicks / state.maxWindupTicks);
            const progressPct = Math.min(100, Math.max(1, Math.round(progressRatio * 100)));

            player.runCommand("inputpermission set @s lateral_movement disabled");
            player.runCommand("inputpermission set @s jump disabled");
            player.setProperty("property:attack", progressPct);
            player.addEffect("slowness", 5, { amplifier: 6, showParticles: false });

            if (state.elapsedTicks % 4 === 0) {
                player.dimension.spawnParticle("xvoid:ki_spark", player.location);
            }
            if (state.elapsedTicks % 14 === 0) {
                spawnVortexRing(player.dimension, {
                    x: player.location.x,
                    y: player.location.y + 0.15,
                    z: player.location.z
                }, { x: 0, y: 1, z: 0 }, {
                    radius: 0.9 + progressRatio * 0.7,
                    thickness: 0.18 + progressRatio * 0.06,
                    id: "xvoid:ts_vortex_ring"
                });
            }
            if (state.elapsedTicks % 5 === 0) {
                player.dimension.playSound("note.hat", player.location, {
                    volume: 0.45,
                    pitch: 1.2 + progressRatio * 0.65
                });
            }
        } catch { }

        if (state.windupTicks <= 0) {
            finishMandomWindup(player, state);
        }
    }
}, 1);

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "xvoid:mandom_skill") return;
    const player = event.sourceEntity ?? event.initiator;
    if (!player?.isValid || player.typeId !== "minecraft:player") return;

    const action = (event.message ?? "").trim().toLowerCase();
    if (action === "clock_toggle") {
        handleClockToggle(player);
    } else if (action === "rewind") {
        handleRewind(player);
    }
});
