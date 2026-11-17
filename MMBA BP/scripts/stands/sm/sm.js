import { world, system } from "@minecraft/server";
import { pushPlayerHudTitle, registerSmDinoHudTokenProvider } from "../../energy.js";
import {
    Colors,
    buildBasis,
    spawnVFX,
    spawnImpactRing,
    spawnPunchShockwave,
    spawnConeSparks,
    spawnBezierSlash,
    spawnGlowFlash,
    spawnStarburst
} from "../../utils/vfx.js";

const SmStandId = 12;
const SenseRange = 12;
const MaxSenseLines = 14;
const MotionGraceTicks = 3;
const IndicatorRefreshInterval = 2;

const ColorSenseCrimson = Object.freeze({ x: 1.0, y: 0.22, z: 0.16 });

const SenseExcludeTypes = new Set([
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
    "minecraft:tnt",
    "minecraft:falling_block",
    "xvoid:dmg",
    "xvoid:impact_frame",
    "xvoid:tim_arm",
    "xvoid:frozen_rain",
    "jjba:steelball",
    "jjba:knife",
    "jjba:nail",
]);

const wasSmPlayers = new Set();
const activeDinoVisionIds = new Set();
const appliedNightVisionIds = new Set();
const cleanedFogOnBootIds = new Set();
const motionCache = new Map();
const heavyDashFollowers = new Map();

let tickCounter = 0;

registerSmDinoHudTokenProvider((player) => (activeDinoVisionIds.has(player.id) ? "sm_dino" : ""));

function getScore(entity, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(entity) ?? 0;
    } catch {
        return 0;
    }
}

function setScore(entity, objectiveName, value) {
    try {
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(entity, Math.round(value));
    } catch { }
}

function setActState(player, nextAct) {
    const clamped = nextAct === 1 ? 1 : 0;
    setScore(player, "act", clamped);
    try {
        if (player.getProperty("property:act") !== clamped) {
            player.setProperty("property:act", clamped);
        }
    } catch { }
}

function isHoldingStandItem(player) {
    try {
        const mainhand = player.getComponent("equippable")?.getEquipment("Mainhand");
        return mainhand?.typeId === "jjba:stand" || mainhand?.typeId === "jjba:stand2";
    } catch {
        return false;
    }
}

function getEntityAimCenter(entity) {
    try {
        const head = entity.getHeadLocation();
        if (head) {
            return {
                x: entity.location.x,
                y: entity.location.y + Math.max(0.35, (head.y - entity.location.y) * 0.65),
                z: entity.location.z,
            };
        }
    } catch { }
    return { x: entity.location.x, y: entity.location.y + 0.95, z: entity.location.z };
}

function isValidSenseEntity(entity, viewerId) {
    if (!entity?.isValid || entity.id === viewerId) return false;
    if (SenseExcludeTypes.has(entity.typeId)) return false;
    if (entity.hasTag("tusk_decoy") || entity.hasTag("tusk_rotation")) return false;
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

function isEntityMoving(entity, tick) {
    const cached = motionCache.get(entity.id);
    if (cached && cached.lastSeenTick === tick) {
        return cached.lastMoving;
    }

    const loc = entity.location;
    let horizVel = 0;
    let vertVel = 0;
    try {
        const vel = entity.getVelocity();
        if (vel) {
            horizVel = Math.hypot(vel.x, vel.z);
            vertVel = Math.abs(vel.y);
        }
    } catch { }


    let movingNow = horizVel > 0.02 || vertVel > 0.12;
    if (cached && tick - cached.lastSeenTick <= 2) {
        const posHoriz = Math.hypot(loc.x - cached.x, loc.z - cached.z);
        const posVert = Math.abs(loc.y - cached.y);
        if (posHoriz > 0.008 || posVert > 0.015) {
            movingNow = true;
        }
    }

    const nextGrace = movingNow
        ? MotionGraceTicks
        : Math.max(0, (cached?.movingGrace ?? 0) - 1);
    const isMoving = nextGrace > 0;

    motionCache.set(entity.id, {
        x: loc.x,
        y: loc.y,
        z: loc.z,
        movingGrace: nextGrace,
        lastSeenTick: tick,
        lastMoving: isMoving,
    });

    return isMoving;
}

function spawnDinoMotionIndicator(viewer, target) {
    if (!viewer?.isValid || !target?.isValid) return;
    const targetCenter = getEntityAimCenter(target);
    const origin = {
        x: viewer.location.x,
        y: viewer.location.y + 1.15,
        z: viewer.location.z,
    };

    const dx = targetCenter.x - origin.x;
    const dy = targetCenter.y - origin.y;
    const dz = targetCenter.z - origin.z;
    const totalDist = Math.hypot(dx, dy, dz) || 1;
    const dir = { x: dx / totalDist, y: dy / totalDist, z: dz / totalDist };


    const startOffset = Math.min(0.95, totalDist * 0.35);
    const endOffset = Math.max(startOffset + 0.25, totalDist - 0.55);
    const span = endOffset - startOffset;
    if (span > 0.30) {
        const step = Math.max(1.15, span / 10);
        for (let d = startOffset; d < endOffset; d += step) {
            spawnVFX(viewer, "sm:sense_line", {
                x: origin.x + dir.x * d,
                y: origin.y + dir.y * d,
                z: origin.z + dir.z * d,
            }, {
                s_x: 0.26,
                s_y: 0.028,
                life: 0.14,
                alpha: 0.85,
                color: ColorSenseCrimson,
                dir,
            });
        }
    }
}

function enterDinoVision(player) {
    if (!player?.isValid) return;
    activeDinoVisionIds.add(player.id);
    cleanedFogOnBootIds.add(player.id);

    try {
        player.runCommand("fog @s remove sm_dino");
        player.runCommand("fog @s push sm:dino_vision sm_dino");
    } catch { }

    try {
        const existingNv = player.getEffect("night_vision");
        if (!existingNv || existingNv.duration <= 400) {
            player.addEffect("night_vision", 400, { amplifier: 0, showParticles: false });
            appliedNightVisionIds.add(player.id);
        }
    } catch { }

    pushPlayerHudTitle(player);
}

function exitDinoVision(player) {
    if (!player?.id) return;
    const wasActive = activeDinoVisionIds.delete(player.id);

    if (!player.isValid) {
        appliedNightVisionIds.delete(player.id);
        return;
    }

    if (wasActive || !cleanedFogOnBootIds.has(player.id)) {
        cleanedFogOnBootIds.add(player.id);
        try { player.runCommand("fog @s remove sm_dino"); } catch { }
    }

    if (appliedNightVisionIds.delete(player.id)) {
        try { player.runCommand("effect @s night_vision 0"); } catch { }
    }

    if (wasActive) {
        pushPlayerHudTitle(player);
    }
}

function tickDinoVisionForPlayer(player, tick) {

    if (tick % 100 === 0 && appliedNightVisionIds.has(player.id)) {
        try {
            player.addEffect("night_vision", 400, { amplifier: 0, showParticles: false });
        } catch { }
    }

    let nearby = [];
    try {
        nearby = player.dimension.getEntities({
            location: player.location,
            maxDistance: SenseRange,
        });
    } catch {
        nearby = [];
    }

    const movingTargets = [];
    const shouldSpawnIndicators = tick % IndicatorRefreshInterval === 0;

    for (const ent of nearby) {
        if (!isValidSenseEntity(ent, player.id)) continue;

        if (isEntityMoving(ent, tick) && shouldSpawnIndicators) {
            const dx = ent.location.x - player.location.x;
            const dy = ent.location.y - player.location.y;
            const dz = ent.location.z - player.location.z;
            movingTargets.push({ ent, dist: Math.hypot(dx, dy, dz) });
        }
    }

    if (shouldSpawnIndicators && movingTargets.length > 0) {
        movingTargets.sort((a, b) => a.dist - b.dist);
        const count = Math.min(MaxSenseLines, movingTargets.length);
        for (let i = 0; i < count; i++) {
            spawnDinoMotionIndicator(player, movingTargets[i].ent);
        }
    }
}

system.runInterval(() => {
    tickCounter++;
    const allPlayers = world.getAllPlayers();

    for (const player of allPlayers) {
        if (!player?.isValid) continue;

        const standC = getScore(player, "standC");
        if (standC !== SmStandId) {
            if (wasSmPlayers.has(player.id)) {
                wasSmPlayers.delete(player.id);
                if (getScore(player, "act") !== 0) {
                    setActState(player, 0);
                }
            }
            if (activeDinoVisionIds.has(player.id) || !cleanedFogOnBootIds.has(player.id)) {
                exitDinoVision(player);
            }
            continue;
        }

        wasSmPlayers.add(player.id);

        let act = getScore(player, "act");
        if (act !== 0 && act !== 1) {
            act = 0;
            setActState(player, 0);
        }


        if (player.hasTag("chargeMSB")) {
            try { player.removeTag("chargeMSB"); } catch { }

            const blocked =
                player.hasTag("tsed") ||
                player.hasTag("clashing") ||
                player.hasTag("onSkill") ||
                getScore(player, "stun") > 1;

            if (!blocked) {
                const nextAct = act === 1 ? 0 : 1;
                setActState(player, nextAct);
                setScore(player, "cd", 10);
                act = nextAct;
            }
        }


        if (act === 1 && !isHoldingStandItem(player)) {
            act = 0;
            setActState(player, 0);
        }

        const isFullDino = act === 1;
        if (isFullDino) {
            if (!activeDinoVisionIds.has(player.id)) {
                enterDinoVision(player);
            }
            tickDinoVisionForPlayer(player, tickCounter);
        } else if (activeDinoVisionIds.has(player.id) || !cleanedFogOnBootIds.has(player.id)) {
            exitDinoVision(player);
        }
    }


    if (tickCounter % 40 === 0) {
        for (const [id, entry] of motionCache.entries()) {
            if (tickCounter - entry.lastSeenTick > 40) {
                motionCache.delete(id);
            }
        }
    }


    for (const [id, state] of heavyDashFollowers.entries()) {
        const p = state.player;
        if (!p?.isValid || !p.hasTag("onSkill") || getScore(p, "stun") > 1 || state.ticksLeft <= 0) {
            heavyDashFollowers.delete(id);
            continue;
        }
        spawnBlueXWingSlash(p);
        state.ticksLeft--;
        if (state.ticksLeft <= 0) {
            heavyDashFollowers.delete(id);
        }
    }
}, 1);

world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!player?.isValid) return;
    heavyDashFollowers.delete(player.id);
    if (getScore(player, "standC") === SmStandId && getScore(player, "act") !== 0) {
        setActState(player, 0);
    }
    cleanedFogOnBootIds.delete(player.id);
    exitDinoVision(player);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    wasSmPlayers.delete(playerId);
    activeDinoVisionIds.delete(playerId);
    appliedNightVisionIds.delete(playerId);
    cleanedFogOnBootIds.delete(playerId);
    heavyDashFollowers.delete(playerId);
});

const WorldUp = Object.freeze({ x: 0, y: 1, z: 0 });
const XWingAngleRad = (22 * Math.PI) / 180;

function getHorizontalView(player) {
    try {
        const v = player.getViewDirection();
        const len = Math.hypot(v.x, v.z);
        if (len > 1e-4) return { x: v.x / len, y: 0, z: v.z / len };
    } catch { }
    return { x: 0, y: 0, z: -1 };
}


function spawnBlueXWingSlash(player) {
    if (!player?.isValid) return;
    const dim = player.dimension;
    const loc = player.location;
    const hDir = getHorizontalView(player);
    const { right } = buildBasis(hDir);

    const chestCenter = {
        x: loc.x + hDir.x * 0.65,
        y: loc.y + 1.05,
        z: loc.z + hDir.z * 0.65
    };

    try {

        for (const [rollAngle, color] of [[-22, Colors.cyan], [22, Colors.blue]]) {
            spawnBezierSlash(dim, chestCenter, hDir, {
                rollAngle,
                reach: 1.9,
                span: 2.15,
                color,
                width: 0.22,
                flight: 0.07,
                lag: 0.14
            });
        }


        const wingHeight = 1.35;
        const cos = Math.cos(XWingAngleRad);
        const sin = Math.sin(XWingAngleRad);
        for (const [sign, color] of [[1, Colors.cyan], [-1, Colors.blue]]) {
            const sSin = sin * sign;
            const wingUp = {
                x: right.x * cos + WorldUp.x * sSin,
                y: right.y * cos + WorldUp.y * sSin,
                z: right.z * cos + WorldUp.z * sSin
            };
            const wingRight = {
                x: -right.x * sSin + WorldUp.x * cos,
                y: -right.y * sSin + WorldUp.y * cos,
                z: -right.z * sSin + WorldUp.z * cos
            };
            const wingOrigin = {
                x: chestCenter.x - wingUp.x * wingHeight,
                y: chestCenter.y - wingUp.y * wingHeight,
                z: chestCenter.z - wingUp.z * wingHeight
            };
            spawnVFX(dim, "tusk:nail_slash_wave", wingOrigin, {
                fwd: hDir,
                right: wingRight,
                up: wingUp,
                speed: 5,
                height: wingHeight,
                bow: 1.25,
                tilt: 0,
                life: 0.14,
                thickness: 0.20,
                color,
                alpha: 0.9
            });
        }
    } catch { }
}

function spawnHeavyDashSlashVFX(player, phase) {
    if (!player?.isValid) return;
    const dim = player.dimension;
    const loc = player.location;
    const hDir = getHorizontalView(player);

    try {
        if (phase === "windup") {
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            spawnImpactRing(dim, { x: loc.x, y: loc.y + 0.08, z: loc.z }, WorldUp, {
                radius: 1.7,
                time: 0.28,
                color: Colors.crimson,
                alpha: 0.75
            });
            return;
        }

        if (phase === "slash") {
            const chestAhead = {
                x: loc.x + hDir.x * 0.95,
                y: loc.y + 1.05,
                z: loc.z + hDir.z * 0.95
            };
            const slashOrigin = {
                x: loc.x + hDir.x * 1.35,
                y: loc.y + 1.15,
                z: loc.z + hDir.z * 1.35
            };
            const waveOrigin = {
                x: loc.x + hDir.x * 1.1,
                y: loc.y + 0.15,
                z: loc.z + hDir.z * 1.1
            };


            dim.spawnParticle("xvoid:dash", loc);
            dim.spawnParticle("xvoid:dash2", { x: loc.x, y: loc.y + 0.85, z: loc.z });
            dim.spawnParticle("sfx:impact", { x: loc.x, y: loc.y + 0.05, z: loc.z });
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            spawnPunchShockwave(dim, chestAhead, hDir);
            spawnConeSparks(dim, chestAhead, hDir);
            spawnImpactRing(dim, chestAhead, hDir, {
                radius: 2.8,
                time: 0.22,
                color: Colors.crimson,
                alpha: 0.92
            });
            spawnImpactRing(dim, chestAhead, hDir, {
                radius: 2.1,
                time: 0.19,
                color: Colors.cyan,
                alpha: 0.85
            });


            for (const rollAngle of [-38, 38]) {
                spawnBezierSlash(dim, slashOrigin, hDir, {
                    rollAngle,
                    reach: 2.7,
                    span: 1.85,
                    color: Colors.crimson,
                    width: 0.30,
                    flight: 0.10,
                    lag: 0.34
                });
            }


            const { right } = buildBasis(hDir);
            for (const tilt of [-0.45, 0.45]) {
                spawnVFX(dim, "tusk:nail_slash_wave", waveOrigin, {
                    fwd: hDir,
                    right,
                    up: WorldUp,
                    speed: 22,
                    height: 0.95,
                    bow: 0.95,
                    tilt,
                    life: 0.22,
                    thickness: 0.26,
                    color: Colors.crimson,
                    alpha: 0.92
                });
                spawnVFX(dim, "tusk:nail_slash_wave", waveOrigin, {
                    fwd: hDir,
                    right,
                    up: WorldUp,
                    speed: 22,
                    height: 0.92,
                    bow: 0.93,
                    tilt,
                    life: 0.20,
                    thickness: 0.10,
                    color: Colors.white,
                    alpha: 0.98
                });
            }


            spawnBlueXWingSlash(player);
            heavyDashFollowers.set(player.id, { player, ticksLeft: 4 });
            return;
        }

        if (phase === "trail") {
            const wakePos = {
                x: loc.x + hDir.x * 1.1,
                y: loc.y + 1.0,
                z: loc.z + hDir.z * 1.1
            };
            const followOrigin = {
                x: loc.x + hDir.x * 1.6,
                y: loc.y + 1.1,
                z: loc.z + hDir.z * 1.6
            };
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            spawnImpactRing(dim, wakePos, hDir, {
                radius: 2.2,
                time: 0.20,
                color: Colors.cyan,
                alpha: 0.78,
                soft: true
            });
            spawnBezierSlash(dim, followOrigin, hDir, {
                rollAngle: -10,
                reach: 2.75,
                span: 1.9,
                color: Colors.crimson,
                width: 0.20,
                flight: 0.09,
                lag: 0.26
            });
            return;
        }

        if (phase === "finish") {
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            spawnImpactRing(dim, { x: loc.x, y: loc.y + 0.06, z: loc.z }, WorldUp, {
                radius: 2.1,
                time: 0.22,
                color: Colors.steel,
                alpha: 0.65,
                soft: true
            });
        }
    } catch { }
}


function spawnBarrageSlashVFX(player, phase) {
    if (!player?.isValid) return;
    const dim = player.dimension;
    const loc = player.location;
    let viewDir;
    try {
        viewDir = player.getViewDirection();
    } catch {
        viewDir = getHorizontalView(player);
    }

    const { fwd, right, up } = buildBasis(viewDir);
    const chestAhead = {
        x: loc.x + fwd.x * 1.1,
        y: loc.y + 1.1 + fwd.y * 1.1,
        z: loc.z + fwd.z * 1.1
    };

    try {
        if (phase === "windup") {
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            spawnImpactRing(dim, { x: loc.x, y: loc.y + 0.08, z: loc.z }, WorldUp, {
                radius: 1.6,
                time: 0.24,
                color: Colors.cyan,
                alpha: 0.80
            });
            spawnGlowFlash(dim, { x: loc.x, y: loc.y + 1.0, z: loc.z }, {
                size: 1.8,
                life: 0.22,
                color: Colors.cyan,
                alpha: 0.65
            });
            return;
        }

        if (phase === "start") {
            dim.spawnParticle("xvoid:dash", loc);
            dim.spawnParticle("xvoid:dash2", { x: loc.x, y: loc.y + 0.85, z: loc.z });
            dim.spawnParticle("sfx:impact", { x: loc.x, y: loc.y + 0.05, z: loc.z });
            spawnPunchShockwave(dim, chestAhead, fwd);
            spawnConeSparks(dim, chestAhead, fwd);
            spawnImpactRing(dim, chestAhead, fwd, {
                radius: 2.6,
                time: 0.22,
                color: Colors.cyan,
                alpha: 0.90
            });
            spawnImpactRing(dim, chestAhead, fwd, {
                radius: 2.0,
                time: 0.18,
                color: Colors.blue,
                alpha: 0.85
            });
            return;
        }

        if (phase === "slash") {
            const palette = [Colors.cyan, Colors.blue, Colors.steel];
            let primaryCenter = chestAhead;


            for (let i = 0; i < 3; i++) {
                const forwardDist = 0.65 + Math.random() * 0.55;
                const jitterR = (Math.random() - 0.5) * 1.45;
                const jitterU = (Math.random() - 0.5) * 0.95;
                const slashCenter = {
                    x: loc.x + fwd.x * forwardDist + right.x * jitterR + up.x * jitterU,
                    y: loc.y + 1.15 + fwd.y * forwardDist + right.y * jitterR + up.y * jitterU,
                    z: loc.z + fwd.z * forwardDist + right.z * jitterR + up.z * jitterU
                };
                if (i === 0) primaryCenter = slashCenter;

                const slashColor = palette[Math.floor(Math.random() * palette.length)];
                const rollAngle = (Math.random() - 0.5) * 360;

                spawnBezierSlash(dim, slashCenter, fwd, {
                    rollAngle,
                    reach: 1.35 + Math.random() * 0.55,
                    span: 1.2 + Math.random() * 0.5,
                    color: slashColor,
                    width: 0.22 + Math.random() * 0.08,
                    flight: 0.06 + Math.random() * 0.02,
                    lag: 0.14
                });
            }


            const waveCount = system.currentTick % 2 === 0 ? 2 : 1;
            for (let w = 0; w < waveCount; w++) {
                const rad = (Math.random() - 0.5) * Math.PI;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const rotRight = {
                    x: right.x * cos - up.x * sin,
                    y: right.y * cos - up.y * sin,
                    z: right.z * cos - up.z * sin
                };
                const rotUp = {
                    x: right.x * sin + up.x * cos,
                    y: right.y * sin + up.y * cos,
                    z: right.z * sin + up.z * cos
                };
                const waveHeight = 0.68 + Math.random() * 0.25;
                const wFwd = 0.7 + Math.random() * 0.4;
                const wJitterR = (Math.random() - 0.5) * 0.85;
                const wJitterU = (Math.random() - 0.5) * 0.55;
                const waveCenter = {
                    x: loc.x + fwd.x * wFwd + right.x * wJitterR + up.x * wJitterU,
                    y: loc.y + 1.15 + fwd.y * wFwd + right.y * wJitterR + up.y * wJitterU,
                    z: loc.z + fwd.z * wFwd + right.z * wJitterR + up.z * wJitterU
                };
                const waveOrigin = {
                    x: waveCenter.x - rotUp.x * waveHeight,
                    y: waveCenter.y - rotUp.y * waveHeight,
                    z: waveCenter.z - rotUp.z * waveHeight
                };
                const tilt = (Math.random() - 0.5) * 0.9;
                const speed = 2.0 + Math.random() * 2.5;
                const bow = 0.65 + Math.random() * 0.2;
                const waveColor = Math.random() < 0.55 ? Colors.cyan : Colors.blue;

                spawnVFX(dim, "tusk:nail_slash_wave", waveOrigin, {
                    fwd,
                    right: rotRight,
                    up: rotUp,
                    speed,
                    height: waveHeight,
                    bow,
                    tilt,
                    life: 0.11,
                    thickness: 0.22,
                    color: waveColor,
                    alpha: 0.90
                });
                spawnVFX(dim, "tusk:nail_slash_wave", waveOrigin, {
                    fwd,
                    right: rotRight,
                    up: rotUp,
                    speed,
                    height: waveHeight * 0.96,
                    bow: bow * 0.97,
                    tilt,
                    life: 0.09,
                    thickness: 0.09,
                    color: Colors.white,
                    alpha: 0.96
                });
            }


            const tick = system.currentTick;
            if (tick % 2 === 0) {
                spawnConeSparks(dim, chestAhead, fwd);
                spawnStarburst(dim, primaryCenter, { size: 1.2, life: 0.15 });
                spawnGlowFlash(dim, primaryCenter, {
                    size: 1.65,
                    life: 0.16,
                    color: Colors.cyan,
                    alpha: 0.55
                });
            }
            if (tick % 3 === 0) {
                spawnImpactRing(dim, chestAhead, fwd, {
                    radius: 1.85 + Math.random() * 0.65,
                    time: 0.18,
                    color: Math.random() < 0.5 ? Colors.cyan : Colors.blue,
                    alpha: 0.75,
                    soft: true
                });
                dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.1, z: loc.z });
            }
            if (tick % 4 === 0) {
                spawnPunchShockwave(dim, chestAhead, fwd);
                dim.spawnParticle("xvoid:dash2", { x: loc.x, y: loc.y + 0.85, z: loc.z });
            }
        }
    } catch { }
}


function spawnLowTailWhipVFX(player, phase) {
    try {
        const dim = player.dimension;
        const loc = player.location;
        const { fwd } = getHorizontalView(player);
        const { right } = buildBasis(fwd);

        if (phase === "windup") {
            const crouchCenter = { x: loc.x, y: loc.y + 0.45, z: loc.z };
            spawnImpactRing(dim, { x: loc.x, y: loc.y + 0.12, z: loc.z }, WorldUp, {
                radius: 1.4,
                time: 0.22,
                color: Colors.cyan,
                alpha: 0.75,
                soft: 0.35
            });
            dim.spawnParticle("xvoid:dust_puff", crouchCenter);
            return;
        }

        if (phase === "spin") {
            const sweepOrigin = {
                x: loc.x + fwd.x * 0.65,
                y: loc.y + 0.55,
                z: loc.z + fwd.z * 0.65
            };
            spawnBezierSlash(dim, sweepOrigin, fwd, {
                rollAngle: 8,
                reach: 2.3,
                span: 2.8,
                color: Colors.cyan,
                width: 0.22,
                flight: 0.28,
                lag: 0.04
            });
            dim.spawnParticle("xvoid:dust_puff", { x: loc.x, y: loc.y + 0.15, z: loc.z });
            return;
        }

        if (phase === "whip") {
            const groundCenter = { x: loc.x, y: loc.y + 0.15, z: loc.z };
            const whipCenter = {
                x: loc.x + fwd.x * 1.45,
                y: loc.y + 0.65,
                z: loc.z + fwd.z * 1.45
            };
            const strikeTip = {
                x: loc.x + fwd.x * 2.55,
                y: loc.y + 0.7,
                z: loc.z + fwd.z * 2.55
            };

            spawnVFX(dim, "tusk:nail_slash_wave", whipCenter, {
                fwd,
                right,
                up: WorldUp,
                speed: 6.5,
                height: 2.4,
                bow: 0.85,
                tilt: 12,
                life: 0.26,
                thickness: 0.42,
                color: Colors.cyan,
                alpha: 0.92
            });
            spawnBezierSlash(dim, whipCenter, fwd, {
                rollAngle: -10,
                reach: 2.9,
                span: 3.4,
                color: Colors.gold,
                width: 0.28,
                flight: 0.32,
                lag: 0.05
            });
            spawnImpactRing(dim, groundCenter, WorldUp, {
                radius: 2.6,
                time: 0.28,
                color: Colors.cyan,
                alpha: 0.85,
                soft: 0.4
            });
            spawnGlowFlash(dim, strikeTip, { size: 1.15, life: 0.2, color: Colors.gold, alpha: 0.9 });
            spawnConeSparks(dim, whipCenter, fwd);
            dim.spawnParticle("sfx:impact", strikeTip);
            dim.spawnParticle("xvoid:dust_puff", groundCenter);
        }
    } catch { }
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (
        event.id !== "xvoid:sm_heavy" &&
        event.id !== "xvoid:sm_barrage" &&
        event.id !== "xvoid:sm_low"
    ) return;
    const player = event.sourceEntity ?? event.initiator;
    if (!player?.isValid) return;
    const phase = (event.message ?? "").trim().toLowerCase();
    if (event.id === "xvoid:sm_heavy") {
        spawnHeavyDashSlashVFX(player, phase);
    } else if (event.id === "xvoid:sm_barrage") {
        spawnBarrageSlashVFX(player, phase);
    } else {
        spawnLowTailWhipVFX(player, phase);
    }
});
