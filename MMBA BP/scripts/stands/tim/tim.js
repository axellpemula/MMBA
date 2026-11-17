import { world, system, MolangVariableMap, EasingType, InputButton, ButtonState } from "@minecraft/server";
import { isPassableBlock, raycastSolidBlock, resolveBlockHitPoint } from "../../utils/blocks.js";
import { getEnergy, useEnergy } from "../../energy.js";
import { applyHitscanDamage } from "../../damage/damage.js";
import { isTimeStopped } from "../../utils/tsState.js";
import { Colors, resolveDetachedArmAim, spawnDetachedArmAimIndicator } from "../../utils/vfx.js";
import {
    TimHitboxType,
    registerTimHitbox,
    unregisterTimHitbox,
    hasRegisteredTimHitbox,
    getTimHitboxOwner,
    isOwnTimHitbox,
} from "./timHitboxState.js";


const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const playerHitboxMode = new Map();

export function syncTimCollisionBox(player, mode = "normal") {
    if (!player?.isValid) return;
    const prev = playerHitboxMode.get(player.id);
    if (prev === mode) return;
    playerHitboxMode.set(player.id, mode);
    const ev = mode === "tiny"
        ? "xvoid:hitbox_tiny"
        : (mode === "small" ? "xvoid:hitbox_small" : "xvoid:hitbox_normal");
    try { player.triggerEvent(ev); } catch { }
}

function despawnHitboxEntity(ent) {
    if (!ent) return;
    const id = ent.id;
    unregisterTimHitbox(id);
    if (!ent.isValid) return;
    try {
        ent.triggerEvent("xvoid:despawn");
    } catch {
        try { ent.remove(); } catch { }
    }
}

function cleanupUnravelHitboxes(st) {
    if (!st?.hitboxParts) return;
    for (const ent of st.hitboxParts.values()) {
        despawnHitboxEntity(ent);
    }
    st.hitboxParts.clear();
}

function syncUnravelHitboxes(player, st) {
    if (!player?.isValid || !st) return;
    if (!st.hitboxParts) st.hitboxParts = new Map();

    const dx = st.armPos.x - st.anchorCenter.x;
    const dy = st.armPos.y - st.anchorCenter.y;
    const dz = st.armPos.z - st.anchorCenter.z;
    const effDist = Math.hypot(dx, dy, dz);
    const nodes = getUnravelRopeNodes(st);


    if (effDist >= 12.5) {
        syncTimCollisionBox(player, "tiny");
    } else if (effDist >= 8.5) {
        syncTimCollisionBox(player, "small");
    } else {
        syncTimCollisionBox(player, "normal");
    }

    const desired = [];
    if (effDist >= 2.0) {
        desired.push({
            key: "right_arm",
            sizeEvent: "xvoid:size_arm",
            pos: { x: st.armPos.x, y: st.armPos.y - 0.17, z: st.armPos.z },
        });
    }
    if (effDist >= 4.5) {
        const lArmPt = sampleRopePolylineByFrac(nodes, 0.63);
        desired.push({
            key: "left_arm",
            sizeEvent: "xvoid:size_arm",
            pos: { x: lArmPt.x, y: lArmPt.y - 0.17, z: lArmPt.z },
        });
    }
    if (effDist >= 8.5) {
        const torsoPt = sampleRopePolylineByFrac(nodes, 0.35);
        desired.push({
            key: "torso",
            sizeEvent: "xvoid:size_torso",
            pos: { x: torsoPt.x, y: torsoPt.y - 0.22, z: torsoPt.z },
        });
    }
    if (effDist >= 10.5) {
        const headPt = sampleRopePolylineByFrac(nodes, 0.46);
        desired.push({
            key: "head",
            sizeEvent: "xvoid:size_head",
            pos: { x: headPt.x, y: headPt.y - 0.21, z: headPt.z },
        });
    }
    if (effDist >= 12.5) {
        const pelvisPt = sampleRopePolylineByFrac(nodes, 0.16);
        desired.push({
            key: "pelvis",
            sizeEvent: "xvoid:size_torso",
            pos: { x: pelvisPt.x, y: pelvisPt.y - 0.18, z: pelvisPt.z },
        });
    }

    const wantedKeys = new Set(desired.map((d) => d.key));
    for (const [k, ent] of st.hitboxParts) {
        if (!wantedKeys.has(k) || !ent?.isValid || ent.dimension.id !== st.dim.id) {
            despawnHitboxEntity(ent);
            st.hitboxParts.delete(k);
        }
    }

    for (const spec of desired) {
        let ent = st.hitboxParts.get(spec.key);
        if (ent?.isValid && ent.dimension.id === st.dim.id) {
            try {
                ent.teleport(spec.pos);
                registerTimHitbox(ent, player, spec.key);
            } catch {
                despawnHitboxEntity(ent);
                st.hitboxParts.delete(spec.key);
                ent = null;
            }
        }
        if (!ent) {
            try {
                ent = st.dim.spawnEntity(TimHitboxType, spec.pos);
                if (ent?.isValid) {
                    try { ent.triggerEvent(spec.sizeEvent); } catch { }
                    st.hitboxParts.set(spec.key, ent);
                    registerTimHitbox(ent, player, spec.key);
                }
            } catch { }
        }
    }
}


export function resetDetachedLimb(player) {
    if (!player?.isValid) return;
    syncTimCollisionBox(player, "normal");
    try { player.setProperty("property:tim_limb", 0); } catch { }
    try { player.setProperty("property:tim_detach", 0.0); } catch { }
    try { player.setProperty("property:tim_dx", 0.0); } catch { }
    try { player.setProperty("property:tim_dy", 0.0); } catch { }
    try { player.setProperty("property:tim_dz", 0.0); } catch { }
    try { player.setProperty("property:tim_dir_x", 0.0); } catch { }
    try { player.setProperty("property:tim_dir_y", -1.0); } catch { }
    try { player.setProperty("property:tim_dir_z", 0.0); } catch { }
    try { player.setProperty("property:tim_m1x", 0.0); } catch { }
    try { player.setProperty("property:tim_m1y", 0.0); } catch { }
    try { player.setProperty("property:tim_m1z", 0.0); } catch { }
    try { player.setProperty("property:tim_m2x", 0.0); } catch { }
    try { player.setProperty("property:tim_m2y", 0.0); } catch { }
    try { player.setProperty("property:tim_m2z", 0.0); } catch { }
}


world.afterEvents.playerSpawn.subscribe(({ player }) => {
    if (!player?.isValid) return;
    exitUnravelMode(player, "spawn", true);
    try { player.triggerEvent("xvoid:g"); } catch { }
    try { player.removeTag("tim_grapple"); } catch { }
    try { player.removeTag("tim_unravel"); } catch { }
    resetDetachedLimb(player);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    const st = unravelMoves.get(playerId);
    if (st) {
        cleanupUnravelHitboxes(st);
        unravelMoves.delete(playerId);
    }
    unravelJustExited.delete(playerId);
    playerHitboxMode.delete(playerId);
});


export function spawnRopeBeamSegment(dimension, a, b, thickness = 0.05, lifeSeconds = 0.08) {
    if (!dimension || !a || !b) return;

    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= 0.05) return;

    const map = new MolangVariableMap();
    map.setVector3("variable.dir", { x: dx / d, y: dy / d, z: dz / d });
    map.setFloat("variable.s_x", d * 0.51);
    map.setFloat("variable.s_y", thickness);
    map.setFloat("variable.life", lifeSeconds);

    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
    try {
        dimension.spawnParticle("tim:rope_segment", mid, map);
    } catch { }
}


export function createRopeBeam(dimension, start, end, options = {}) {
    if (!dimension || !start || !end) return;

    const thickness = options.thickness ?? 0.05;
    const life = options.life ?? 0.08;
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const len = Math.hypot(dx, dy, dz);
    if (len <= 0.15) return;

    const sag = options.sag ?? (len * 0.02);
    const segments = options.segments ?? (sag > 0.005
        ? Math.max(2, Math.min(8, Math.round(len * 0.6)))
        : Math.max(1, Math.min(8, Math.ceil(len / 3.5))));

    let prev = { ...start };
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const current = {
            x: start.x + dx * t,
            y: start.y + dy * t - Math.sin(t * Math.PI) * sag,
            z: start.z + dz * t
        };
        spawnRopeBeamSegment(dimension, prev, current, thickness, life);
        prev = current;
    }
}


function syncWorldTarget(player, targetWorldPos, detachProgress = 0.0, originPos = null) {
    if (!player?.isValid || !targetWorldPos) return;
    const pLoc = player.location;
    const centerOrigin = {
        x: pLoc.x,
        y: pLoc.y + 1.0547,
        z: pLoc.z
    };

    const dx = targetWorldPos.x - centerOrigin.x;
    const dy = targetWorldPos.y - centerOrigin.y;
    const dz = targetWorldPos.z - centerOrigin.z;
    const dist = Math.hypot(dx, dy, dz) || 0.001;

    let bx = dx / dist;
    let by = dy / dist;
    let bz = dz / dist;
    if (originPos) {
        const odx = centerOrigin.x - originPos.x;
        const ody = centerOrigin.y - originPos.y;
        const odz = centerOrigin.z - originPos.z;
        const originDist = Math.hypot(odx, ody, odz);
        if (originDist > 0.25) {
            bx = odx / originDist;
            by = ody / originDist;
            bz = odz / originDist;
        }
    }

    try {
        player.setProperty("property:tim_dx", clamp(dx, -64.0, 64.0));
        player.setProperty("property:tim_dy", clamp(dy, -64.0, 64.0));
        player.setProperty("property:tim_dz", clamp(dz, -64.0, 64.0));
        player.setProperty("property:tim_dir_x", clamp(bx, -1.0, 1.0));
        player.setProperty("property:tim_dir_y", clamp(by, -1.0, 1.0));
        player.setProperty("property:tim_dir_z", clamp(bz, -1.0, 1.0));
        player.setProperty("property:tim_detach", clamp(detachProgress, 0.0, 5.0));
    } catch { }
}


export function createRopeWrapVFX(dimension, entity, options = {}) {
    if (!dimension || !entity?.isValid) return;

    const lifeTicks = Number(options.lifeTicks ?? 4) || 4;
    const wraps = Number(options.wraps ?? 3) || 3;
    const radius = Number(options.radius ?? 0.65) || 0.65;
    const height = Number(options.height ?? 1.4) || 1.4;
    const thickness = Number(options.thickness ?? 0.08) || 0.08;
    const segments = 16;

    const loc = entity.location;

    const phase = (system.currentTick * 0.25) % (Math.PI * 2);
    const pointAt = (t) => ({
        x: loc.x + Math.cos(phase + t * Math.PI * 2 * wraps) * radius,
        y: loc.y + t * height + 0.15,
        z: loc.z + Math.sin(phase + t * Math.PI * 2 * wraps) * radius
    });

    let prev = pointAt(0);
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const next = pointAt(t);
        spawnRopeBeamSegment(dimension, prev, next, thickness, lifeTicks / 20);
        prev = next;
    }
}


export function getPlayerArmStump(player, side = "right") {
    const pLoc = player.location;
    const headLoc = player.getHeadLocation();
    const yawRad = (player.getRotation().y + 90) * (Math.PI / 180);
    const sign = (side === "left") ? -1 : 1;
    const sideX = -Math.sin(yawRad) * sign;
    const sideZ = Math.cos(yawRad) * sign;

    return {
        x: pLoc.x + sideX * 0.30,
        y: headLoc.y - 0.32,
        z: pLoc.z + sideZ * 0.30
    };
}


const activeMoves = new Map();

function isBusy(player) {
    return activeMoves.has(player.id) || unravelMoves.has(player.id);
}

function setCooldown(player, ticks = 10) {
    try {
        const cdObj = world.scoreboard.getObjective("cd");
        if (cdObj) cdObj.setScore(player, ticks);
    } catch { }
}

function finishMove(player, armSide, intervalId, cooldownTicks = 10, playerId = player?.id) {
    if (intervalId !== undefined) {
        system.clearRun(intervalId);
    }
    if (playerId) {
        activeMoves.delete(playerId);
    }

    if (player?.isValid) {
        try { player.removeTag("onSkill"); } catch { }
        try { player.removeTag("tim_grapple"); } catch { }
        try { player.triggerEvent("xvoid:g"); } catch { }
        resetDetachedLimb(player);
        setCooldown(player, cooldownTicks);
    }
}

function shouldAbortTimMove(player, expectedDim, allowStun = false) {
    if (!player?.isValid) return true;
    if (expectedDim && player.dimension !== expectedDim) return true;
    try {
        const hp = player.getComponent("minecraft:health");
        if (hp && hp.currentValue <= 0) return true;
    } catch { }
    try {
        const standObj = world.scoreboard.getObjective("standC");
        const sc = standObj?.getScore(player);
        if (sc !== undefined && sc !== 6) return true;
    } catch { }
    if (!allowStun) {
        try {
            const stunObj = world.scoreboard.getObjective("stun");
            if (stunObj && (stunObj.getScore(player) ?? 0) >= 2) return true;
        } catch { }
    }
    return false;
}


export function cancelZiplineGrapple(player, fromInput = false) {
    if (!player?.isValid) return false;
    const active = activeMoves.get(player.id);
    if (active && (active.type === "grapple" || active.type === "tether") && active.cancel) {
        return active.cancel(fromInput);
    }
    return false;
}


function checkBlockCollision(dimension, fromPos, direction, stepDistance) {
    try {
        const rayHit = raycastSolidBlock(dimension, fromPos, direction, stepDistance + 0.35);
        if (rayHit?.block && !isPassableBlock(rayHit.block)) {
            const bLoc = rayHit.block.location;
            const fLoc = rayHit.faceLocation;
            return {
                hit: true,
                block: rayHit.block,
                face: rayHit.face,
                point: {
                    x: bLoc.x + (fLoc?.x ?? 0.5),
                    y: bLoc.y + (fLoc?.y ?? 0.5),
                    z: bLoc.z + (fLoc?.z ?? 0.5)
                }
            };
        }
    } catch { }

    const targetPoint = {
        x: fromPos.x + direction.x * stepDistance,
        y: fromPos.y + direction.y * stepDistance,
        z: fromPos.z + direction.z * stepDistance
    };

    try {
        const b = dimension.getBlock(targetPoint);
        if (b && !isPassableBlock(b)) {
            return {
                hit: true,
                block: b,
                face: "Up",
                point: {
                    x: b.location.x + 0.5,
                    y: b.location.y + 0.5,
                    z: b.location.z + 0.5
                }
            };
        }
    } catch { }

    return { hit: false, point: targetPoint };
}


function pointToSegmentDistance(p, a, b) {
    const abX = b.x - a.x, abY = b.y - a.y, abZ = b.z - a.z;
    const apX = p.x - a.x, apY = p.y - a.y, apZ = p.z - a.z;
    const abLenSq = abX * abX + abY * abY + abZ * abZ;
    if (abLenSq <= 1e-6) return Math.hypot(apX, apY, apZ);
    const t = clamp((apX * abX + apY * abY + apZ * abZ) / abLenSq, 0.0, 1.0);
    const closestX = a.x + abX * t;
    const closestY = a.y + abY * t;
    const closestZ = a.z + abZ * t;
    return Math.hypot(p.x - closestX, p.y - closestY, p.z - closestZ);
}


export function fireLassoHook(player, anchorOnBlock = false) {
    if (!player?.isValid || isBusy(player)) return;

    const dim = player.dimension;
    let viewDir = player.getViewDirection();
    const stump = getPlayerArmStump(player, "right");

    if (anchorOnBlock) {
        try {
            const viewHit = raycastSolidBlock(dim, player.getHeadLocation(), viewDir, 28);
            if (viewHit?.block && !isPassableBlock(viewHit.block)) {
                const bLoc = viewHit.block.location;
                const fLoc = viewHit.faceLocation;
                const targetPt = {
                    x: bLoc.x + (fLoc?.x ?? 0.5),
                    y: bLoc.y + (fLoc?.y ?? 0.5),
                    z: bLoc.z + (fLoc?.z ?? 0.5)
                };
                const dx = targetPt.x - stump.x;
                const dy = targetPt.y - stump.y;
                const dz = targetPt.z - stump.z;
                const d = Math.hypot(dx, dy, dz) || 1;
                viewDir = { x: dx / d, y: dy / d, z: dz / d };
            }
        } catch { }
    }


    player.addTag("onSkill");

    try {
        player.playAnimation("animation.tim.lasso_windup");
        dim.playSound("xvoid.swing06", player.location, { volume: 0.9, pitch: 0.95 });
    } catch { }

    const speed = anchorOnBlock ? 2.2 : 1.7;
    const returnSpeed = 2.6;
    const maxRange = anchorOnBlock ? 28 : 18;
    let traveled = 0;
    let state = "windup";
    let windupTicks = 0;
    let anchoredTicks = 0;
    let latchTicks = 0;
    let pullTicks = 0;
    let latchedTarget = null;
    let isCancelled = false;
    let currentPos = { ...stump };

    const playerId = player.id;
    let intervalId;

    const cancel = () => {
        if (state !== "anchored") return false;
        state = "returning";
        isCancelled = true;
        try {
            dim.playSound("xvoid.swing10", currentPos, { volume: 0.9, pitch: 1.4 });
        } catch { }
        return true;
    };

    intervalId = system.runInterval(() => {
        try {
            if (shouldAbortTimMove(player, dim, state === "anchored")) {
                finishMove(player, "rightArm", intervalId, 6, playerId);
                return;
            }

            if (state === "windup") {
                windupTicks++;
                if (windupTicks >= 5) {

                    viewDir = player.getViewDirection();
                    const releaseStump = getPlayerArmStump(player, "right");
                    if (anchorOnBlock) {
                        try {
                            const viewHit = raycastSolidBlock(dim, player.getHeadLocation(), viewDir, 28);
                            if (viewHit?.block && !isPassableBlock(viewHit.block)) {
                                const bLoc = viewHit.block.location;
                                const fLoc = viewHit.faceLocation;
                                const targetPt = { x: bLoc.x + (fLoc?.x ?? 0.5), y: bLoc.y + (fLoc?.y ?? 0.5), z: bLoc.z + (fLoc?.z ?? 0.5) };
                                const d = Math.hypot(targetPt.x - releaseStump.x, targetPt.y - releaseStump.y, targetPt.z - releaseStump.z) || 1;
                                viewDir = { x: (targetPt.x - releaseStump.x) / d, y: (targetPt.y - releaseStump.y) / d, z: (targetPt.z - releaseStump.z) / d };
                            }
                        } catch { }
                    }
                    currentPos = {
                        x: releaseStump.x + viewDir.x * 0.9,
                        y: releaseStump.y + viewDir.y * 0.9,
                        z: releaseStump.z + viewDir.z * 0.9
                    };
                    try {
                        player.setProperty("property:tim_limb", 1);
                        dim.playSound("xvoid.swing08", releaseStump, { volume: 1.1, pitch: 1.3 });
                    } catch { }
                    syncWorldTarget(player, currentPos, 0.0, null);
                    state = "flying";
                }
                return;
            }

            const currentStump = getPlayerArmStump(player, "right");


            syncWorldTarget(player, currentPos, 0.0, null);
            const ropeLen = Math.hypot(currentPos.x - currentStump.x, currentPos.y - currentStump.y, currentPos.z - currentStump.z);
            if (ropeLen > 0.35) {
                createRopeBeam(dim, currentStump, currentPos, {
                    thickness: 0.048,
                    life: 0.08,
                    sag: state === "pulling" ? 0 : Math.min(0.45, ropeLen * 0.015)
                });
            }


            if (state === "flying") {
                const nextPos = {
                    x: currentPos.x + viewDir.x * speed,
                    y: currentPos.y + viewDir.y * speed,
                    z: currentPos.z + viewDir.z * speed
                };


                try {
                    const targets = dim.getEntities({ location: nextPos, maxDistance: 1.8 });
                    for (const t of targets) {
                        if (!t?.isValid || t.id === player.id) continue;
                        if (t.typeId === "xvoid:dmg" || t.typeId === "minecraft:item" || t.typeId === "minecraft:arrow") continue;


                        latchedTarget = t;
                        state = "latching";
                        latchTicks = 0;
                        currentPos = { x: t.location.x, y: t.location.y + 1.0, z: t.location.z };


                        try {
                            latchedTarget.runCommand("scoreboard players set @s stun 5");
                            dim.playSound("xvoid.swing08", nextPos, { volume: 1.2, pitch: 1.1 });
                        } catch { }


                        createRopeWrapVFX(dim, latchedTarget, { lifeTicks: 6, wraps: 3 });
                        return;
                    }
                } catch { }


                const blockCheck = checkBlockCollision(dim, currentPos, viewDir, speed);
                if (blockCheck.hit) {
                    currentPos = blockCheck.point;
                    if (anchorOnBlock) {
                        state = "anchored";
                        anchoredTicks = 0;

                        try { player.removeTag("onSkill"); } catch { }
                        try {
                            dim.playSound("xvoid.swing10", currentPos, { volume: 1.1, pitch: 1.3 });
                            dim.playSound("dig.wood", currentPos, { volume: 1.0, pitch: 1.2 });
                        } catch { }
                    } else {
                        state = "returning";
                        try {
                            dim.playSound("xvoid.swing10", currentPos, { volume: 0.8, pitch: 1.4 });
                        } catch { }
                    }
                    return;
                }

                currentPos = nextPos;
                traveled += speed;
                if (traveled >= maxRange) {
                    state = "returning";
                }
            }


            else if (state === "anchored") {
                anchoredTicks++;
                const tetherDist = Math.hypot(
                    currentPos.x - currentStump.x,
                    currentPos.y - currentStump.y,
                    currentPos.z - currentStump.z
                );


                if (tetherDist > 34 || anchoredTicks >= 240) {
                    state = "returning";
                    return;
                }


                try {
                    const midPt = {
                        x: (currentStump.x + currentPos.x) * 0.5,
                        y: (currentStump.y + currentPos.y) * 0.5,
                        z: (currentStump.z + currentPos.z) * 0.5
                    };
                    const candidates = dim.getEntities({
                        location: midPt,
                        maxDistance: (tetherDist * 0.5) + 1.5
                    });
                    for (const t of candidates) {
                        if (!t?.isValid || t.id === player.id) continue;
                        if (t.typeId === "xvoid:dmg" || t.typeId === "minecraft:item" || t.typeId === "minecraft:arrow" || t.typeId === "minecraft:xp_orb") continue;

                        const entCenter = { x: t.location.x, y: t.location.y + 0.9, z: t.location.z };
                        const segDist = pointToSegmentDistance(entCenter, currentStump, currentPos);
                        if (segDist < 0.85) {

                            latchedTarget = t;
                            state = "latching";
                            latchTicks = 0;
                            currentPos = { x: t.location.x, y: t.location.y + 1.0, z: t.location.z };
                            try { player.addTag("onSkill"); } catch { }
                            try {
                                latchedTarget.runCommand("scoreboard players set @s stun 6");
                                dim.playSound("xvoid.swing08", currentPos, { volume: 1.3, pitch: 1.1 });
                            } catch { }
                            createRopeWrapVFX(dim, latchedTarget, { lifeTicks: 6, wraps: 3 });
                            return;
                        }
                    }
                } catch { }
            }


            else if (state === "returning") {
                const toStumpX = currentStump.x - currentPos.x;
                const toStumpY = currentStump.y - currentPos.y;
                const toStumpZ = currentStump.z - currentPos.z;
                const dist = Math.hypot(toStumpX, toStumpY, toStumpZ);

                if (dist <= returnSpeed + 0.5) {
                    finishMove(player, "rightArm", intervalId, isCancelled ? 4 : 8);
                    return;
                }

                currentPos = {
                    x: currentPos.x + (toStumpX / dist) * returnSpeed,
                    y: currentPos.y + (toStumpY / dist) * returnSpeed,
                    z: currentPos.z + (toStumpZ / dist) * returnSpeed
                };
            }


            else if (state === "latching") {
                if (!latchedTarget?.isValid) {
                    state = "returning";
                    return;
                }

                const tLoc = latchedTarget.location;
                currentPos = { x: tLoc.x, y: tLoc.y + 1.1, z: tLoc.z };


                createRopeWrapVFX(dim, latchedTarget, { lifeTicks: 4, wraps: 3 });

                latchTicks++;
                if (latchTicks >= 5) {
                    state = "pulling";
                    pullTicks = 0;
                    try { dim.playSound("xvoid.swing10", player.location, { volume: 1.2, pitch: 1.0 }); } catch { }
                }
            }


            else if (state === "pulling") {
                if (!latchedTarget?.isValid) {
                    finishMove(player, "rightArm", intervalId, 10);
                    return;
                }

                pullTicks++;
                const headLoc = player.getHeadLocation();
                const tLoc = latchedTarget.location;
                const pView = player.getViewDirection();


                const dest = {
                    x: headLoc.x + pView.x * 2.0,
                    y: headLoc.y + pView.y * 2.0 - 0.75,
                    z: headLoc.z + pView.z * 2.0
                };

                const dx = dest.x - tLoc.x;
                const dy = dest.y - tLoc.y;
                const dz = dest.z - tLoc.z;
                const dist3D = Math.hypot(dx, dy, dz);
                const distH = Math.hypot(dx, dz);

                currentPos = { x: tLoc.x, y: tLoc.y + 1.1, z: tLoc.z };


                createRopeWrapVFX(dim, latchedTarget, { lifeTicks: 4, wraps: 3 });


                try { latchedTarget.runCommand("scoreboard players set @s stun 2"); } catch { }


                if (dist3D <= 2.0 || (distH <= 1.4 && Math.abs(dy) <= 1.5) || pullTicks >= 20) {
                    try { latchedTarget.applyKnockback({ x: 0, z: 0 }, 0); } catch { }
                    finishMove(player, "rightArm", intervalId, 10);
                    return;
                }


                if (pullTicks % 2 === 0) {
                    const dirX = dx / (distH || 1);
                    const dirZ = dz / (distH || 1);
                    const pullPower = Math.min(1.8, Math.max(0.4, distH * 0.35));


                    let verticalForce;
                    if (dy > 0.4) {

                        verticalForce = Math.min(1.4, Math.max(0.35, Math.sqrt(dy * 0.18) + 0.15));
                    } else if (dy < -0.5) {

                        verticalForce = Math.max(-0.4, dy * 0.2);
                    } else {

                        verticalForce = 0.22;
                    }

                    if (!latchedTarget.hasTag("tusk_detached") && !latchedTarget.hasTag("tusk_spatial") && !latchedTarget.hasTag("tusk_rotation")) {
                        try {
                            latchedTarget.applyKnockback(
                                { x: dirX * pullPower, z: dirZ * pullPower },
                                verticalForce
                            );
                        } catch { }
                    }
                }
            }
        } catch {
            finishMove(player, "rightArm", intervalId, 6, playerId);
        }
    }, 1);

    activeMoves.set(player.id, { type: anchorOnBlock ? "tether" : "hook", intervalId, cancel });
}


function isBlockPassable(block) {
    return isPassableBlock(block);
}

function getBlockTopInfo(dim, anchorPos, anchorBlock, anchorEntity) {
    if (anchorEntity) {
        return { isTopClear: false, blockTopY: anchorPos.y, topCenterX: anchorPos.x, topCenterZ: anchorPos.z, ledgeOffset: 0 };
    }
    let bX, bY, bZ;
    if (anchorBlock?.isValid) {
        bX = anchorBlock.location.x;
        bY = anchorBlock.location.y;
        bZ = anchorBlock.location.z;
    } else {
        bX = Math.floor(anchorPos.x);
        bY = Math.floor(anchorPos.y - 0.01);
        bZ = Math.floor(anchorPos.z);
    }

    let blockTopY = bY + 1.0;
    let isTopClear = false;
    let ledgeOffset = 0;
    try {
        const b1 = dim.getBlock({ x: bX, y: bY + 1, z: bZ });
        const b2 = dim.getBlock({ x: bX, y: bY + 2, z: bZ });
        if (isBlockPassable(b1) && isBlockPassable(b2)) {
            isTopClear = true;
            blockTopY = bY + 1.0;
            ledgeOffset = 0;
        } else if (!isBlockPassable(b1) && isBlockPassable(b2)) {

            const b3 = dim.getBlock({ x: bX, y: bY + 3, z: bZ });
            if (isBlockPassable(b3)) {
                isTopClear = true;
                blockTopY = bY + 2.0;
                ledgeOffset = 1;
            }
        }
    } catch { }
    return {
        isTopClear,
        blockTopY,
        topCenterX: bX + 0.5,
        topCenterZ: bZ + 0.5,
        ledgeOffset
    };
}

function getSafeDestChest(anchorPos, anchorFace, dir, isEntity, topInfo = null, isGroundHit = false) {
    if (isEntity) {
        return {
            x: anchorPos.x - dir.x * 1.1,
            y: anchorPos.y + 0.25,
            z: anchorPos.z - dir.z * 1.1
        };
    }


    let nx = 0, ny = 0, nz = 0;
    if (anchorFace === "North" || anchorFace === "north" || anchorFace === 2) nz = -1;
    else if (anchorFace === "South" || anchorFace === "south" || anchorFace === 3) nz = 1;
    else if (anchorFace === "West" || anchorFace === "west" || anchorFace === 4) nx = -1;
    else if (anchorFace === "East" || anchorFace === "east" || anchorFace === 5) nx = 1;
    else if (anchorFace === "Up" || anchorFace === "up" || anchorFace === 1) ny = 1;
    else if (anchorFace === "Down" || anchorFace === "down" || anchorFace === 0) ny = -1;
    else {

        const len = Math.hypot(dir.x, dir.z) || 1;
        nx = -dir.x / len;
        nz = -dir.z / len;
    }


    if (ny > 0.5) {
        if (!isGroundHit && topInfo) {
            return {
                x: topInfo.topCenterX,
                y: topInfo.blockTopY + 1.85,
                z: topInfo.topCenterZ
            };
        }
        return {
            x: anchorPos.x,
            y: anchorPos.y + 1.25,
            z: anchorPos.z
        };
    }


    if (ny < -0.5) {
        return {
            x: anchorPos.x,
            y: anchorPos.y - 1.25,
            z: anchorPos.z
        };
    }


    const canLedgeClimb = !isGroundHit && topInfo?.isTopClear && (
        topInfo.ledgeOffset === 0
            ? anchorPos.y >= topInfo.blockTopY - 1.1
            : (anchorPos.y >= topInfo.blockTopY - 2.1 && dir.y >= -0.35)
    );
    const chestY = canLedgeClimb
        ? Math.max(anchorPos.y, topInfo.blockTopY + 0.15)
        : anchorPos.y;
    return {
        x: anchorPos.x + nx * 0.95,
        y: chestY,
        z: anchorPos.z + nz * 0.95
    };
}


function applyLineGuidedPull(player, originCenter, endCenter, targetSpeed) {
    const pLoc = player.location;
    const curCenter = { x: pLoc.x, y: pLoc.y + 1.0547, z: pLoc.z };
    const lineX = endCenter.x - originCenter.x;
    const lineY = endCenter.y - originCenter.y;
    const lineZ = endCenter.z - originCenter.z;
    const lineLen = Math.hypot(lineX, lineY, lineZ) || 1;
    const ux = lineX / lineLen;
    const uy = lineY / lineLen;
    const uz = lineZ / lineLen;

    const dot = (curCenter.x - originCenter.x) * ux
        + (curCenter.y - originCenter.y) * uy
        + (curCenter.z - originCenter.z) * uz;
    const proj = clamp(dot, 0, lineLen);
    const nextDist = Math.min(lineLen, proj + targetSpeed);

    const aimCenter = {
        x: originCenter.x + ux * nextDist,
        y: originCenter.y + uy * nextDist,
        z: originCenter.z + uz * nextDist
    };

    const dx = aimCenter.x - curCenter.x;
    const dy = aimCenter.y - curCenter.y;
    const dz = aimCenter.z - curCenter.z;
    const moveLen = Math.hypot(dx, dy, dz) || 1;
    const effSpeed = Math.min(targetSpeed, moveLen);

    const nx = dx / moveLen;
    const ny = dy / moveLen;
    const nz = dz / moveLen;
    const horizScale = effSpeed * 1.15;
    const vertImpulse = clamp(ny * effSpeed * 0.85, -1.45, 1.45);

    try {
        player.clearVelocity?.();
        player.applyKnockback(
            { x: nx * horizScale, z: nz * horizScale },
            vertImpulse
        );
    } catch { }
}

export function fireZiplineGrapple(player) {
    if (!player?.isValid || isBusy(player)) return;

    const dim = player.dimension;
    let viewDir = player.getViewDirection();
    const stump = getPlayerArmStump(player, "left");


    player.addTag("onSkill");
    player.addTag("tim_grapple");

    try {
        player.playAnimation("animation.tim.grapple_windup");
        dim.playSound("xvoid.swing06", stump, { volume: 1, pitch: 1.1 });
    } catch { }

    const speed = 2.4;
    const returnSpeed = 3.4;
    let flightTicks = 0;
    const maxFlightTicks = 10;
    let state = "windup";
    let windupTicks = 0;
    let anchorPos = null;
    let anchorBlock = null;
    let anchorFace = null;
    let anchorEntity = null;
    let destChest = null;
    let originPos = null;
    let detachProgress = 0.0;
    let isGroundHit = false;
    let pauseTicksLeft = 0;
    let zipTicks = 0;
    let pullTicks = 0;
    let recallTicks = 0;
    const totalRecallTicks = 5;
    let stallTicks = 0;
    let lastLoc = null;
    let isCancelled = false;
    let currentPos = { ...stump };

    const playerId = player.id;
    let intervalId;

    const cancel = (fromInput = false) => {
        if (state === "returning") return false;
        if (fromInput && state === "windup") return false;
        if (state === "recalling") {
            finishMove(player, "leftArm", intervalId, 0, playerId);
            return true;
        }
        if (state === "windup") {
            finishMove(player, "leftArm", intervalId, 0, playerId);
            return true;
        }
        try { player.triggerEvent("xvoid:g"); } catch { }
        syncTimCollisionBox(player, "normal");
        try { player.setProperty("property:tim_detach", 0.0); } catch { }
        try { player.setProperty("property:tim_limb", 2); } catch { }
        state = "returning";
        anchorEntity = null;
        detachProgress = 0.0;
        isCancelled = true;
        try {
            dim.playSound("xvoid.swing10", currentPos, { volume: 0.9, pitch: 1.5 });
        } catch { }
        return true;
    };

    intervalId = system.runInterval(() => {
        try {
            if (shouldAbortTimMove(player, dim, false)) {
                finishMove(player, "leftArm", intervalId, 6, playerId);
                return;
            }

            if (state === "windup") {
                windupTicks++;
                if (windupTicks >= 4) {
                    viewDir = player.getViewDirection();
                    const releaseStump = getPlayerArmStump(player, "left");
                    currentPos = {
                        x: releaseStump.x + viewDir.x * 0.9,
                        y: releaseStump.y + viewDir.y * 0.9,
                        z: releaseStump.z + viewDir.z * 0.9
                    };
                    try {
                        player.setProperty("property:tim_limb", 2);
                        dim.playSound("xvoid.swing08", releaseStump, { volume: 1.1, pitch: 1.3 });
                    } catch { }
                    syncWorldTarget(player, currentPos, 0.0, null);
                    state = "flying";
                }
                return;
            }

            const currentStump = getPlayerArmStump(player, "left");


            if (anchorEntity) {
                if (!anchorEntity.isValid) {
                    if (state === "grappling" || state === "body_pulling") {
                        finishMove(player, "leftArm", intervalId, 6, playerId);
                        return;
                    } else {
                        state = "returning";
                        anchorEntity = null;
                    }
                } else {
                    anchorPos = {
                        x: anchorEntity.location.x,
                        y: anchorEntity.location.y + 1.0,
                        z: anchorEntity.location.z
                    };
                    if (state === "latching" || state === "grappling") {
                        currentPos = anchorPos;
                    }
                    if (state === "grappling") {
                        const pLoc = player.location;
                        const dx = anchorPos.x - pLoc.x;
                        const dy = anchorPos.y - (pLoc.y + 1.25);
                        const dz = anchorPos.z - pLoc.z;
                        const d = Math.hypot(dx, dy, dz) || 1;
                        destChest = getSafeDestChest(anchorPos, null, { x: dx / d, y: dy / d, z: dz / d }, true);
                    }
                }
            }

            if (state === "grappling" || state === "body_pulling" || (state === "returning" && detachProgress > 0 && destChest)) {
                const targetPos = anchorPos ?? currentPos;
                syncWorldTarget(player, targetPos, detachProgress, originPos);
                const pLoc = player.location;
                const centerPos = { x: pLoc.x, y: pLoc.y + 1.0547, z: pLoc.z };
                const ropeStart = {
                    x: currentStump.x + (centerPos.x - currentStump.x) * detachProgress,
                    y: currentStump.y + (centerPos.y - currentStump.y) * detachProgress,
                    z: currentStump.z + (centerPos.z - currentStump.z) * detachProgress
                };
                createRopeBeam(dim, ropeStart, targetPos, { thickness: 0.052, life: 0.08, sag: 0 });
                if (originPos) {
                    const origLen = Math.hypot(centerPos.x - originPos.x, centerPos.y - originPos.y, centerPos.z - originPos.z);
                    if (origLen > 0.25) {
                        createRopeBeam(dim, originPos, centerPos, { thickness: 0.048, life: 0.08, sag: 0 });
                    }
                }
            } else if (state !== "recalling") {
                syncWorldTarget(player, currentPos, 0.0, null);
                createRopeBeam(dim, currentStump, currentPos, { thickness: 0.048, life: 0.08, sag: 0 });
            }


            if (state === "flying") {
                flightTicks++;


                let hitEntity = null;
                let bestEntityProj = Infinity;
                try {
                    const sampleLoc = {
                        x: currentPos.x + viewDir.x * (speed * 0.5),
                        y: currentPos.y + viewDir.y * (speed * 0.5),
                        z: currentPos.z + viewDir.z * (speed * 0.5)
                    };
                    const targets = dim.getEntities({ location: sampleLoc, maxDistance: speed * 0.6 + 1.5 });
                    for (const t of targets) {
                        if (!t?.isValid || t.id === player.id) continue;
                        if (t.typeId === "xvoid:dmg" || t.typeId === "minecraft:item" || t.typeId === "minecraft:arrow" || t.typeId === "minecraft:xp_orb" || t.typeId === "jjba:steelball" || t.typeId === "jjba:knife" || t.typeId === "jjba:nail") continue;

                        const tLoc = t.location;
                        const toEntX = tLoc.x - currentPos.x;
                        const toEntY = (tLoc.y + 0.9) - currentPos.y;
                        const toEntZ = tLoc.z - currentPos.z;
                        const proj = toEntX * viewDir.x + toEntY * viewDir.y + toEntZ * viewDir.z;
                        if (proj < 0 || proj > speed + 0.6) continue;
                        const distSq = toEntX * toEntX + toEntY * toEntY + toEntZ * toEntZ;
                        const perpSq = distSq - (proj * proj);
                        if (perpSq <= 1.8 * 1.8) {
                            if (proj < bestEntityProj) {
                                bestEntityProj = proj;
                                hitEntity = t;
                            }
                        }
                    }
                } catch { }


                const blockCheck = checkBlockCollision(dim, currentPos, viewDir, speed);
                const blockDist = blockCheck.hit ? Math.hypot(blockCheck.point.x - currentPos.x, blockCheck.point.y - currentPos.y, blockCheck.point.z - currentPos.z) : Infinity;

                if (hitEntity && bestEntityProj <= blockDist) {

                    anchorEntity = hitEntity;
                    anchorPos = { x: hitEntity.location.x, y: hitEntity.location.y + 1.0, z: hitEntity.location.z };
                    anchorBlock = null;
                    anchorFace = null;
                    isGroundHit = false;
                    currentPos = anchorPos;
                    state = "latching";
                    pauseTicksLeft = 2;

                    try {
                        anchorEntity.runCommand("scoreboard players set @s stun 6");
                        dim.playSound("xvoid.swing10", anchorPos, { volume: 1.3, pitch: 1.3 });
                        dim.playSound("random.orb", anchorPos, { volume: 0.9, pitch: 1.2 });
                    } catch { }

                    createRopeWrapVFX(dim, anchorEntity, { lifeTicks: 6, wraps: 3 });
                    return;
                }

                if (blockCheck.hit) {
                    anchorEntity = null;
                    anchorPos = blockCheck.point;
                    anchorBlock = blockCheck.block;
                    anchorFace = blockCheck.face;
                    currentPos = anchorPos;
                    state = "latching";

                    const pLoc = player.location;
                    const toAnchorY = anchorPos.y - pLoc.y;

                    isGroundHit = (anchorFace === "Up" || anchorFace === "up" || anchorFace === 1) && (toAnchorY <= 0.8);

                    if (isGroundHit) {

                        pauseTicksLeft = 1;
                        try {
                            dim.playSound("xvoid.swing10", anchorPos, { volume: 1.2, pitch: 1.4 });
                        } catch { }
                        return;
                    }


                    const d = Math.hypot(anchorPos.x - pLoc.x, anchorPos.y - pLoc.y, anchorPos.z - pLoc.z);
                    pauseTicksLeft = Math.max(1, Math.min(3, Math.round(d * 0.15)));

                    try {
                        dim.playSound("xvoid.swing10", anchorPos, { volume: 1.3, pitch: 1.3 });
                        dim.playSound("dig.wood", anchorPos, { volume: 1.2, pitch: 1.2 });
                    } catch { }
                    return;
                }

                currentPos = blockCheck.point;
                if (flightTicks >= maxFlightTicks) {
                    state = "returning";
                }
            }


            else if (state === "returning") {
                if (detachProgress > 0) {
                    detachProgress = Math.max(0, detachProgress - 0.55);
                    if (detachProgress <= 0) {
                        try { player.setProperty("property:tim_detach", 0.0); } catch { }
                    }
                    return;
                }

                const toStumpX = currentStump.x - currentPos.x;
                const toStumpY = currentStump.y - currentPos.y;
                const toStumpZ = currentStump.z - currentPos.z;
                const dist = Math.hypot(toStumpX, toStumpY, toStumpZ);

                if (dist <= returnSpeed + 0.5) {

                    finishMove(player, "leftArm", intervalId, isCancelled ? 0 : 8, playerId);
                    return;
                }

                currentPos = {
                    x: currentPos.x + (toStumpX / dist) * returnSpeed,
                    y: currentPos.y + (toStumpY / dist) * returnSpeed,
                    z: currentPos.z + (toStumpZ / dist) * returnSpeed
                };
            }


            else if (state === "latching") {
                try { player.applyKnockback({ x: 0, z: 0 }, 0); } catch { }

                if (anchorEntity) {
                    createRopeWrapVFX(dim, anchorEntity, { lifeTicks: 4, wraps: 3 });
                }

                pauseTicksLeft--;
                if (pauseTicksLeft <= 0) {
                    const pLoc = player.location;
                    if (!originPos) {
                        originPos = { x: pLoc.x, y: pLoc.y + 1.0547, z: pLoc.z };
                    }
                    const adx = anchorPos.x - pLoc.x;
                    const ady = anchorPos.y - (pLoc.y + 1.0547);
                    const adz = anchorPos.z - pLoc.z;
                    const aDist = Math.hypot(adx, ady, adz) || 1;
                    const topInfo = getBlockTopInfo(dim, anchorPos, anchorBlock, anchorEntity);
                    destChest = getSafeDestChest(
                        anchorPos,
                        anchorFace,
                        { x: adx / aDist, y: ady / aDist, z: adz / aDist },
                        Boolean(anchorEntity),
                        topInfo,
                        isGroundHit
                    );


                    state = "body_pulling";
                    pullTicks = 0;
                    detachProgress = 0.0;
                    try {
                        player.triggerEvent("xvoid:ng");
                        player.clearVelocity?.();
                        player.setProperty("property:tim_limb", 3);
                        syncTimCollisionBox(player, "small");
                        player.setProperty("property:tim_detach", 0.0);
                        dim.playSound("xvoid.swing06", player.location, { volume: 1.2, pitch: 1.1 });
                    } catch { }
                }
            }


            else if (state === "body_pulling") {
                pullTicks++;

                const pLoc = player.location;


                detachProgress = Math.min(1.0, pullTicks / 4.0);
                syncWorldTarget(player, anchorPos ?? currentPos, detachProgress, originPos);


                applyLineGuidedPull(player, originPos, destChest, 0.65 + 0.55 * (pullTicks / 4.0));

                if (pullTicks >= 4) {

                    state = "grappling";
                    zipTicks = 0;
                    stallTicks = 0;
                    lastLoc = { x: pLoc.x, y: pLoc.y, z: pLoc.z };
                    try {
                        dim.playSound("xvoid.swing06", player.location, { volume: 1.2, pitch: 1.3 });
                    } catch { }
                }
            }


            else if (state === "grappling") {
                zipTicks++;

                const pLoc = player.location;
                const targetFeet = {
                    x: destChest.x,
                    y: destChest.y - 1.0547,
                    z: destChest.z
                };
                const toAnchorX = targetFeet.x - pLoc.x;
                const toAnchorY = targetFeet.y - pLoc.y;
                const toAnchorZ = targetFeet.z - pLoc.z;
                const distH = Math.hypot(toAnchorX, toAnchorZ) || 0.001;
                const remDist = Math.hypot(toAnchorX, toAnchorY, toAnchorZ);


                detachProgress = remDist < 2.0 ? Math.max(0.0, remDist / 2.0) : 1.0;
                syncWorldTarget(player, anchorPos ?? currentPos, detachProgress, originPos);

                if (anchorEntity) {
                    createRopeWrapVFX(dim, anchorEntity, { lifeTicks: 4, wraps: 3 });
                    try { anchorEntity.runCommand("scoreboard players set @s stun 4"); } catch { }
                }


                if (lastLoc) {
                    const moved = Math.hypot(pLoc.x - lastLoc.x, pLoc.y - lastLoc.y, pLoc.z - lastLoc.z);
                    if (moved < 0.08) stallTicks++;
                    else stallTicks = 0;
                }
                lastLoc = { x: pLoc.x, y: pLoc.y, z: pLoc.z };

                const topInfo = getBlockTopInfo(dim, anchorPos, anchorBlock, anchorEntity);
                const isTopFace = !anchorEntity && (anchorFace === "Up" || anchorFace === "up" || anchorFace === 1);
                const isCeilingFace = !anchorEntity && (anchorFace === "Down" || anchorFace === "down" || anchorFace === 0);
                const blockTopY = topInfo.blockTopY;
                const heightDiff = blockTopY - pLoc.y;
                const distToTopH = Math.hypot(topInfo.topCenterX - pLoc.x, topInfo.topCenterZ - pLoc.z);
                const isClimbableLedge = !anchorEntity && !isCeilingFace && topInfo.isTopClear && heightDiff >= 0.05 && heightDiff <= 2.05;


                const hasReachedDestination = (isTopFace && !isGroundHit)
                    ? ((distToTopH < 0.95 && pLoc.y >= blockTopY - 0.25) || (stallTicks >= 2 && distToTopH < 2.2))
                    : (remDist < 1.35 || (!anchorEntity && distH < 1.5 && isClimbableLedge && heightDiff <= 1.35) || (stallTicks >= 2 && distH < 2.5));

                if (hasReachedDestination || zipTicks >= 50) {

                    try {
                        player.triggerEvent("xvoid:g");
                        player.clearVelocity?.();
                        syncTimCollisionBox(player, "normal");
                        player.setProperty("property:tim_limb", 0);
                        player.setProperty("property:tim_detach", 0.0);
                    } catch { }

                    if (anchorEntity) {
                        const dirH = distH || 1;
                        player.applyKnockback(
                            { x: (toAnchorX / dirH) * 0.45, z: (toAnchorZ / dirH) * 0.45 },
                            0.26
                        );
                        dim.playSound("xvoid.swing06", player.location, { volume: 1.2, pitch: 1.2 });
                        dim.playSound("step.cloth", player.location, { volume: 1.0, pitch: 1.1 });
                        finishMove(player, "leftArm", intervalId, 8);
                        return;
                    }

                    if (isClimbableLedge) {
                        const toTopX = topInfo.topCenterX - pLoc.x;
                        const toTopZ = topInfo.topCenterZ - pLoc.z;
                        const toTopH = Math.hypot(toTopX, toTopZ) || 1;
                        const climbH = Math.min(0.62, Math.max(0.32, distToTopH * 0.35));
                        const climbV = Math.min(0.72, Math.max(0.45, 0.42 + heightDiff * 0.14));

                        player.applyKnockback(
                            { x: (toTopX / toTopH) * climbH, z: (toTopZ / toTopH) * climbH },
                            climbV
                        );
                        dim.playSound("step.stone", player.location, { volume: 0.8, pitch: 1.2 });
                    } else if (isTopFace && !isGroundHit && distToTopH > 0.2) {
                        const toTopX = topInfo.topCenterX - pLoc.x;
                        const toTopZ = topInfo.topCenterZ - pLoc.z;
                        const toTopH = Math.hypot(toTopX, toTopZ) || 1;
                        const settleH = Math.min(0.35, distToTopH * 0.28);
                        player.applyKnockback(
                            { x: (toTopX / toTopH) * settleH, z: (toTopZ / toTopH) * settleH },
                            0.08
                        );
                    } else {

                        try {
                            player.applyKnockback(
                                { x: (toAnchorX / (remDist || 1)) * 0.25, z: (toAnchorZ / (remDist || 1)) * 0.25 },
                                0.15
                            );
                        } catch { }
                    }


                    if (originPos) {
                        state = "recalling";
                        recallTicks = 0;
                        try {
                            player.setProperty("property:tim_limb", 0);
                            dim.playSound("xvoid.swing10", player.location, { volume: 1.2, pitch: 1.4 });
                            dim.playSound("step.cloth", player.location, { volume: 1.0, pitch: 1.1 });
                        } catch { }
                        return;
                    }

                    finishMove(player, "leftArm", intervalId, 10, playerId);
                    return;
                }

                if (remDist > 0.25 || (isTopFace && !isGroundHit && distToTopH > 0.35)) {
                    const advance = Math.min(1.85, Math.max(0.95, remDist * 0.28));
                    const pullEnd = (isTopFace && !isGroundHit && pLoc.y < blockTopY + 0.15 && distToTopH < 3.0)
                        ? { x: destChest.x, y: Math.max(destChest.y, blockTopY + 2.2), z: destChest.z }
                        : destChest;
                    applyLineGuidedPull(player, originPos, pullEnd, advance);
                }
            }


            else if (state === "recalling") {
                recallTicks++;
                const progress = Math.min(1.0, recallTicks / totalRecallTicks);
                const farEnd = {
                    x: originPos.x + (currentStump.x - originPos.x) * progress,
                    y: originPos.y + (currentStump.y - originPos.y) * progress,
                    z: originPos.z + (currentStump.z - originPos.z) * progress
                };
                createRopeBeam(dim, currentStump, farEnd, { thickness: 0.048, life: 0.08, sag: 0 });

                if (recallTicks >= totalRecallTicks) {

                    try {
                        dim.playSound("random.orb", player.location, { volume: 0.8, pitch: 1.5 });
                    } catch { }
                    finishMove(player, "leftArm", intervalId, 10, playerId);
                    return;
                }
            }
        } catch {
            finishMove(player, "leftArm", intervalId, 6, playerId);
        }
    }, 1);

    activeMoves.set(player.id, { type: "grapple", intervalId, cancel });
}


const UnravelMaxRange = 16.0;
const UnravelMinRange = 0.75;
const UnravelMoveSpeed = 0.48;
const UnravelEntryEnergy = 12;
const UnravelMaxTicks = 800;
const UnravelRecallSpeed = 1.65;
const UnravelTwoHandedGuns = new Set(["xvoid:tommy_gun", "xvoid:shotgun"]);
const UnravelAllGuns = new Set(["xvoid:revolver", "xvoid:tommy_gun", "xvoid:shotgun"]);

const UnravelMeleeDamage = {
    "minecraft:netherite_sword": 9,
    "minecraft:diamond_sword": 8,
    "minecraft:iron_sword": 7,
    "minecraft:copper_sword": 6,
    "minecraft:stone_sword": 6,
    "minecraft:golden_sword": 5,
    "minecraft:wooden_sword": 5,
    "minecraft:trident": 9,
    "minecraft:mace": 7,
    "minecraft:netherite_axe": 8,
    "minecraft:diamond_axe": 7,
    "minecraft:iron_axe": 6,
    "minecraft:stone_axe": 5,
    "minecraft:golden_axe": 4,
    "minecraft:wooden_axe": 4,
    "minecraft:netherite_pickaxe": 6,
    "minecraft:diamond_pickaxe": 5,
    "minecraft:iron_pickaxe": 4,
    "minecraft:netherite_shovel": 5,
    "minecraft:diamond_shovel": 4,
    "jjba:stand": 4,
};

function computeUnravelMeleeStats(player, held) {
    const heldId = held?.typeId ?? "";
    let baseDamage = UnravelMeleeDamage[heldId] ?? 2;
    let sharpBonus = 0;
    let smiteLvl = 0;
    let boaLvl = 0;
    let fireAspectLvl = 0;
    let knockbackLvl = 0;

    try {
        const ench = held?.getComponent("minecraft:enchantable");
        if (ench) {
            for (const e of ench.getEnchantments()) {
                const eid = e.type?.id ?? "";
                const lvl = e.level ?? 0;
                if (eid === "sharpness") sharpBonus += lvl * 1.25;
                else if (eid === "smite") smiteLvl += lvl;
                else if (eid === "bane_of_arthropods") boaLvl += lvl;
                else if (eid === "fire_aspect") fireAspectLvl += lvl;
                else if (eid === "knockback") knockbackLvl += lvl;
            }
        }
    } catch { }

    let effectBonus = 0;
    try {
        const str = player.getEffect("strength");
        if (str) effectBonus += (str.amplifier + 1) * 3;
        const weak = player.getEffect("weakness");
        if (weak) effectBonus -= (weak.amplifier + 1) * 4;
    } catch { }

    return {
        heldId,
        baseDamage: Math.max(1, baseDamage + sharpBonus + effectBonus),
        smiteLvl,
        boaLvl,
        fireAspectLvl,
        knockbackLvl,
    };
}

const unravelMoves = new Map();
const unravelJustExited = new Map();

export function isTimUnraveled(player) {
    return Boolean(player?.isValid && unravelMoves.has(player.id));
}

export function getTimDetachedShootOrigin(player) {
    if (!player?.isValid) return null;
    const st = unravelMoves.get(player.id);
    if (!st) return null;
    if (st.lastAimInfo?.muzzle) {
        return { x: st.lastAimInfo.muzzle.x, y: st.lastAimInfo.muzzle.y, z: st.lastAimInfo.muzzle.z };
    }
    const view = player.getViewDirection();
    return {
        x: st.armPos.x + view.x * 0.45,
        y: st.armPos.y + view.y * 0.45,
        z: st.armPos.z + view.z * 0.45,
    };
}

export function getTimDetachedShootDir(player) {
    if (!player?.isValid) return null;
    const st = unravelMoves.get(player.id);
    if (!st) return null;
    if (st.lastAimInfo?.shootDir) {
        return { x: st.lastAimInfo.shootDir.x, y: st.lastAimInfo.shootDir.y, z: st.lastAimInfo.shootDir.z };
    }
    return player.getViewDirection();
}

function getScore(entity, objectiveId) {
    try {
        return world.scoreboard.getObjective(objectiveId)?.getScore(entity) ?? 0;
    } catch {
        return 0;
    }
}

function isArmSpaceBlocked(dim, pos) {
    const offsets = [
        { x: 0, y: 0, z: 0 },
        { x: 0.22, y: 0, z: 0 }, { x: -0.22, y: 0, z: 0 },
        { x: 0, y: 0.22, z: 0 }, { x: 0, y: -0.22, z: 0 },
        { x: 0, y: 0, z: 0.22 }, { x: 0, y: 0, z: -0.22 },
    ];
    for (const o of offsets) {
        try {
            const b = dim.getBlock({
                x: Math.floor(pos.x + o.x),
                y: Math.floor(pos.y + o.y),
                z: Math.floor(pos.z + o.z),
            });
            if (b && !isPassableBlock(b)) return true;
        } catch {
            return true;
        }
    }
    return false;
}

const RopeNodeRadius = 0.16;
const RopeMaxSegLen = 0.65;
const RopeMinPairLen = 0.42;
const RopeMaxNodes = 42;

function isBlockVoxelPassable(dim, vx, vy, vz) {
    try {
        const b = dim.getBlock({ x: vx, y: vy, z: vz });
        return !b || isPassableBlock(b);
    } catch {
        return false;
    }
}

function isRopeCornerBlocked(dim, pos, radius = RopeNodeRadius) {
    const minX = Math.floor(pos.x - radius), maxX = Math.floor(pos.x + radius);
    const minY = Math.floor(pos.y - radius), maxY = Math.floor(pos.y + radius);
    const minZ = Math.floor(pos.z - radius), maxZ = Math.floor(pos.z + radius);
    for (let vx = minX; vx <= maxX; vx++) {
        for (let vy = minY; vy <= maxY; vy++) {
            for (let vz = minZ; vz <= maxZ; vz++) {
                if (!isBlockVoxelPassable(dim, vx, vy, vz)) return true;
            }
        }
    }
    return false;
}


function pushNodeOutOfSolidBlocks(dim, pos, radius = RopeNodeRadius) {
    const cur = { x: pos.x, y: pos.y, z: pos.z };
    for (let iter = 0; iter < 3; iter++) {
        let moved = false;
        const minX = Math.floor(cur.x - radius), maxX = Math.floor(cur.x + radius);
        const minY = Math.floor(cur.y - radius), maxY = Math.floor(cur.y + radius);
        const minZ = Math.floor(cur.z - radius), maxZ = Math.floor(cur.z + radius);
        for (let vx = minX; vx <= maxX; vx++) {
            for (let vy = minY; vy <= maxY; vy++) {
                for (let vz = minZ; vz <= maxZ; vz++) {
                    if (isBlockVoxelPassable(dim, vx, vy, vz)) continue;
                    const x0 = vx - radius, x1 = vx + 1 + radius;
                    const y0 = vy - radius, y1 = vy + 1 + radius;
                    const z0 = vz - radius, z1 = vz + 1 + radius;
                    if (cur.x <= x0 || cur.x >= x1 || cur.y <= y0 || cur.y >= y1 || cur.z <= z0 || cur.z >= z1) continue;

                    const candidates = [
                        { axis: "x", val: x0, d: cur.x - x0, open: isBlockVoxelPassable(dim, vx - 1, vy, vz) },
                        { axis: "x", val: x1, d: x1 - cur.x, open: isBlockVoxelPassable(dim, vx + 1, vy, vz) },
                        { axis: "y", val: y0, d: cur.y - y0, open: isBlockVoxelPassable(dim, vx, vy - 1, vz) },
                        { axis: "y", val: y1, d: y1 - cur.y, open: isBlockVoxelPassable(dim, vx, vy + 1, vz) },
                        { axis: "z", val: z0, d: cur.z - z0, open: isBlockVoxelPassable(dim, vx, vy, vz - 1) },
                        { axis: "z", val: z1, d: z1 - cur.z, open: isBlockVoxelPassable(dim, vx, vy, vz + 1) },
                    ];
                    let best = null;
                    for (const c of candidates) {
                        if (!c.open) continue;
                        if (!best || c.d < best.d) best = c;
                    }
                    if (!best) {
                        for (const c of candidates) {
                            if (!best || c.d < best.d) best = c;
                        }
                    }
                    if (best) {
                        cur[best.axis] = best.val + (best.val < vx + 0.5 ? -0.005 : 0.005);
                        moved = true;
                    }
                }
            }
        }
        if (!moved) break;
    }
    return cur;
}

function hasClearRopeLine(dim, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist <= 0.22) return true;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    try {
        const hit = raycastSolidBlock(dim, a, dir, dist);
        if (hit?.block && !isPassableBlock(hit.block)) {
            const pt = resolveBlockHitPoint(a, dir, hit);
            const hDist = Math.hypot(pt.x - a.x, pt.y - a.y, pt.z - a.z);
            if (hDist < dist - 0.1) return false;
        }
    } catch { }
    return true;
}

function lerpVec(a, b, t) {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
    };
}

function findNearestPassableVoxel(dim, pos) {
    const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
    if (isBlockVoxelPassable(dim, bx, by, bz)) return { x: bx, y: by, z: bz };
    const deltas = [
        [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
        [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
    ];
    let best = null;
    let bestD = Infinity;
    for (const [dx, dy, dz] of deltas) {
        const vx = bx + dx, vy = by + dy, vz = bz + dz;
        if (!isBlockVoxelPassable(dim, vx, vy, vz)) continue;
        const d = Math.hypot(vx + 0.5 - pos.x, vy + 0.5 - pos.y, vz + 0.5 - pos.z);
        if (d < bestD) {
            bestD = d;
            best = { x: vx, y: vy, z: vz };
        }
    }
    return best;
}

const VoxelDirs = [];
for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
            const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            if (m === 1 || m === 2) {
                VoxelDirs.push({ dx, dy, dz, cost: m === 1 ? 1.0 : 1.4142 });
            }
        }
    }
}


function findClearVoxelPath3D(dim, startPt, goalPt) {
    const sv = findNearestPassableVoxel(dim, startPt);
    const gv = findNearestPassableVoxel(dim, goalPt);
    if (!sv || !gv) return null;

    const vKey = (x, y, z) => `${x},${y},${z}`;
    const startKey = vKey(sv.x, sv.y, sv.z);
    const goalKey = vKey(gv.x, gv.y, gv.z);
    if (startKey === goalKey) return [];

    const pad = 6;
    const minX = Math.min(sv.x, gv.x) - pad, maxX = Math.max(sv.x, gv.x) + pad;
    const minY = Math.min(sv.y, gv.y) - 5, maxY = Math.max(sv.y, gv.y) + pad;
    const minZ = Math.min(sv.z, gv.z) - pad, maxZ = Math.max(sv.z, gv.z) + pad;

    const passCache = new Map();
    const canEnter = (x, y, z) => {
        if (x < minX || x > maxX || y < minY || y > maxY || z < minZ || z > maxZ) return false;
        const k = vKey(x, y, z);
        if (passCache.has(k)) return passCache.get(k);
        const ok = isBlockVoxelPassable(dim, x, y, z);
        passCache.set(k, ok);
        return ok;
    };

    const gScore = new Map([[startKey, 0]]);
    const parent = new Map();
    const coords = new Map([[startKey, sv]]);
    const closed = new Set();
    const heap = [{ key: startKey, f: Math.hypot(gv.x - sv.x, gv.y - sv.y, gv.z - sv.z) }];

    const heapPush = (item) => {
        heap.push(item);
        let idx = heap.length - 1;
        while (idx > 0) {
            const p = (idx - 1) >> 1;
            if (heap[p].f <= heap[idx].f) break;
            [heap[p], heap[idx]] = [heap[idx], heap[p]];
            idx = p;
        }
    };
    const heapPop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length > 0) {
            heap[0] = last;
            let idx = 0;
            const n = heap.length;
            while (true) {
                let best = idx;
                const l = idx * 2 + 1, r = l + 1;
                if (l < n && heap[l].f < heap[best].f) best = l;
                if (r < n && heap[r].f < heap[best].f) best = r;
                if (best === idx) break;
                [heap[idx], heap[best]] = [heap[best], heap[idx]];
                idx = best;
            }
        }
        return top;
    };

    let expansions = 0;
    let found = false;
    while (heap.length > 0 && expansions < 650) {
        const cur = heapPop();
        if (closed.has(cur.key)) continue;
        if (cur.key === goalKey) {
            found = true;
            break;
        }
        closed.add(cur.key);
        expansions++;

        const cPos = coords.get(cur.key);
        const cg = gScore.get(cur.key) ?? 0;

        for (const d of VoxelDirs) {
            const nx = cPos.x + d.dx, ny = cPos.y + d.dy, nz = cPos.z + d.dz;
            if (!canEnter(nx, ny, nz)) continue;

            if (Math.abs(d.dx) + Math.abs(d.dy) + Math.abs(d.dz) === 2) {
                if (d.dx !== 0 && !canEnter(cPos.x + d.dx, cPos.y, cPos.z)) continue;
                if (d.dy !== 0 && !canEnter(cPos.x, cPos.y + d.dy, cPos.z)) continue;
                if (d.dz !== 0 && !canEnter(cPos.x, cPos.y, cPos.z + d.dz)) continue;
            }
            const nk = vKey(nx, ny, nz);
            if (closed.has(nk)) continue;
            const ng = cg + d.cost;
            if (ng < (gScore.get(nk) ?? Infinity)) {
                gScore.set(nk, ng);
                parent.set(nk, cur.key);
                coords.set(nk, { x: nx, y: ny, z: nz });
                const h = Math.hypot(gv.x - nx, gv.y - ny, gv.z - nz);
                heapPush({ key: nk, f: ng + h * 1.05 });
            }
        }
    }

    if (!found) return null;

    const rawPts = [];
    let k = goalKey;
    while (k && k !== startKey) {
        const c = coords.get(k);
        rawPts.push(pushNodeOutOfSolidBlocks(dim, { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }));
        k = parent.get(k);
    }
    rawPts.push(pushNodeOutOfSolidBlocks(dim, { x: sv.x + 0.5, y: sv.y + 0.5, z: sv.z + 0.5 }));
    rawPts.reverse();


    const full = [startPt, ...rawPts, goalPt];
    const pulled = [startPt];
    let anchorIdx = 0;
    while (anchorIdx < full.length - 1) {
        let furthest = anchorIdx + 1;
        for (let j = full.length - 1; j > anchorIdx + 1; j--) {
            if (hasClearRopeLine(dim, full[anchorIdx], full[j])) {
                furthest = j;
                break;
            }
        }
        pulled.push(full[furthest]);
        anchorIdx = furthest;
    }
    return pulled.slice(1, pulled.length - 1);
}

function getUnravelRopeNodes(st) {
    if (!Array.isArray(st.ropeNodes) || st.ropeNodes.length < 2) {
        return [st.anchorCenter, st.armPos];
    }
    return st.ropeNodes;
}

function computeUnravelRopeLength(st) {
    const nodes = getUnravelRopeNodes(st);
    let total = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
        total += Math.hypot(
            nodes[i + 1].x - nodes[i].x,
            nodes[i + 1].y - nodes[i].y,
            nodes[i + 1].z - nodes[i].z
        );
    }
    return total;
}

function computeUnravelMaxChordDeviation(st) {
    const nodes = getUnravelRopeNodes(st);
    if (nodes.length <= 2) return 0;
    const a = nodes[0];
    const b = nodes[nodes.length - 1];
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const abLenSq = abx * abx + aby * aby + abz * abz;
    if (abLenSq < 1e-4) return 0;
    let maxD = 0;
    for (let i = 1; i < nodes.length - 1; i++) {
        const p = nodes[i];
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / abLenSq));
        const px = a.x + abx * t, py = a.y + aby * t, pz = a.z + abz * t;
        const d = Math.hypot(p.x - px, p.y - py, p.z - pz);
        if (d > maxD) maxD = d;
    }
    return maxD;
}


function updateUnravelRopePath(dim, st) {
    if (!Array.isArray(st.ropeNodes) || st.ropeNodes.length < 2) {
        st.ropeNodes = [{ ...st.anchorCenter }, { ...st.armPos }];
    }
    const nodes = st.ropeNodes;
    nodes[0] = { x: st.anchorCenter.x, y: st.anchorCenter.y, z: st.anchorCenter.z };
    nodes[nodes.length - 1] = { x: st.armPos.x, y: st.armPos.y, z: st.armPos.z };


    let repairs = 0;
    for (let i = 0; i < nodes.length - 1 && repairs < 2 && nodes.length < RopeMaxNodes - 2; i++) {
        if (!hasClearRopeLine(dim, nodes[i], nodes[i + 1])) {
            const wp = findClearVoxelPath3D(dim, nodes[i], nodes[i + 1]);
            if (wp && wp.length > 0) {
                const room = RopeMaxNodes - nodes.length;
                const ins = wp.slice(0, Math.max(1, room));
                nodes.splice(i + 1, 0, ...ins);
                i += ins.length;
                repairs++;
            }
        }
    }


    for (let pass = 0; pass < 4 && nodes.length < RopeMaxNodes; pass++) {
        let added = false;
        for (let i = 0; i < nodes.length - 1 && nodes.length < RopeMaxNodes; i++) {
            const d = Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y, nodes[i + 1].z - nodes[i].z);
            if (d > RopeMaxSegLen) {
                let mid = lerpVec(nodes[i], nodes[i + 1], 0.5);
                if (isRopeCornerBlocked(dim, mid)) {
                    mid = pushNodeOutOfSolidBlocks(dim, mid);
                }
                nodes.splice(i + 1, 0, mid);
                i++;
                added = true;
            }
        }
        if (!added) break;
    }


    for (let pass = 0; pass < 6; pass++) {
        for (let i = 1; i < nodes.length - 1; i++) {
            const prev = nodes[i - 1];
            const next = nodes[i + 1];
            const cur = nodes[i];
            const target = lerpVec(prev, next, 0.5);
            if (Math.hypot(target.x - cur.x, target.y - cur.y, target.z - cur.z) < 0.008) continue;

            const segOkBefore = hasClearRopeLine(dim, prev, cur) && hasClearRopeLine(dim, cur, next);
            const candidates = [
                pushNodeOutOfSolidBlocks(dim, target),
                pushNodeOutOfSolidBlocks(dim, lerpVec(cur, target, 0.5)),
                pushNodeOutOfSolidBlocks(dim, { x: target.x, y: cur.y, z: cur.z }),
                pushNodeOutOfSolidBlocks(dim, { x: cur.x, y: target.y, z: cur.z }),
                pushNodeOutOfSolidBlocks(dim, { x: cur.x, y: cur.y, z: target.z }),
            ];

            for (const cand of candidates) {
                if (isRopeCornerBlocked(dim, cand, RopeNodeRadius * 0.7)) continue;
                if (!segOkBefore || (hasClearRopeLine(dim, prev, cand) && hasClearRopeLine(dim, cand, next))) {
                    nodes[i] = cand;
                    break;
                }
            }
        }
    }


    for (let i = nodes.length - 2; i >= 1 && nodes.length > 2; i--) {
        const d1 = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y, nodes[i].z - nodes[i - 1].z);
        const d2 = Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y, nodes[i + 1].z - nodes[i].z);
        if (d1 + d2 < RopeMinPairLen && hasClearRopeLine(dim, nodes[i - 1], nodes[i + 1])) {
            nodes.splice(i, 1);
        }
    }

    st.isBent = computeUnravelMaxChordDeviation(st) >= 0.35;
}

function renderUnravelRopePolyline(dim, st) {
    const raw = getUnravelRopeNodes(st);
    if (raw.length < 2) return;


    const drawNodes = [raw[0]];
    for (let i = 1; i < raw.length - 1; i++) {
        const a = drawNodes[drawNodes.length - 1];
        const b = raw[i];
        const c = raw[i + 1];
        const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
        const acLenSq = acx * acx + acy * acy + acz * acz;
        if (acLenSq > 1e-4) {
            const t = Math.max(0, Math.min(1, ((b.x - a.x) * acx + (b.y - a.y) * acy + (b.z - a.z) * acz) / acLenSq));
            const dev = Math.hypot(b.x - (a.x + acx * t), b.y - (a.y + acy * t), b.z - (a.z + acz * t));
            if (dev < 0.045) continue;
        }
        drawNodes.push(b);
    }
    drawNodes.push(raw[raw.length - 1]);

    const hasBends = drawNodes.length > 2;
    for (let i = 0; i < drawNodes.length - 1; i++) {
        const a = drawNodes[i];
        const b = drawNodes[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= 0.08) continue;
        const pad = hasBends ? Math.min(0.038, d * 0.15) : 0;
        const sa = pad > 0 ? { x: a.x - (dx / d) * pad, y: a.y - (dy / d) * pad, z: a.z - (dz / d) * pad } : a;
        const sb = pad > 0 ? { x: b.x + (dx / d) * pad, y: b.y + (dy / d) * pad, z: b.z + (dz / d) * pad } : b;
        createRopeBeam(dim, sa, sb, {
            thickness: 0.048,
            life: 0.08,
            sag: 0,
        });
    }
}


function dragUnraveledBodyTowardArm(player, st) {
    const totalLen = computeUnravelRopeLength(st);
    if (totalLen <= UnravelMaxRange) return;

    const nodes = getUnravelRopeNodes(st);
    let firstTarget = nodes[nodes.length - 1];
    for (let i = nodes.length - 1; i >= 1; i--) {
        if (Math.hypot(nodes[i].x - st.anchorCenter.x, nodes[i].y - st.anchorCenter.y, nodes[i].z - st.anchorCenter.z) > 0.35 &&
            hasClearRopeLine(st.dim, st.anchorCenter, nodes[i])) {
            firstTarget = nodes[i];
            break;
        }
    }
    const dx = firstTarget.x - st.anchorCenter.x;
    const dy = firstTarget.y - st.anchorCenter.y;
    const dz = firstTarget.z - st.anchorCenter.z;
    const distFirst = Math.hypot(dx, dy, dz);
    if (distFirst < 1e-4) return;

    const excess = totalLen - UnravelMaxRange;
    const horiz = Math.hypot(dx, dz);
    if (horiz > 0.25) {
        const pull = Math.min(0.85, 0.28 + excess * 0.35);
        try {
            player.applyKnockback({ x: (dx / horiz) * pull, z: (dz / horiz) * pull }, 0);
        } catch { }
    }


    const maxSlack = UnravelMaxRange + 1.0;
    if (totalLen > maxSlack && nodes.length >= 2) {
        const lastPivot = nodes[nodes.length - 2];
        const ldx = st.armPos.x - lastPivot.x;
        const ldy = st.armPos.y - lastPivot.y;
        const ldz = st.armPos.z - lastPivot.z;
        const lastLen = Math.hypot(ldx, ldy, ldz);
        const over = totalLen - maxSlack;
        if (lastLen > over + 0.2) {
            const s = (lastLen - over) / lastLen;
            const pulled = {
                x: lastPivot.x + ldx * s,
                y: lastPivot.y + ldy * s,
                z: lastPivot.z + ldz * s,
            };
            if (!isArmSpaceBlocked(st.dim, pulled)) {
                st.armPos = pulled;
                nodes[nodes.length - 1] = { ...pulled };
            }
        }
    }
}

function clampMinUnravelRange(pos, anchorCenter) {
    const dx = pos.x - anchorCenter.x;
    const dy = pos.y - anchorCenter.y;
    const dz = pos.z - anchorCenter.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < UnravelMinRange && dist > 1e-4) {
        const s = UnravelMinRange / dist;
        return {
            x: anchorCenter.x + dx * s,
            y: anchorCenter.y + dy * s,
            z: anchorCenter.z + dz * s,
        };
    }
    return pos;
}

function stepFreeAirArm(player, dim, st, mv, view, rotY) {
    const yawRad = (rotY * Math.PI) / 180;
    const rightH = { x: -Math.cos(yawRad), y: 0, z: -Math.sin(yawRad) };

    const moveVec = {
        x: view.x * mv.y - rightH.x * mv.x,
        y: view.y * mv.y,
        z: view.z * mv.y - rightH.z * mv.x,
    };
    const moveLen = Math.hypot(moveVec.x, moveVec.y, moveVec.z);
    if (moveLen > 0.05) {
        const scale = (UnravelMoveSpeed * Math.min(1, moveLen)) / moveLen;
        let cur = { x: st.armPos.x, y: st.armPos.y, z: st.armPos.z };

        const tryAxis = (axis, delta) => {
            if (Math.abs(delta) < 1e-4) return;
            const step = { x: cur.x, y: cur.y, z: cur.z };
            step[axis] += delta;
            if (!isArmSpaceBlocked(dim, step)) {
                cur = step;
            }
        };

        tryAxis("x", moveVec.x * scale);
        tryAxis("y", moveVec.y * scale);
        tryAxis("z", moveVec.z * scale);

        const minClamped = st.isBent ? cur : clampMinUnravelRange(cur, st.anchorCenter);
        if (!isArmSpaceBlocked(dim, minClamped)) {
            st.armPos = minClamped;
        }
    }

    updateUnravelRopePath(dim, st);
    dragUnraveledBodyTowardArm(player, st);
}

function computeUnravelCameraPos(dim, player, st, view) {
    const yawRad = (player.getRotation().y * Math.PI) / 180;
    const rightH = { x: -Math.cos(yawRad), y: 0, z: -Math.sin(yawRad) };
    const idealOffset = {
        x: -view.x * 2.15 + rightH.x * 0.42,
        y: -view.y * 2.15 + 0.42,
        z: -view.z * 2.15 + rightH.z * 0.42,
    };
    const offsetLen = Math.hypot(idealOffset.x, idealOffset.y, idealOffset.z) || 1;
    const camDir = {
        x: idealOffset.x / offsetLen,
        y: idealOffset.y / offsetLen,
        z: idealOffset.z / offsetLen,
    };

    let dist = offsetLen;
    try {
        const wall = raycastSolidBlock(dim, st.armPos, camDir, offsetLen + 0.35);
        if (wall?.block && !isPassableBlock(wall.block)) {
            const hx = wall.block.x + (wall.faceLocation?.x ?? 0.5) - st.armPos.x;
            const hy = wall.block.y + (wall.faceLocation?.y ?? 0.5) - st.armPos.y;
            const hz = wall.block.z + (wall.faceLocation?.z ?? 0.5) - st.armPos.z;
            dist = Math.max(0.45, Math.hypot(hx, hy, hz) - 0.3);
        }
    } catch { }

    const camPos = {
        x: st.armPos.x + camDir.x * dist,
        y: st.armPos.y + camDir.y * dist,
        z: st.armPos.z + camDir.z * dist,
    };


    const pLoc = player.location;
    const pdx = camPos.x - pLoc.x;
    const pdz = camPos.z - pLoc.z;
    const pHoriz = Math.hypot(pdx, pdz);
    if (pHoriz < 1.25 && camPos.y >= pLoc.y - 0.35 && camPos.y <= pLoc.y + 2.05) {
        if (pHoriz > 0.05) {
            const push = 1.25 / pHoriz;
            camPos.x = pLoc.x + pdx * push;
            camPos.z = pLoc.z + pdz * push;
        } else {
            camPos.y = pLoc.y + 2.15;
        }
    }
    return camPos;
}

function sampleRopePolylineByFrac(nodes, frac) {
    if (!Array.isArray(nodes) || nodes.length === 0) return { x: 0, y: 0, z: 0 };
    if (nodes.length === 1 || frac <= 0) return nodes[0];
    if (frac >= 1) return nodes[nodes.length - 1];

    const cum = [0];
    let total = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
        total += Math.hypot(
            nodes[i + 1].x - nodes[i].x,
            nodes[i + 1].y - nodes[i].y,
            nodes[i + 1].z - nodes[i].z
        );
        cum.push(total);
    }
    if (total <= 1e-4) return nodes[0];

    const target = total * frac;
    for (let i = 0; i < nodes.length - 1; i++) {
        if (target <= cum[i + 1] || i === nodes.length - 2) {
            const segLen = cum[i + 1] - cum[i];
            const t = segLen > 1e-4 ? clamp((target - cum[i]) / segLen, 0, 1) : 0;
            return {
                x: nodes[i].x + (nodes[i + 1].x - nodes[i].x) * t,
                y: nodes[i].y + (nodes[i + 1].y - nodes[i].y) * t,
                z: nodes[i].z + (nodes[i + 1].z - nodes[i].z) * t,
            };
        }
    }
    return nodes[nodes.length - 1];
}

function syncUnravelTarget(player, anchorCenter, armPos, aimDir, isBent = false, ropeNodes = null) {
    const dx = armPos.x - anchorCenter.x;
    const dy = armPos.y - anchorCenter.y;
    const dz = armPos.z - anchorCenter.z;
    const nodes = Array.isArray(ropeNodes) && ropeNodes.length >= 2 ? ropeNodes : [anchorCenter, armPos];
    const m1 = sampleRopePolylineByFrac(nodes, 0.35);
    const m2 = sampleRopePolylineByFrac(nodes, 0.70);
    try {
        player.setProperty("property:tim_dx", clamp(dx, -64.0, 64.0));
        player.setProperty("property:tim_dy", clamp(dy, -64.0, 64.0));
        player.setProperty("property:tim_dz", clamp(dz, -64.0, 64.0));
        player.setProperty("property:tim_dir_x", clamp(aimDir.x, -1.0, 1.0));
        player.setProperty("property:tim_dir_y", clamp(aimDir.y, -1.0, 1.0));
        player.setProperty("property:tim_dir_z", clamp(aimDir.z, -1.0, 1.0));
        player.setProperty("property:tim_detach", isBent ? 2.0 : 1.0);
        player.setProperty("property:tim_m1x", clamp(m1.x - anchorCenter.x, -64.0, 64.0));
        player.setProperty("property:tim_m1y", clamp(m1.y - anchorCenter.y, -64.0, 64.0));
        player.setProperty("property:tim_m1z", clamp(m1.z - anchorCenter.z, -64.0, 64.0));
        player.setProperty("property:tim_m2x", clamp(m2.x - anchorCenter.x, -64.0, 64.0));
        player.setProperty("property:tim_m2y", clamp(m2.y - anchorCenter.y, -64.0, 64.0));
        player.setProperty("property:tim_m2z", clamp(m2.z - anchorCenter.z, -64.0, 64.0));
    } catch { }
}

function triggerUnravelMelee(player, st, view) {
    if (system.currentTick - st.lastMeleeTick < 4) return;
    st.lastMeleeTick = system.currentTick;

    const inv = player.getComponent("minecraft:inventory")?.container;
    const held = inv?.getItem(player.selectedSlotIndex);
    const heldId = held?.typeId ?? "";
    if (UnravelAllGuns.has(heldId)) return;

    const aimDir = st.lastAimInfo?.shootDir ?? view;
    const dim = player.dimension;
    const origin = {
        x: st.armPos.x + aimDir.x * 0.45,
        y: st.armPos.y + aimDir.y * 0.45,
        z: st.armPos.z + aimDir.z * 0.45,
    };
    const sweepEnd = {
        x: origin.x + aimDir.x * 2.5,
        y: origin.y + aimDir.y * 2.5,
        z: origin.z + aimDir.z * 2.5,
    };

    try {
        dim.playSound("xvoid.swing06", origin, { volume: 0.9, pitch: 1.25 });
        spawnRopeBeamSegment(dim, origin, sweepEnd, 0.04, 0.08);
    } catch { }

    const melee = computeUnravelMeleeStats(player, held);
    const hitSet = new Map();


    const locked = st.lastAimInfo?.hitEntity;
    if (locked?.isValid && locked.id !== player.id) {
        const lLoc = locked.location;
        const dArm = Math.hypot(lLoc.x - st.armPos.x, (lLoc.y + 0.9) - st.armPos.y, lLoc.z - st.armPos.z);
        if (dArm <= 5.2) {
            hitSet.set(locked.id, locked);
        }
    }

    try {
        for (const rayHit of dim.getEntitiesFromRay(origin, aimDir, { maxDistance: 4.4 })) {
            const e = rayHit.entity;
            if (!e?.isValid || e.id === player.id || isOwnTimHitbox(player, e)) continue;
            if (e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb" || e.typeId === "xvoid:dmg" || e.typeId === "xvoid:impact_frame" || e.typeId === "xvoid:frozen_rain" || e.hasTag("non_target")) continue;
            const resolved = getTimHitboxOwner(e) ?? e;
            if (resolved.id === player.id) continue;
            hitSet.set(resolved.id, resolved);
        }
    } catch { }

    try {
        const probe = { x: origin.x + aimDir.x * 1.5, y: origin.y + aimDir.y * 1.5, z: origin.z + aimDir.z * 1.5 };
        for (const e of dim.getEntities({ location: probe, maxDistance: 1.6 })) {
            if (!e?.isValid || e.id === player.id || isOwnTimHitbox(player, e)) continue;
            if (e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb" || e.typeId === "xvoid:dmg" || e.typeId === "xvoid:impact_frame" || e.typeId === "xvoid:frozen_rain" || e.hasTag("non_target")) continue;
            const resolved = getTimHitboxOwner(e) ?? e;
            if (resolved.id === player.id || hitSet.has(resolved.id)) continue;
            const hp = resolved.getComponent("minecraft:health");
            if (!hp || hp.currentValue <= 0) continue;
            hitSet.set(resolved.id, resolved);
        }
    } catch { }

    let landed = 0;
    for (const target of hitSet.values()) {
        try {
            let targetDmg = melee.baseDamage;
            try {
                const fam = target.getComponent("minecraft:type_family");
                if (melee.smiteLvl > 0 && fam?.hasTypeFamily("undead")) targetDmg += melee.smiteLvl * 2.5;
                if (melee.boaLvl > 0 && fam?.hasTypeFamily("arthropod")) targetDmg += melee.boaLvl * 2.5;
            } catch { }

            applyHitscanDamage(player, target, targetDmg, {
                originPos: origin,
                originViewDir: aimDir,
            });
            if (melee.fireAspectLvl > 0) {
                try { target.setOnFire(melee.fireAspectLvl * 4, true); } catch { }
            }
            if (!target.hasTag("blocking") && !target.hasTag("tusk_detached") && !target.hasTag("tusk_spatial") && !target.hasTag("tusk_rotation") && !target.hasTag("tim_unravel")) {
                const baseKb = heldId.includes("sword") || heldId.includes("axe") ? 0.42 : 0.34;
                const kbScale = baseKb + melee.knockbackLvl * 0.35;
                target.applyKnockback({ x: aimDir.x * kbScale, z: aimDir.z * kbScale }, 0.22);
            }
            const tLoc = target.location;
            dim.spawnParticle("minecraft:critical_hit_emitter", { x: tLoc.x, y: tLoc.y + 1.0, z: tLoc.z });
            landed++;
            if (landed >= (heldId.includes("sword") ? 3 : 1)) break;
        } catch { }
    }
    if (landed > 0) {
        try { dim.playSound("random.hurt", origin, { volume: 0.7, pitch: 1.0 }); } catch { }
    }
}

function clearUnravelCamera(player) {
    if (!player?.isValid) return;
    try { player.camera.clear(); } catch { }
    try { player.runCommand("camera @s clear"); } catch { }
}

function finalizeUnravelExit(player, st, reason = "reattach", silent = false) {
    if (!player?.isValid) return false;
    const pid = player.id;
    cleanupUnravelHitboxes(st);
    unravelMoves.delete(pid);
    unravelJustExited.set(pid, system.currentTick + 10);

    clearUnravelCamera(player);

    for (const delay of [1, 2, 6]) {
        system.runTimeout(() => {
            if (player?.isValid && !unravelMoves.has(pid)) {
                clearUnravelCamera(player);
            }
        }, delay);
    }

    try { player.runCommand("inputpermission set @s jump enabled"); } catch { }
    try { player.removeTag("tim_unravel"); } catch { }
    try { player.removeTag("chargeT"); } catch { }
    try { player.removeTag("chargeM"); } catch { }
    try { player.removeTag("chargeTB"); } catch { }
    try { player.removeTag("chargeMB"); } catch { }
    try { player.removeTag("chargeTSB"); } catch { }
    try { player.removeTag("chargeMSB"); } catch { }
    try { player.triggerEvent("xvoid:kb_normal"); } catch { }
    try { player.runCommand("effect @s slowness 0"); } catch { }
    resetDetachedLimb(player);

    if (!silent) {
        const dim = player.dimension;
        try {
            if (st?.anchorCenter && st?.armPos) {
                createRopeBeam(dim, st.anchorCenter, st.armPos, { thickness: 0.055, life: 0.14, sag: 0 });
            }
            dim.playSound("xvoid.swing10", player.location, { volume: 1.1, pitch: 1.35 });
            dim.playSound("step.cloth", player.location, { volume: 1.0, pitch: 1.1 });
        } catch { }
        setCooldown(player, 10);
    }
    return true;
}

export function exitUnravelMode(player, reason = "reattach", silent = false) {
    if (!player?.isValid) return false;
    const st = unravelMoves.get(player.id);
    if (!st) return false;


    if (silent || reason === "abort" || reason === "spawn") {
        return finalizeUnravelExit(player, st, reason, silent);
    }


    if (!st.recalling) {
        st.recalling = true;
        st.recallTicks = 0;
        st.recallReason = reason;
        try {
            const dim = player.dimension;
            dim.playSound("xvoid.swing08", st.armPos ?? st.anchorCenter, { volume: 0.9, pitch: 1.45 });
            dim.playSound("step.cloth", st.anchorCenter, { volume: 0.9, pitch: 1.25 });
        } catch { }
    }
    return true;
}

function isJumpInput(player) {
    try {
        if (player.inputInfo?.getButtonState?.(InputButton.Jump) === ButtonState.Pressed) return true;
    } catch { }
    try {
        if (player.isJumping) return true;
    } catch { }
    return getScore(player, "jump") > 0;
}

export function startUnravelMode(player) {
    if (!player?.isValid) return;
    if (unravelMoves.has(player.id)) {
        const st = unravelMoves.get(player.id);
        if (st && st.graceTicks <= 0) {
            exitUnravelMode(player, "reattach");
        }
        return;
    }
    if (isTimeStopped() || player.hasTag("tsed")) return;
    if (isBusy(player)) return;
    if (getScore(player, "cd") > 0) return;
    if (getEnergy(player) < UnravelEntryEnergy) {
        return;
    }

    useEnergy(player, UnravelEntryEnergy, 15);

    const dim = player.dimension;
    const savedBodyPos = { x: player.location.x, y: player.location.y, z: player.location.z };
    const anchorCenter = { x: savedBodyPos.x, y: savedBodyPos.y + 1.0547, z: savedBodyPos.z };
    const view = player.getViewDirection();


    let armPos = {
        x: anchorCenter.x + view.x * 1.15,
        y: Math.max(savedBodyPos.y + 0.65, anchorCenter.y + 0.15 + view.y * 0.9),
        z: anchorCenter.z + view.z * 1.15,
    };
    if (isArmSpaceBlocked(dim, armPos)) {
        armPos = { x: anchorCenter.x, y: savedBodyPos.y + 1.35, z: anchorCenter.z };
    }

    const st = {
        dim,
        savedBodyPos,
        anchorCenter,
        armPos,
        ropeNodes: [{ ...anchorCenter }, { ...armPos }],
        isBent: false,
        ticks: 0,
        graceTicks: 8,
        recalling: false,
        recallTicks: 0,
        recallReason: "reattach",
        recallTarget: null,
        reelingToArm: false,
        reelTicks: 0,
        releasedSneakAfterEntry: !player.isSneaking,
        releasedJumpAfterEntry: !isJumpInput(player),
        lastAimInfo: null,
        lastMeleeTick: -10,
        lastWarnTick: -100,
    };
    unravelMoves.set(player.id, st);

    try {
        player.addTag("tim_unravel");
        player.removeTag("chargeTSB");
        player.removeTag("chargeMSB");
        player.setProperty("property:tim_limb", 4);
        player.triggerEvent("xvoid:kb_normal");
        player.runCommand("inputpermission set @s jump disabled");
        player.runCommand("effect @s slowness 1 255 true");
        dim.playSound("xvoid.swing08", anchorCenter, { volume: 1.15, pitch: 1.15 });
        dim.playSound("step.cloth", anchorCenter, { volume: 1.1, pitch: 0.9 });
        syncUnravelTarget(player, anchorCenter, armPos, view, false, st.ropeNodes);
    } catch { }
}


system.runInterval(() => {
    for (const [playerId, st] of unravelMoves) {
        const player = world.getPlayers().find((p) => p.id === playerId);
        if (!player?.isValid) {
            unravelMoves.delete(playerId);
            continue;
        }
        if (player.hasTag("tsed") || shouldAbortTimMove(player, st.dim, false)) {
            exitUnravelMode(player, "abort");
            continue;
        }


        if (!(st.recalling && st.recallReason === "rope_pull")) {
            try { player.runCommand("effect @s slowness 1 255 true"); } catch { }
        }
        const pLoc = player.location;
        st.savedBodyPos = { x: pLoc.x, y: pLoc.y, z: pLoc.z };
        st.anchorCenter = { x: pLoc.x, y: pLoc.y + 1.0547, z: pLoc.z };

        const rawView = player.getViewDirection();
        const vLen = Math.hypot(rawView.x, rawView.y, rawView.z) || 1;
        const view = { x: rawView.x / vLen, y: rawView.y / vLen, z: rawView.z / vLen };
        const rot = player.getRotation();


        if (st.recalling) {
            st.recallTicks++;
            const nodes = st.ropeNodes;
            while (nodes.length > 2) {
                const prev = nodes[nodes.length - 2];
                if (Math.hypot(prev.x - st.armPos.x, prev.y - st.armPos.y, prev.z - st.armPos.z) <= 0.85) {
                    nodes.splice(nodes.length - 2, 1);
                } else break;
            }
            const target = nodes.length > 2 ? nodes[nodes.length - 2] : st.anchorCenter;
            const rx = target.x - st.armPos.x;
            const ry = target.y - st.armPos.y;
            const rz = target.z - st.armPos.z;
            const rDist = Math.hypot(rx, ry, rz);
            const hasPullTarget = Boolean(st.recallTarget?.isValid);
            const maxRecallTicks = hasPullTarget ? Math.max(42, nodes.length * 6) : Math.max(24, nodes.length * 4);

            let pullTargetArrived = !hasPullTarget;
            if (hasPullTarget) {
                try {
                    const headLoc = player.getHeadLocation();
                    const tl = st.recallTarget.location;
                    const tCenter = { x: tl.x, y: tl.y + 1.0, z: tl.z };
                    const dest = {
                        x: headLoc.x + view.x * 2.0,
                        y: headLoc.y + view.y * 2.0 - 0.75,
                        z: headLoc.z + view.z * 2.0,
                    };
                    const dx = dest.x - tl.x;
                    const dy = dest.y - tl.y;
                    const dz = dest.z - tl.z;
                    const dist3D = Math.hypot(dx, dy, dz);
                    const distH = Math.hypot(dx, dz);

                    createRopeWrapVFX(st.dim, st.recallTarget, { lifeTicks: 4, wraps: 3 });
                    createRopeBeam(st.dim, st.armPos, tCenter, { thickness: 0.05, life: 0.08, sag: 0 });
                    try { st.recallTarget.runCommand("scoreboard players set @s stun 2"); } catch { }

                    if (dist3D <= 2.0 || (distH <= 1.4 && Math.abs(dy) <= 1.5) || st.recallTicks >= 22) {
                        pullTargetArrived = true;
                        try { st.recallTarget.applyKnockback({ x: 0, z: 0 }, 0); } catch { }
                    } else if (st.recallTicks % 2 === 0) {
                        const dirX = dx / (distH || 1);
                        const dirZ = dz / (distH || 1);
                        const pullPower = Math.min(1.8, Math.max(0.4, distH * 0.35));
                        let verticalForce;
                        if (dy > 0.4) {
                            verticalForce = Math.min(1.4, Math.max(0.35, Math.sqrt(dy * 0.18) + 0.15));
                        } else if (dy < -0.5) {
                            verticalForce = Math.max(-0.4, dy * 0.2);
                        } else {
                            verticalForce = 0.22;
                        }
                        if (!st.recallTarget.hasTag("tusk_detached") && !st.recallTarget.hasTag("tusk_spatial") && !st.recallTarget.hasTag("tusk_rotation")) {
                            st.recallTarget.applyKnockback(
                                { x: dirX * pullPower, z: dirZ * pullPower },
                                verticalForce
                            );
                        }
                    }
                } catch {
                    pullTargetArrived = true;
                }
            }

            if ((nodes.length <= 2 && rDist <= 1.05 && pullTargetArrived) || st.recallTicks >= maxRecallTicks) {
                finalizeUnravelExit(player, st, st.recallReason, false);
                continue;
            }
            if (rDist > 0.25) {
                const armSpeed = hasPullTarget ? 1.25 : UnravelRecallSpeed;
                const step = Math.min(rDist, armSpeed);
                st.armPos = {
                    x: st.armPos.x + (rx / rDist) * step,
                    y: st.armPos.y + (ry / rDist) * step,
                    z: st.armPos.z + (rz / rDist) * step,
                };
            }
            updateUnravelRopePath(st.dim, st);
            if (st.recallReason !== "rope_pull") {
                const camPos = computeUnravelCameraPos(st.dim, player, st, view);
                try {
                    player.camera.setCamera("minecraft:free", {
                        location: camPos,
                        rotation: { x: rot.x, y: rot.y },
                        easeOptions: { easeTime: 0.06, easeType: EasingType.Linear },
                    });
                } catch { }
            }
            syncUnravelTarget(player, st.anchorCenter, st.armPos, view, st.isBent, st.ropeNodes);
            syncUnravelHitboxes(player, st);
            renderUnravelRopePolyline(st.dim, st);
            continue;
        }


        if (st.reelingToArm) {
            st.reelTicks++;
            updateUnravelRopePath(st.dim, st);
            const nodes = st.ropeNodes;
            while (nodes.length > 2) {
                if (Math.hypot(nodes[1].x - st.anchorCenter.x, nodes[1].y - st.anchorCenter.y, nodes[1].z - st.anchorCenter.z) <= 1.35 ||
                    hasClearRopeLine(st.dim, st.anchorCenter, nodes[2])) {
                    nodes.splice(1, 1);
                } else break;
            }
            const target = (nodes.length <= 2 || hasClearRopeLine(st.dim, st.anchorCenter, st.armPos))
                ? st.armPos
                : nodes[1];
            const rx = target.x - st.anchorCenter.x;
            const ry = target.y - st.anchorCenter.y;
            const rz = target.z - st.anchorCenter.z;
            const rDist = Math.hypot(rx, ry, rz);
            const horiz = Math.hypot(rx, rz);
            const totalLen = computeUnravelRopeLength(st);
            const maxReelTicks = Math.max(20, Math.min(60, Math.ceil(totalLen * 2.5) + 10));
            if ((target === st.armPos && (rDist <= 1.75 || (horiz <= 1.5 && Math.abs(ry) <= 1.8))) || st.reelTicks >= maxReelTicks) {
                try { player.applyKnockback({ x: 0, z: 0 }, 0); } catch { }
                finalizeUnravelExit(player, st, "reel", false);
                continue;
            }
            if (st.reelTicks % 2 === 1) {
                const dirX = rx / (horiz || 1);
                const dirZ = rz / (horiz || 1);
                const pullPower = horiz > 0.15 ? Math.min(1.65, Math.max(0.45, horiz * 0.35)) : 0;
                let verticalForce;
                if (ry > 0.4) {
                    verticalForce = Math.min(1.25, Math.max(0.3, Math.sqrt(ry * 0.16) + 0.14));
                } else if (ry < -0.5) {
                    verticalForce = Math.max(-0.45, ry * 0.22);
                } else {
                    verticalForce = 0.18;
                }
                try {
                    player.applyKnockback(
                        { x: dirX * pullPower, z: dirZ * pullPower },
                        verticalForce
                    );
                } catch { }
            }
            const camPos = computeUnravelCameraPos(st.dim, player, st, view);
            try {
                player.camera.setCamera("minecraft:free", {
                    location: camPos,
                    rotation: { x: rot.x, y: rot.y },
                    easeOptions: { easeTime: 0.06, easeType: EasingType.Linear },
                });
            } catch { }
            syncUnravelTarget(player, st.anchorCenter, st.armPos, view, st.isBent, st.ropeNodes);
            syncUnravelHitboxes(player, st);
            renderUnravelRopePolyline(st.dim, st);
            continue;
        }

        if (st.graceTicks > 0) st.graceTicks--;
        st.ticks++;


        if (st.ticks >= UnravelMaxTicks) {
            exitUnravelMode(player, "duration");
            continue;
        }


        const jumpDown = isJumpInput(player);
        if (!jumpDown) {
            st.releasedJumpAfterEntry = true;
        } else if (st.releasedJumpAfterEntry && st.graceTicks <= 0) {
            st.reelingToArm = true;
            st.reelTicks = 0;
            try {
                st.dim.playSound("xvoid.swing08", st.anchorCenter, { volume: 1.0, pitch: 1.4 });
                st.dim.playSound("step.cloth", st.anchorCenter, { volume: 0.9, pitch: 1.2 });
            } catch { }
            continue;
        }


        if (!player.isSneaking) {
            st.releasedSneakAfterEntry = true;
        } else if (st.releasedSneakAfterEntry && st.graceTicks <= 0) {
            exitUnravelMode(player, "reattach");
            continue;
        }


        if (st.ticks % 3 === 0) {
            useEnergy(player, 1, 15);
            if (getEnergy(player) <= 0) {
                exitUnravelMode(player, "stamina");
                continue;
            }
        }


        let mv = { x: 0, y: 0 };
        try { mv = player.inputInfo?.getMovementVector?.() ?? { x: 0, y: 0 }; } catch { }

        stepFreeAirArm(player, st.dim, st, mv, view, rot.y);


        const camPos = computeUnravelCameraPos(st.dim, player, st, view);
        try {
            player.camera.setCamera("minecraft:free", {
                location: camPos,
                rotation: { x: rot.x, y: rot.y },
                easeOptions: { easeTime: 0.08, easeType: EasingType.Linear },
            });
        } catch { }


        const inv = player.getComponent("minecraft:inventory")?.container;
        const heldId = inv?.getItem(player.selectedSlotIndex)?.typeId ?? "";
        const aimInfo = resolveDetachedArmAim(player, st.armPos, view, camPos, 28, 1.15);
        st.lastAimInfo = aimInfo;
        syncUnravelTarget(player, st.anchorCenter, st.armPos, aimInfo.armAim, st.isBent, st.ropeNodes);
        syncUnravelHitboxes(player, st);
        spawnDetachedArmAimIndicator(player, aimInfo, {
            showLine: heldId === "xvoid:revolver",
            defaultColor: Colors.gold,
            lockedColor: Colors.crimson,
        });


        renderUnravelRopePolyline(st.dim, st);


        const sp1 = getScore(player, "sp1");
        if (sp1 === 19) {
            triggerUnravelMelee(player, st, view);
        }
    }
}, 1);


system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        if (!player?.isValid || activeMoves.has(player.id) || unravelMoves.has(player.id) || (player.getProperty("property:stand") ?? 0) !== 6) continue;
        try {
            const limb = player.getProperty("property:tim_limb") ?? 0;
            const detach = player.getProperty("property:tim_detach") ?? 0;
            if (limb !== 0 || detach > 0 || player.hasTag("tim_unravel")) {
                try { player.removeTag("onSkill"); } catch { }
                try { player.removeTag("tim_grapple"); } catch { }
                try { player.removeTag("tim_unravel"); } catch { }
                try { player.triggerEvent("xvoid:g"); } catch { }
                try { player.triggerEvent("xvoid:kb_normal"); } catch { }
                clearUnravelCamera(player);
                try { player.runCommand("inputpermission set @s jump enabled"); } catch { }
                resetDetachedLimb(player);
            }
        } catch { }
    }

    const seenDims = new Set();
    for (const p of world.getAllPlayers()) {
        if (!p?.isValid || seenDims.has(p.dimension.id)) continue;
        seenDims.add(p.dimension.id);
        try {
            for (const ent of p.dimension.getEntities({ type: TimHitboxType })) {
                if (!ent?.isValid) continue;
                const owner = getTimHitboxOwner(ent);
                if (!hasRegisteredTimHitbox(ent.id) || !owner?.isValid || !unravelMoves.has(owner.id)) {
                    despawnHitboxEntity(ent);
                }
            }
        } catch { }
    }
}, 5);

function triggerUnravelRopePull(player, st) {
    if (!player?.isValid || !st || st.graceTicks > 0 || st.recalling || st.reelingToArm) return;
    if (system.currentTick - (st.lastRopePullTick ?? -20) < 12) return;

    const dim = st.dim;
    let target = st.lastAimInfo?.hitEntity;
    if (!target?.isValid || target.id === player.id) {
        target = null;
        try {
            const view = player.getViewDirection();
            const vLen = Math.hypot(view.x, view.y, view.z) || 1;
            const aimDir = st.lastAimInfo?.shootDir ?? { x: view.x / vLen, y: view.y / vLen, z: view.z / vLen };
            for (const rayHit of dim.getEntitiesFromRay(st.armPos, aimDir, { maxDistance: 24 })) {
                const e = rayHit.entity;
                if (!e?.isValid || e.id === player.id || isOwnTimHitbox(player, e)) continue;
                if (e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb" || e.typeId === "xvoid:dmg" || e.typeId === "xvoid:impact_frame" || e.typeId === "xvoid:frozen_rain" || e.hasTag("non_target")) continue;
                const resolved = getTimHitboxOwner(e) ?? e;
                if (resolved.id === player.id) continue;
                target = resolved;
                break;
            }
        } catch { }
    }
    if (!target?.isValid) return;

    st.lastRopePullTick = system.currentTick;
    st.recallTarget = target;
    const tLoc = target.location;
    const targetCenter = { x: tLoc.x, y: tLoc.y + 0.9, z: tLoc.z };


    try { player.runCommand("effect @s slowness 0"); } catch { }
    try { player.runCommand("inputpermission set @s jump enabled"); } catch { }
    clearUnravelCamera(player);
    system.runTimeout(() => {
        if (player?.isValid) clearUnravelCamera(player);
    }, 1);

    try {
        target.runCommand("scoreboard players set @s stun 4");
        dim.playSound("xvoid.swing08", st.armPos, { volume: 1.0, pitch: 1.35 });
        dim.playSound("xvoid.swing10", player.location, { volume: 1.2, pitch: 1.0 });
        dim.playSound("step.cloth", targetCenter, { volume: 0.9, pitch: 1.1 });
        createRopeBeam(dim, st.armPos, targetCenter, { thickness: 0.055, life: 0.25, sag: 0.05 });
        createRopeWrapVFX(dim, target, { lifeTicks: 8, wraps: 3 });
    } catch { }

    exitUnravelMode(player, "rope_pull");
}


function handleTimStandItemReuse(player, itemStack) {
    if (!player?.isValid || !itemStack) return;
    if (itemStack.typeId === "jjba:stand" && unravelMoves.has(player.id)) {
        triggerUnravelRopePull(player, unravelMoves.get(player.id));
        return;
    }
    if (itemStack.typeId === "jjba:stand2" && unravelMoves.has(player.id)) {
        const st = unravelMoves.get(player.id);
        if (st && st.graceTicks <= 0) {
            exitUnravelMode(player, "reattach");
        }
        return;
    }
    if (itemStack.typeId === "jjba:stand" || itemStack.typeId === "jjba:stand2") {
        cancelZiplineGrapple(player, true);
    }
}

world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack }) => {
    handleTimStandItemReuse(player, itemStack);
});

world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
    handleTimStandItemReuse(player, itemStack);
});

const UnravelRedirectProjectiles = new Set([
    "minecraft:arrow",
    "minecraft:snowball",
    "minecraft:thrown_trident",
    "minecraft:ender_pearl",
    "minecraft:egg",
    "minecraft:splash_potion",
    "minecraft:lingering_potion",
    "minecraft:xp_bottle",
    "minecraft:wind_charge",
    "minecraft:breeze_wind_charge_projectile",
    "minecraft:fireworks_rocket",
    "minecraft:fishing_hook",
    "jjba:knife",
]);


world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (!entity?.isValid || unravelMoves.size === 0) return;
    let projComp = null;
    try { projComp = entity.getComponent("minecraft:projectile"); } catch { }
    if (!projComp && !UnravelRedirectProjectiles.has(entity.typeId)) return;
    if (entity.typeId === "jjba:steelball" || entity.typeId === "jjba:nail") return;

    let owner = projComp?.owner;
    if (!owner?.isValid) {
        const eLoc = entity.location;
        for (const [pid, st] of unravelMoves) {
            const p = world.getPlayers().find((pl) => pl.id === pid);
            if (!p?.isValid || p.dimension.id !== entity.dimension.id) continue;
            const dBody = Math.hypot(eLoc.x - st.savedBodyPos.x, eLoc.y - (st.savedBodyPos.y + 1.5), eLoc.z - st.savedBodyPos.z);
            if (dBody < 2.6) {
                owner = p;
                break;
            }
        }
    }
    if (!owner?.isValid || !unravelMoves.has(owner.id)) return;

    const st = unravelMoves.get(owner.id);
    if (!st) return;

    const muzzle = getTimDetachedShootOrigin(owner);
    const shootDir = getTimDetachedShootDir(owner);
    if (!muzzle || !shootDir) return;

    const spawnPos = {
        x: muzzle.x + shootDir.x * 0.35,
        y: muzzle.y + shootDir.y * 0.35,
        z: muzzle.z + shootDir.z * 0.35,
    };

    try {
        const vel = entity.getVelocity();
        const speed = Math.max(0.85, Math.hypot(vel.x, vel.y, vel.z));
        entity.teleport(spawnPos);
        if (projComp) {
            projComp.shoot({
                x: shootDir.x * speed,
                y: shootDir.y * speed,
                z: shootDir.z * speed,
            });
        } else {
            entity.clearVelocity();
            entity.applyImpulse({
                x: shootDir.x * speed,
                y: shootDir.y * speed,
                z: shootDir.z * speed,
            });
        }
    } catch { }
});

system.afterEvents.scriptEventReceive.subscribe(({ id, sourceEntity }) => {
    if (!sourceEntity?.isValid || sourceEntity.typeId !== "minecraft:player") return;
    const isTimMoveEvent =
        id === "xvoid:tim_unravel" ||
        id === "xvoid:tim_lasso_hook" ||
        id === "xvoid:tim_arm" ||
        id === "xvoid:lasso" ||
        id === "xvoid:tim_block_tether" ||
        id === "xvoid:tim_zipline_grapple" ||
        id === "xvoid:tim_zipline";
    if (!isTimMoveEvent) return;

    if (system.currentTick < (unravelJustExited.get(sourceEntity.id) ?? 0)) {
        return;
    }

    if (id === "xvoid:tim_unravel") {
        if (cancelZiplineGrapple(sourceEntity)) return;
        startUnravelMode(sourceEntity);
        return;
    }

    if (unravelMoves.has(sourceEntity.id)) {
        const st = unravelMoves.get(sourceEntity.id);
        if (st && st.graceTicks <= 0) {
            exitUnravelMode(sourceEntity, "reattach");
        }
        return;
    }

    if (id === "xvoid:tim_lasso_hook" || id === "xvoid:tim_arm" || id === "xvoid:lasso") {
        if (cancelZiplineGrapple(sourceEntity)) return;
        fireLassoHook(sourceEntity, false);
    } else if (id === "xvoid:tim_block_tether") {
        if (cancelZiplineGrapple(sourceEntity)) return;
        fireLassoHook(sourceEntity, true);
    } else if (id === "xvoid:tim_zipline_grapple" || id === "xvoid:tim_zipline") {
        if (cancelZiplineGrapple(sourceEntity)) return;
        fireZiplineGrapple(sourceEntity);
    }
});
