import { world, system } from "@minecraft/server";
import { getEnergy, useEnergy } from "../../energy.js";
import { applyHitscanDamage } from "../../damage/damage.js";
import { applyBleed } from "../tusk/bleed.js";
import { isParrying, isAttackInFront } from "../basic_combat.js";
import { isTimeStopped, tsStopperIds } from "../../utils/tsState.js";
import { isPassableBlock, raycastSolidBlock, resolveBlockHitPoint } from "../../utils/blocks.js";
import {
    Colors,
    spawnImpactRing,
    spawnGlowFlash,
    spawnStarburst,
    spawnBezierSlash
} from "../../utils/vfx.js";

const ExcludeTypes = new Set([
    "minecraft:armor_stand",
    "minecraft:item",
    "minecraft:xp_orb",
    "minecraft:arrow",
    "minecraft:snowball",
    "minecraft:egg",
    "xvoid:dmg",
    "xvoid:impact_frame",
    "xvoid:frozen_rain",
    "xvoid:twau_tandem"
]);

const activeSkills = new Map();
const tandemStates = new Map();

const TandemEnergyCost = 40;
const TandemDurationTicks = 50;
const TandemFalloffStart = 5.0;
const TandemStepSpeed = 0.14;
const TandemScanRange = 2.0;
const TandemSpawnDist = 1.15;
const TandemWallBuffer = 0.5;
const TandemWallCheckHeights = [0.55, 1.0, 1.55];
const TandemWallSideOffsets = [0, 0.25, -0.25];
const TandemPassableRe = /(?:^|:)(?:air|cave_air|void_air|short_grass|tall_grass|grass|water|flowing_water|lava|flowing_lava|light_block|structure_void)$|flower|double_plant|peony|rose_bush|lilac|sunflower|fern|vine|torch|snow_layer|sapling|bush|carpet|button|lever|(?:^|:|_)(?:wall_)?sign$|rail|redstone_wire|pressure_plate|tripwire|dead_bush|seagrass|kelp|light_block|structure_void/;

const ChopEnergyCost = 40;
const ChopBaseDamage = 13;
const ChopBleedTicks = 80;
const ChopHitTick = 9;
const ChopEndTick = 14;

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

function getHorizontalView(player) {
    try {
        const vd = player.getViewDirection();
        const len = Math.hypot(vd.x, vd.z);
        if (len > 0.001) return { x: vd.x / len, z: vd.z / len };
    } catch { }
    return { x: 0, z: -1 };
}


function getLowEnergyDamageMult(energyAtStart) {
    const below = Math.max(0, 40 - energyAtStart);
    return Math.max(0, 1 - below * 0.01);
}

function isValidTarget(caster, ent) {
    if (!ent?.isValid || ent.id === caster.id) return false;
    if (ExcludeTypes.has(ent.typeId)) return false;
    try {
        const hp = ent.getComponent("minecraft:health");
        if (hp && hp.currentValue <= 0) return false;
    } catch { }
    return true;
}

function isInFrontalBox(entityPos, casterPos, casterViewDir, offset, distance, height, width) {
    const dx = entityPos.x - casterPos.x;
    const dy = entityPos.y - casterPos.y;
    const dz = entityPos.z - casterPos.z;

    const viewLen = Math.hypot(casterViewDir.x, casterViewDir.y, casterViewDir.z);
    if (viewLen === 0) return false;

    const vx = casterViewDir.x / viewLen;
    const vy = casterViewDir.y / viewLen;
    const vz = casterViewDir.z / viewLen;

    const hLen = Math.hypot(vx, vz);
    const hForwardX = hLen > 0.001 ? vx / hLen : 0;
    const hForwardZ = hLen > 0.001 ? vz / hLen : -1;

    const forwardDist = dx * hForwardX + dz * hForwardZ;
    if (forwardDist < offset || forwardDist > offset + distance) return false;

    const rightX = -hForwardZ;
    const rightZ = hForwardX;
    const rightDist = Math.abs(dx * rightX + dz * rightZ);
    if (rightDist > width / 2) return false;

    const fullForwardDist = dx * vx + dy * vy + dz * vz;
    const perpX = dx - fullForwardDist * vx;
    const perpY = dy - fullForwardDist * vy;
    const perpZ = dz - fullForwardDist * vz;

    const rightComp = perpX * rightX + perpZ * rightZ;
    const vertPerpX = perpX - rightComp * rightX;
    const vertPerpZ = perpZ - rightComp * rightZ;

    return Math.hypot(vertPerpX, perpY, vertPerpZ) <= height / 2;
}

function isSolidBlockAtPoint(dim, x, y, z) {
    try {
        const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
        if (!b || isPassableBlock(b, TandemPassableRe)) return false;
        const tid = b.typeId;
        if ((tid.includes("door") || tid.includes("fence_gate")) && b.permutation?.getState("open_bit") === true) {
            return false;
        }
        if (tid.includes("slab") && b.permutation?.getState("minecraft:vertical_half") === "bottom") {
            return (y - Math.floor(y)) < 0.5;
        }
        return true;
    } catch {
        return false;
    }
}

function getWallHitDistance(dim, origin, dir, maxDist) {
    const hDir = { x: dir.x, y: 0, z: dir.z };
    const rightX = -dir.z;
    const rightZ = dir.x;
    let minHitDist = null;

    const recordHit = (dist) => {
        const clamped = Math.max(0, dist);
        if (minHitDist === null || clamped < minHitDist) {
            minHitDist = clamped;
        }
    };

    for (const side of TandemWallSideOffsets) {
        const sx = origin.x + rightX * side;
        const sz = origin.z + rightZ * side;

        for (const dy of TandemWallCheckHeights) {
            const rayOrigin = { x: sx, y: origin.y + dy, z: sz };
            try {
                const hit = raycastSolidBlock(dim, rayOrigin, hDir, maxDist, { passableRe: TandemPassableRe });
                if (hit?.block) {
                    const hitPt = resolveBlockHitPoint(rayOrigin, hDir, hit);
                    recordHit((hitPt.x - rayOrigin.x) * hDir.x + (hitPt.z - rayOrigin.z) * hDir.z);
                }
            } catch { }

            const steps = Math.max(1, Math.ceil(maxDist / 0.2));
            for (let i = 0; i <= steps; i++) {
                const d = (maxDist * i) / steps;
                if (isSolidBlockAtPoint(dim, sx + hDir.x * d, origin.y + dy, sz + hDir.z * d)) {
                    recordHit(d);
                    break;
                }
            }
        }
    }

    return minHitDist;
}

function hasTandemLineOfSight(dim, standPos, targetPos) {
    const from = { x: standPos.x, y: standPos.y + 1.0, z: standPos.z };
    const to = { x: targetPos.x, y: targetPos.y + 1.0, z: targetPos.z };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= 0.25) return true;
    const checkDist = dist - 0.25;
    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;
    try {
        const hit = raycastSolidBlock(dim, from, { x: ux, y: uy, z: uz }, checkDist, { passableRe: TandemPassableRe });
        if (hit?.block) return false;
    } catch { }

    const steps = Math.max(1, Math.ceil(checkDist / 0.25));
    for (let i = 1; i <= steps; i++) {
        const d = (checkDist * i) / steps;
        if (isSolidBlockAtPoint(dim, from.x + ux * d, from.y + uy * d, from.z + uz * d)) {
            return false;
        }
    }
    return true;
}

function findTandemTarget(caster, standPos, dir) {
    const dim = caster.dimension;
    const scanCenter = {
        x: standPos.x + dir.x * (TandemScanRange * 0.5),
        y: standPos.y + 0.9,
        z: standPos.z + dir.z * (TandemScanRange * 0.5)
    };

    let bestTarget = null;
    let bestScore = Infinity;

    const candidates = dim.getEntities({
        location: scanCenter,
        maxDistance: TandemScanRange + 1.0,
        excludeFamilies: ["damage", "atk", "inanimate"],
        excludeTags: ["non_target", "tusk_detached", "tusk_spatial", "tusk_rotation"]
    });

    for (const ent of candidates) {
        if (!isValidTarget(caster, ent)) continue;

        const dx = ent.location.x - standPos.x;
        const dy = ent.location.y - standPos.y;
        const dz = ent.location.z - standPos.z;
        const forward = dx * dir.x + dz * dir.z;
        if (forward < -0.35 || forward > TandemScanRange + 0.25) continue;

        const right = Math.abs(dx * (-dir.z) + dz * dir.x);
        if (right > 1.5 || Math.abs(dy) > 2.2) continue;
        if (!hasTandemLineOfSight(dim, standPos, ent.location)) continue;

        const dist = Math.hypot(dx, dy, dz);
        if (dist < bestScore) {
            bestScore = dist;
            bestTarget = ent;
        }
    }

    return bestTarget;
}

function dirToYawDeg(dir) {
    return Math.atan2(-dir.x, dir.z) * (180 / Math.PI);
}

function syncStandEntity(state) {
    const { player, standEntity, standPos, dir } = state;
    if (!standEntity?.isValid) return;
    try {
        standEntity.teleport(standPos, {
            dimension: player.dimension,
            rotation: { x: 0, y: dirToYawDeg(dir) }
        });
    } catch { }
}

function copyColorwayProps(fromPlayer, toEntity) {
    for (const prop of ["property:stand_hue", "property:stand_sat", "property:stand_bri", "property:stand_rainbow"]) {
        try {
            const val = fromPlayer.getProperty(prop);
            if (typeof val === "number") toEntity.setProperty(prop, val);
        } catch { }
    }
}

function stopTandem(player) {
    if (!player?.isValid) return;
    const prev = tandemStates.get(player.id);
    if (prev?.standEntity?.isValid) {
        try { prev.standEntity.remove(); } catch { }
    }
    tandemStates.delete(player.id);
    try {
        player.removeTag("twau_tandem");
        const standC = getScore(player, "standC");
        if (standC === 2 || !player.hasTag("tusk_detached")) {
            player.setProperty("property:tim_limb", 0);
            player.setProperty("property:tim_dx", 0);
            player.setProperty("property:tim_dy", 0);
            player.setProperty("property:tim_dz", 0);
            player.setProperty("property:tim_dir_x", 0);
            player.setProperty("property:tim_dir_y", -1);
            player.setProperty("property:tim_dir_z", 0);
        }
    } catch { }
}

function cleanupCasterSkill(player, sp1 = -8, cd = 0) {
    if (!player?.isValid) return;
    try {
        player.removeTag("onSkill");
        player.removeTag("uncancelable");
        player.removeTag("chargeTB");
        player.removeTag("chargeMB");
        player.runCommand("function util/returnMovement");
        setScore(player, "sp1", sp1);
        setScore(player, "cd", cd);
        setScore(player, "movesScript", 0);
    } catch { }
}


function startChop(player) {
    if (!player?.isValid) return;
    if (player.hasTag("onSkill") || player.hasTag("twau_tandem") || activeSkills.has(player.id) || tandemStates.has(player.id)) return;
    if (getScore(player, "stun") > 1 || player.hasTag("clashing")) return;

    const startEnergy = getEnergy(player);
    if (startEnergy <= 0) return;

    const energyDamageMult = getLowEnergyDamageMult(startEnergy);
    useEnergy(player, ChopEnergyCost, 40);

    try {
        const useChop2 = getScore(player, "m1") > 0 || getScore(player, "sp1") < 0;
        player.addTag("onSkill");
        player.removeTag("chargeTB");
        setScore(player, "movesScript", 0);
        setScore(player, "iFrames", 4);
        player.addEffect("slowness", 20, { amplifier: 3, showParticles: false });
        player.playAnimation(useChop2 ? "animation.twau.chop2" : "animation.twau.chop");
        player.dimension.playSound("diego.atkSL_01", player.location, { volume: 1.0, pitch: 1.05 });
        player.dimension.playSound("xvoid.skill_wind2", player.location, { volume: 0.9, pitch: 1.1 });
    } catch { }

    activeSkills.set(player.id, {
        player,
        type: "chop",
        ticks: 0,
        energyDamageMult
    });
}

function tickChop(id, state) {
    const { player } = state;
    if (!player?.isValid || getScore(player, "stun") > 1 || getScore(player, "standC") !== 2) {
        activeSkills.delete(id);
        cleanupCasterSkill(player, -6, 0);
        return;
    }

    state.ticks++;

    if (state.ticks === ChopHitTick) {
        const dim = player.dimension;
        let viewDir = { x: 0, y: 0, z: -1 };
        try { viewDir = player.getViewDirection(); } catch { }
        const hDir = getHorizontalView(player);

        const swingOrigin = {
            x: player.location.x + hDir.x * 1.4,
            y: player.location.y + 1.15,
            z: player.location.z + hDir.z * 1.4
        };

        try {
            dim.playSound("xvoid.std_swing05", player.location, { volume: 1.05, pitch: 1.1 });
            dim.playSound("diego.atkSL_02", player.location, { volume: 1.05, pitch: 1.0 });
            player.runCommand("camerashake add @s 0.8 0.2");
            spawnBezierSlash(dim, swingOrigin, hDir, {
                rollAngle: -35,
                reach: 2.2,
                span: 1.6,
                color: Colors.gold,
                width: 0.28
            });
        } catch { }

        const scaledDamage = Math.round(ChopBaseDamage * (state.energyDamageMult ?? 1) * 100) / 100;
        const candidates = dim.getEntities({
            location: player.location,
            maxDistance: 7.5,
            excludeFamilies: ["damage", "atk", "inanimate"],
            excludeTags: ["non_target", "tusk_detached", "tusk_spatial", "tusk_rotation"]
        });

        for (const target of candidates) {
            if (!isValidTarget(player, target)) continue;
            if (!isInFrontalBox(target.location, player.location, viewDir, -0.3, 5.5, 4.5, 3.8)) continue;

            const wasNegated = target.hasTag("century_active") ||
                (isParrying(target) && isAttackInFront(target, player));

            if (scaledDamage > 0) {
                applyHitscanDamage(player, target, scaledDamage, {
                    modifiers: {
                        heavy: true,
                        heavyBack: 8,
                        heavyUp: 1.4,
                        blockable: false
                    },
                    originPos: player.location,
                    originViewDir: viewDir
                });
            }

            if (!wasNegated) {
                applyBleed(target, ChopBleedTicks, 1.6, player);
            }

            const hitLoc = { x: target.location.x, y: target.location.y + 1.0, z: target.location.z };
            try {
                dim.playSound("xvoid.hit_slash_L", hitLoc, { volume: 1.1, pitch: 1.0 });
                dim.playSound("xvoid.hit_wind", hitLoc, { volume: 0.9, pitch: 1.1 });
                dim.spawnParticle("xvoid:blood", hitLoc);
                spawnImpactRing(dim, hitLoc, hDir, {
                    radius: 2.6,
                    time: 0.26,
                    color: Colors.gold,
                    alpha: 0.9
                });
                spawnGlowFlash(dim, hitLoc, {
                    size: 2.4,
                    life: 0.28,
                    color: Colors.gold,
                    alpha: 0.75
                });
            } catch { }
        }
    }

    if (state.ticks >= ChopEndTick) {
        activeSkills.delete(id);
        cleanupCasterSkill(player, -8, 0);
    }
}


function startTandem(player) {
    if (!player?.isValid) return;
    if (player.hasTag("onSkill") || player.hasTag("twau_tandem") || activeSkills.has(player.id) || tandemStates.has(player.id)) return;
    if (getScore(player, "stun") > 1 || player.hasTag("clashing")) return;

    const startEnergy = getEnergy(player);
    if (startEnergy <= 0) return;

    const energyDamageMult = getLowEnergyDamageMult(startEnergy);
    useEnergy(player, TandemEnergyCost, 40);

    const dir = getHorizontalView(player);
    const wallHitDist = getWallHitDistance(player.dimension, player.location, dir, TandemSpawnDist + TandemWallBuffer);
    const spawnDist = wallHitDist !== null
        ? Math.min(TandemSpawnDist, Math.max(0, wallHitDist - TandemWallBuffer))
        : TandemSpawnDist;
    const startPos = {
        x: player.location.x + dir.x * spawnDist,
        y: player.location.y,
        z: player.location.z + dir.z * spawnDist
    };

    let standEntity = null;
    try {
        player.addTag("twau_tandem");
        player.removeTag("chargeMB");
        player.setProperty("property:tim_limb", 1);
        standEntity = player.dimension.spawnEntity("xvoid:twau_tandem", startPos);
        standEntity.addTag("non_target");
        copyColorwayProps(player, standEntity);
        standEntity.teleport(startPos, {
            dimension: player.dimension,
            rotation: { x: 0, y: dirToYawDeg(dir) }
        });
        player.dimension.playSound("diego.atkGL_02", startPos, { volume: 1.0, pitch: 1.0 });
        player.dimension.playSound("xvoid.dash", startPos, { volume: 0.85, pitch: 1.0 });
        spawnImpactRing(player.dimension, { x: startPos.x, y: startPos.y + 1.0, z: startPos.z }, dir, {
            radius: 1.8,
            time: 0.2,
            color: Colors.gold,
            alpha: 0.85
        });
    } catch { }

    tandemStates.set(player.id, {
        player,
        standEntity,
        ticks: 0,
        standPos: startPos,
        dir,
        target: null,
        energyDamageMult
    });
}

function tickTandem(id, state) {
    const { player } = state;
    if (!player?.isValid) {
        tandemStates.delete(id);
        return;
    }

    try {
        const hp = player.getComponent("minecraft:health");
        if ((hp && hp.currentValue <= 0) || getScore(player, "standC") !== 2) {
            stopTandem(player);
            return;
        }
    } catch { }


    if (isTimeStopped() && !tsStopperIds.has(player.id)) {
        syncStandEntity(state);
        return;
    }

    state.ticks++;
    if (!player.hasTag("twau_tandem")) {
        try { player.addTag("twau_tandem"); } catch { }
    }

    const dim = player.dimension;


    if (state.target) {
        if (!isValidTarget(player, state.target) || state.target.dimension?.id !== dim.id) {
            state.target = null;
        }
    }

    if (!state.target) {
        let found = findTandemTarget(player, state.standPos, state.dir);
        if (!found) {
            if (getWallHitDistance(dim, state.standPos, state.dir, TandemStepSpeed + TandemWallBuffer) !== null) {
                stopTandem(player);
                return;
            }

            state.standPos = {
                x: state.standPos.x + state.dir.x * TandemStepSpeed,
                y: state.standPos.y,
                z: state.standPos.z + state.dir.z * TandemStepSpeed
            };

            found = findTandemTarget(player, state.standPos, state.dir);
        }

        if (found) {
            state.target = found;
            try {
                spawnStarburst(dim, {
                    x: found.location.x,
                    y: found.location.y + 1.0,
                    z: found.location.z
                }, { size: 1.6, life: 0.18 });
            } catch { }
        }
    }

    if (state.target) {
        const tLoc = state.target.location;
        const dx = tLoc.x - state.standPos.x;
        const dz = tLoc.z - state.standPos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001) {
            state.dir = { x: dx / d, z: dz / d };
        }
        state.standPos = {
            x: tLoc.x - state.dir.x * 1.1,
            y: tLoc.y,
            z: tLoc.z - state.dir.z * 1.1
        };


        if (state.ticks % 2 === 0) {
            const distFromUser = Math.hypot(
                state.standPos.x - player.location.x,
                state.standPos.y - player.location.y,
                state.standPos.z - player.location.z
            );
            const excessBlocks = Math.max(0, distFromUser - TandemFalloffStart);
            const damageMult = Math.max(0, 1.0 - excessBlocks * 0.1);
            const baseDamage = 1.15 * (state.energyDamageMult ?? 1);
            const scaledDamage = Math.round(baseDamage * damageMult * 100) / 100;
            const hitLoc = {
                x: tLoc.x,
                y: tLoc.y + 1.0,
                z: tLoc.z
            };

            try {
                if (state.ticks % 6 === 0) {
                    spawnImpactRing(dim, hitLoc, state.dir, {
                        radius: 1.5,
                        time: 0.16,
                        color: Colors.gold,
                        alpha: 0.75
                    });
                }
                dim.spawnParticle("minecraft:critical_hit_emitter", hitLoc);
            } catch { }

            if (scaledDamage > 0) {
                applyHitscanDamage(player, state.target, scaledDamage, {
                    modifiers: {
                        barrage: true,
                        staggerType: "barrage",
                        barragePush: 0.08,
                        barrageDown: 0,
                        blockable: true
                    },
                    originPos: state.standPos,
                    originViewDir: { x: state.dir.x, y: 0, z: state.dir.z }
                });
            }
        }
    }

    const sfxPos = state.target
        ? { x: state.target.location.x, y: state.target.location.y + 1.0, z: state.target.location.z }
        : { x: state.standPos.x, y: state.standPos.y + 1.0, z: state.standPos.z };
    try {
        dim.playSound("xvoid.swing06", sfxPos, { volume: 0.9, pitch: 1.0 });
        dim.playSound("xvoid.oramuda_button", sfxPos, { volume: 0.9, pitch: 1.0 });
    } catch { }

    syncStandEntity(state);

    if (state.ticks >= TandemDurationTicks) {
        stopTandem(player);
    }
}

system.runInterval(() => {
    for (const [id, state] of activeSkills.entries()) {
        if (state.type === "chop") {
            tickChop(id, state);
        }
    }
    for (const [id, state] of tandemStates.entries()) {
        tickTandem(id, state);
    }
}, 1);

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "xvoid:twau") return;
    const player = event.sourceEntity ?? event.initiator;
    if (!player?.isValid) return;

    const action = (event.message ?? "").trim().toLowerCase();
    if (action === "chop") {
        startChop(player);
    } else if (action === "tandem") {
        startTandem(player);
    }
});

world.afterEvents.playerSpawn.subscribe(({ player }) => {
    stopTandem(player);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    const prev = tandemStates.get(playerId);
    if (prev?.standEntity?.isValid) {
        try { prev.standEntity.remove(); } catch { }
    }
    activeSkills.delete(playerId);
    tandemStates.delete(playerId);
});
