import { world, system } from "@minecraft/server";
import { triggerDamage, stopPlayerDamage } from "../damage/damage.js";
import { getEnergy, useEnergy, addEnergy, setEnergyCooldown, getEnergyCooldown } from "../energy.js";
import { Colors, spawnImpactRing, spawnGlowFlash, spawnStarburst } from "../utils/vfx.js";
import { playBlockStartVFX, playBlockSustainVFX, playGuardBreakVFX } from "./blocking/vfx.js";
import { isPlayerChargingTimeStop } from "./timestop/index.js";
import { isPlayerWindingMandom, cancelMandomWindup } from "./mandom/mandom.js";
import { isTimeStopped } from "../utils/tsState.js";
import { openTuskActWheel } from "./tusk/wheel.js";

const CombatMemory = {};
const MaxHoldTime = 5;
const holdingPlayers = {};
const queuedInputs = {};


const activeClashes = new Map();

const ClashPrompts = [
    { id: "swing", label: "§b§l[ L-CLICK / SWING ]" },
    { id: "sneak", label: "§a§l[ TAP SNEAK ]" },
    { id: "use", label: "§d§l[ R-CLICK / USE ]" }
];

export function getMemory(playerId) {
    if (!CombatMemory[playerId]) {
        CombatMemory[playerId] = {
            charge: 0,
            chargeMax: false,
            SneakCharge: 0,
            SneakChargeMax: false,
            autoStopped: false,


            isBlocking: false,
            blockTicks: 0,
            blockCooldown: 0,


            jumps: 0,
            jumpTicks: 0,
            wasJumping: false,
            dashCooldown: 0,
            lastDashTick: -9999,


            sneakTaps: 0,
            sneakTapTicks: 0,
            wasSneaking: false,
            evasiveCooldown: 0,


            clashCooldown: 0,
            usedRightClickTick: -10,
            lastSp1: 0
        };
    }
    return CombatMemory[playerId];
}

function getScore(player, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(player) ?? 0;
    } catch {
        return 0;
    }
}

function setScore(player, objectiveName, value) {
    try {
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(player, Math.round(value));
    } catch { }
}

function getCdScore(player) {
    return getScore(player, "cd");
}

function getStunScore(player) {
    return getScore(player, "stun");
}

function isHoldingStandItem(player) {
    try {
        const item = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
        return item && (item.typeId === "jjba:stand" || item.typeId === "jjba:stand2");
    } catch {
        return false;
    }
}

function canBypassTsStun(player, itemTypeId, isSneaking) {
    return itemTypeId === "jjba:stand2" && isSneaking && (player.hasTag("tsed") || isTimeStopped()) && !player.hasTag("ts");
}


function startBlocking(player, memory) {
    if (memory.isBlocking || memory.blockCooldown > 0) return;
    if (player.hasTag("tusk_rotation") || player.hasTag("tusk_detached") || player.hasTag("tusk_spatial") || player.hasTag("tusk_wormhole_barrage") || player.hasTag("tim_unravel")) return;
    if (getEnergy(player) < 6) {
        return;
    }

    memory.isBlocking = true;
    memory.blockTicks = 0;
    useEnergy(player, 6, 15);


    try {
        player.playAnimation("animation.stand.block2");
    } catch { }


    try { player.addTag("parry"); } catch { }

    try {
        player.addTag("blocking");
        player.setProperty("property:blocking", 1);
        player.runCommand("event entity @s xvoid:blocking");


        playBlockStartVFX(player);
    } catch { }
}

export const ParryWindowTicks = 10;


export function isParrying(player) {
    if (!player?.isValid) return false;
    if (player.hasTag("parry")) return true;
    const mem = CombatMemory[player.id];
    return Boolean(mem && mem.isBlocking && mem.blockTicks <= ParryWindowTicks && player.hasTag("blocking"));
}

export function stopBlocking(player, memory) {
    if (!memory) memory = getMemory(player.id);
    if (!memory.isBlocking && !player.hasTag("blocking") && !player.hasTag("parry")) return;

    memory.isBlocking = false;
    memory.blockTicks = 0;
    memory.blockCooldown = 5;


    try {
        const curCd = getEnergyCooldown(player);
        if (curCd < 15) {
            setEnergyCooldown(player, 15);
        }
    } catch { }

    try {
        player.removeTag("blocking");
        player.removeTag("parry");
        player.setProperty("property:blocking", 0);
        player.runCommand("event entity @s xvoid:remove_damage_blocking");
    } catch { }
}

export function breakGuard(player, reason = "energy") {
    if (!player || !player.isValid) return;
    const memory = getMemory(player.id);
    stopBlocking(player, memory);
    setEnergyCooldown(player, 40);

    try {
        const stunObj = world.scoreboard.getObjective("stun");
        if (stunObj) {
            const existing = stunObj.getScore(player) ?? 0;
            stunObj.setScore(player, Math.max(existing, 20));
        }
    } catch { }

    playGuardBreakVFX(player);
}

export function isAttackInFront(defender, sourceLocOrEntity) {
    if (!defender?.isValid) return true;
    if (!sourceLocOrEntity) return true;

    let sourceLoc = null;
    if (typeof sourceLocOrEntity.x === "number") {
        sourceLoc = sourceLocOrEntity;
    } else if (sourceLocOrEntity.location) {
        sourceLoc = sourceLocOrEntity.location;
    }
    if (!sourceLoc || typeof sourceLoc.x !== "number") return true;

    const defLoc = defender.location;
    const dx = sourceLoc.x - defLoc.x;
    const dz = sourceLoc.z - defLoc.z;
    const distSq = dx * dx + dz * dz;


    if (distSq < 0.04) return true;

    const dist = Math.sqrt(distSq);
    const toAttackerX = dx / dist;
    const toAttackerZ = dz / dist;


    let viewX = 0, viewZ = -1;
    let foundView = false;
    try {
        const vd = defender.getViewDirection();
        const vLen = Math.sqrt(vd.x * vd.x + vd.z * vd.z);
        if (vLen > 0.001) {
            viewX = vd.x / vLen;
            viewZ = vd.z / vLen;
            foundView = true;
        }
    } catch { }

    if (!foundView) {
        try {
            const rot = defender.getRotation();
            const yawRad = (rot.y + 90) * (Math.PI / 180);
            viewX = Math.cos(yawRad);
            viewZ = Math.sin(yawRad);
        } catch { }
    }

    const dot = viewX * toAttackerX + viewZ * toAttackerZ;


    if (defender.hasTag("ataxia")) {
        const leftX = viewZ;
        const leftZ = -viewX;
        const leftDot = leftX * toAttackerX + leftZ * toAttackerZ;
        if (leftDot > 0.15) return false;
    }


    return dot >= -0.05;
}


function getRightVector(forward) {
    return { x: -forward.z, z: forward.x };
}

function normalize2D(vec) {
    const len = Math.sqrt(vec.x * vec.x + vec.z * vec.z);
    if (len < 0.0001) return { x: 0, z: 0 };
    return { x: vec.x / len, z: vec.z / len };
}

function detectMovementDirection(velocity, viewDir) {
    if (!velocity) return null;
    const mag = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (mag < 0.08) return null;
    const moveVec = normalize2D(velocity);
    const right = getRightVector(viewDir);
    const forwardComp = moveVec.x * viewDir.x + moveVec.z * viewDir.z;
    const rightComp = moveVec.x * right.x + moveVec.z * right.z;
    return { forward: forwardComp, right: rightComp };
}

function executeDirectionalDash(player, memory, movement) {
    if (getEnergy(player) < 10) {
        try { player.onScreenDisplay?.setActionBar("§c< Not Enough Energy to Dash >"); } catch { }
        return;
    }

    const viewDir = normalize2D(player.getViewDirection());
    const rightVec = getRightVector(viewDir);
    let dashX = viewDir.x;
    let dashZ = viewDir.z;
    let horizontal = 2.1;
    let vertical = 0.25;
    let animDir = "forward";

    if (movement) {
        const absF = Math.abs(movement.forward);
        const absR = Math.abs(movement.right);
        if (absF >= absR) {
            if (movement.forward >= 0) {
                dashX = viewDir.x;
                dashZ = viewDir.z;
                horizontal = 2.2;
                vertical = 0.25;
                animDir = "forward";
            } else {
                dashX = -viewDir.x;
                dashZ = -viewDir.z;
                horizontal = 2.0;
                vertical = 0.18;
                animDir = "backward";
            }
        } else {
            if (movement.right > 0) {
                dashX = rightVec.x;
                dashZ = rightVec.z;
                horizontal = 2.1;
                vertical = 0.2;
                animDir = "right";
            } else {
                if (player.hasTag("ataxia")) return;
                dashX = -rightVec.x;
                dashZ = -rightVec.z;
                horizontal = 2.1;
                vertical = 0.2;
                animDir = "left";
            }
        }
    }

    useEnergy(player, 15, 15);
    setScore(player, "iFrames", 5);


    const now = system.currentTick;
    const ticksSinceLastDash = now - (memory.lastDashTick ?? -9999);
    memory.lastDashTick = now;

    if (ticksSinceLastDash <= 20) {
        memory.dashCooldown = 40;
    } else {
        memory.dashCooldown = 0;
    }

    try {
        player.applyKnockback({ x: dashX * horizontal, z: dashZ * horizontal }, vertical);
        player.playAnimation(`animation.dash.${animDir}`);
        player.dimension.spawnParticle("xvoid:dash", player.location);
        player.dimension.spawnParticle("xvoid:dash2", { x: player.location.x, y: player.location.y + 0.8, z: player.location.z });
        player.dimension.playSound("xvoid.wind2", player.location, { volume: 0.7, pitch: 1.2 });
    } catch { }
}

function executeComboEscape(player, memory) {
    if (memory.evasiveCooldown > 0) {
        const sec = (memory.evasiveCooldown / 20).toFixed(1);
        try { player.onScreenDisplay?.setActionBar(`§c< Combo Escape on Cooldown: ${sec}s >`); } catch { }
        return;
    }
    if (getEnergy(player) < 50) {
        try { player.onScreenDisplay?.setActionBar("§c< Need 50+ Energy to Combo Escape! >"); } catch { }
        return;
    }

    useEnergy(player, 55, 45);
    memory.evasiveCooldown = 300;


    setScore(player, "stun", 0);
    setScore(player, "stun2", 0);
    setScore(player, "iFrames", 8);

    const viewDir = normalize2D(player.getViewDirection());
    const loc = player.location;
    const hitLoc = { x: loc.x, y: loc.y + 1.0, z: loc.z };

    try {
        player.removeTag("stun");
        player.removeTag("knocked_down");
        player.removeTag("onSkill");
        player.removeTag("chargeT");
        player.removeTag("chargeM");
        player.runCommand("function util/returnMovement");
        player.playAnimation("animation.dash.backward");


        player.applyKnockback({ x: -viewDir.x * 2.5, z: -viewDir.z * 2.5 }, 0.32);


        player.dimension.spawnParticle("sfx:impact", loc);
        player.dimension.spawnParticle("xvoid:dash2", hitLoc);
        spawnImpactRing(player.dimension, hitLoc, viewDir, { radius: 2.5, time: 0.25, color: Colors.white, alpha: 0.9 });
        spawnGlowFlash(player.dimension, hitLoc, { size: 2.2, life: 0.18, color: Colors.white, alpha: 0.85 });
        player.dimension.playSound("xvoid.flash1", loc, { volume: 0.9, pitch: 1.35 });
        player.dimension.playSound("xvoid.skill_wind2", loc, { volume: 0.9, pitch: 1.15 });


        const nearby = player.dimension.getEntities({
            location: loc,
            maxDistance: 4.5,
            excludeTags: ["non_target"]
        });
        for (const ent of nearby) {
            if (!ent?.isValid || ent.id === player.id || ent.hasTag("tusk_detached") || ent.hasTag("tusk_spatial") || ent.hasTag("tusk_rotation")) continue;
            stopPlayerDamage(ent.id);
            try {
                ent.runCommand("scriptevent xvoid:damage stop");
                ent.removeTag("onSkill");
                ent.removeTag("chargeM");
                setScore(ent, "stun", 8);
                const dx = ent.location.x - loc.x;
                const dz = ent.location.z - loc.z;
                const dNorm = normalize2D({ x: dx, z: dz });
                ent.applyKnockback({ x: dNorm.x * 1.1, z: dNorm.z * 1.1 }, 0.15);
            } catch { }
        }
    } catch { }
}


function generateClashSequence(length = 3) {
    const seq = [];
    for (let i = 0; i < length; i++) {
        const idx = Math.floor(Math.random() * ClashPrompts.length);
        seq.push(ClashPrompts[idx]);
    }
    return seq;
}

function startStandClash(p1, p2) {
    const mem1 = getMemory(p1.id);
    const mem2 = getMemory(p2.id);

    mem1.clashCooldown = 400;
    mem2.clashCooldown = 400;

    stopPlayerDamage(p1.id);
    stopPlayerDamage(p2.id);

    const midX = (p1.location.x + p2.location.x) * 0.5;
    const midY = (p1.location.y + p2.location.y) * 0.5;
    const midZ = (p1.location.z + p2.location.z) * 0.5;

    for (const p of [p1, p2]) {
        try {
            p.runCommand("scriptevent xvoid:damage stop");
            p.removeTag("onSkill");
            p.removeTag("chargeM");
            p.removeTag("chargeT");
            p.addTag("clashing");
            setScore(p, "iFrames", 80);
            setScore(p, "cd", 80);
            p.playAnimation("animation.stand.clash");
            p.runCommand("inputpermission set @s lateral_movement disabled");
            p.runCommand("inputpermission set @s jump disabled");
        } catch { }
    }

    try {
        p1.dimension.playSound("diego.clash", { x: midX, y: midY, z: midZ }, { volume: 1.2, pitch: 1.0 });
        p1.dimension.playSound("random.anvil_land", { x: midX, y: midY, z: midZ }, { volume: 1.0, pitch: 1.4 });
        spawnImpactRing(p1.dimension, { x: midX, y: midY + 1, z: midZ }, { x: 0, y: 1, z: 0 }, { radius: 3.5, time: 0.35, color: Colors.gold, alpha: 0.95 });
    } catch { }

    const clashId = `${p1.id}_${p2.id}`;
    const clashObj = {
        id: clashId,
        p1,
        p2,
        mid: { x: midX, y: midY, z: midZ },
        ticks: 0,
        maxTicks: 70,
        seq1: generateClashSequence(3),
        seq2: generateClashSequence(3),
        prog1: 0,
        prog2: 0
    };

    activeClashes.set(clashId, clashObj);
}

function checkPlayerClashInput(player, memory, expectedId) {
    const sp1 = getScore(player, "sp1");
    const swungThisTick = sp1 === 19 && memory.lastSp1 !== 19;
    const tappedSneak = player.isSneaking && !memory.wasSneaking;
    const usedRightClick = (system.currentTick - memory.usedRightClickTick) <= 1;

    if (expectedId === "swing" && swungThisTick) return true;
    if (expectedId === "sneak" && tappedSneak) return true;
    if (expectedId === "use" && usedRightClick) return true;
    return false;
}

function resolveStandClash(clash, winner, loser) {
    activeClashes.delete(clash.id);

    for (const p of [clash.p1, clash.p2]) {
        if (!p?.isValid) continue;
        try {
            p.removeTag("clashing");
            p.runCommand("function util/returnMovement");
            p.playAnimation("animation.twau.heavy2");
            setScore(p, "iFrames", 0);
            setScore(p, "cd", 15);
        } catch { }
    }

    if (winner?.isValid && loser?.isValid) {
        addEnergy(winner, 35);
        setEnergyCooldown(winner, 0);
        setScore(winner, "iFrames", 15);

        try {

            const dir = normalize2D({
                x: loser.location.x - winner.location.x,
                z: loser.location.z - winner.location.z
            });
            const hitLoc = { x: loser.location.x, y: loser.location.y + 1.0, z: loser.location.z };

            spawnImpactRing(winner.dimension, hitLoc, dir, { radius: 3.2, time: 0.3, color: Colors.gold, alpha: 0.95 });
            spawnStarburst(winner.dimension, hitLoc, { size: 2.5, life: 0.25 });
            winner.dimension.playSound("xvoid.groundHit", clash.mid, { volume: 1.2, pitch: 1.0 });
            winner.dimension.playSound("xvoid.oramuda_button3", clash.mid, { volume: 1.2, pitch: 1.0 });

            triggerDamage(winner, [0, "5/5/5", 18, "p=xvoid:blood", "~~1~", "heavy:14/2.2"]);
        } catch { }
    }
}

function tickStandClashes() {

    const barragingPlayers = world.getAllPlayers().filter(p =>
        p?.isValid &&
        p.hasTag("chargeM") &&
        !p.hasTag("clashing") &&
        !p.hasTag("uncancelable") &&
        getScore(p, "standC") >= 1 &&
        getScore(p, "standC") !== 5 &&
        getMemory(p.id).clashCooldown <= 0
    );

    for (let i = 0; i < barragingPlayers.length; i++) {
        const p1 = barragingPlayers[i];
        if (p1.hasTag("clashing")) continue;
        for (let j = i + 1; j < barragingPlayers.length; j++) {
            const p2 = barragingPlayers[j];
            if (p2.hasTag("clashing") || p1.dimension.id !== p2.dimension.id) continue;

            const dx = p2.location.x - p1.location.x;
            const dy = p2.location.y - p1.location.y;
            const dz = p2.location.z - p1.location.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist <= 5.5) {
                startStandClash(p1, p2);
                break;
            }
        }
    }


    for (const [clashId, clash] of activeClashes.entries()) {
        const { p1, p2 } = clash;
        if (!p1?.isValid || !p2?.isValid) {
            resolveStandClash(clash, p1?.isValid ? p1 : p2, null);
            continue;
        }

        clash.ticks++;
        const mem1 = getMemory(p1.id);
        const mem2 = getMemory(p2.id);


        try {
            const dir12 = normalize2D({ x: p2.location.x - p1.location.x, z: p2.location.z - p1.location.z });
            const yaw1 = Math.atan2(-dir12.x, dir12.z) * (180 / Math.PI);
            const yaw2 = Math.atan2(dir12.x, -dir12.z) * (180 / Math.PI);

            p1.teleport(
                { x: clash.mid.x - dir12.x * 1.3, y: clash.mid.y, z: clash.mid.z - dir12.z * 1.3 },
                { rotation: { x: 0, y: yaw1 } }
            );
            p2.teleport(
                { x: clash.mid.x + dir12.x * 1.3, y: clash.mid.y, z: clash.mid.z + dir12.z * 1.3 },
                { rotation: { x: 0, y: yaw2 } }
            );
        } catch { }


        if (clash.ticks % 2 === 0) {
            try {
                const sparkLoc = {
                    x: clash.mid.x + (Math.random() - 0.5) * 1.2,
                    y: clash.mid.y + 0.8 + Math.random() * 0.8,
                    z: clash.mid.z + (Math.random() - 0.5) * 1.2
                };
                p1.dimension.spawnParticle("xvoid:parry_sparks", sparkLoc);
                p1.dimension.playSound("xvoid.swing06", clash.mid, { volume: 0.7, pitch: 0.9 + Math.random() * 0.3 });
                p1.dimension.playSound("xvoid.oramuda_button", clash.mid, { volume: 0.7, pitch: 1.0 });
            } catch { }
        }
        if (clash.ticks % 10 === 0) {
            try {
                p1.dimension.spawnParticle("sfx:impact", clash.mid);
            } catch { }
        }


        const prompt1 = clash.seq1[clash.prog1];
        const prompt2 = clash.seq2[clash.prog2];

        if (prompt1 && checkPlayerClashInput(p1, mem1, prompt1.id)) {
            clash.prog1++;
            try { p1.dimension.playSound("random.orb", p1.location, { volume: 0.8, pitch: 1.4 + clash.prog1 * 0.2 }); } catch { }
            if (clash.prog1 >= clash.seq1.length) {
                resolveStandClash(clash, p1, p2);
                continue;
            }
        }

        if (prompt2 && checkPlayerClashInput(p2, mem2, prompt2.id)) {
            clash.prog2++;
            try { p2.dimension.playSound("random.orb", p2.location, { volume: 0.8, pitch: 1.4 + clash.prog2 * 0.2 }); } catch { }
            if (clash.prog2 >= clash.seq2.length) {
                resolveStandClash(clash, p2, p1);
                continue;
            }
        }


        const next1 = clash.seq1[clash.prog1];
        const next2 = clash.seq2[clash.prog2];
        if (next1) {
            try { p1.onScreenDisplay?.setActionBar(`§6§l⚡ CLASH! §fInput: ${next1.label} §e(${clash.prog1}/3) ⚡`); } catch { }
        }
        if (next2) {
            try { p2.onScreenDisplay?.setActionBar(`§6§l⚡ CLASH! §fInput: ${next2.label} §e(${clash.prog2}/3) ⚡`); } catch { }
        }

        if (clash.ticks >= clash.maxTicks) {
            if (clash.prog1 >= clash.prog2) {
                resolveStandClash(clash, p1, p2);
            } else {
                resolveStandClash(clash, p2, p1);
            }
        }
    }
}


world.afterEvents.itemStartUse.subscribe(({ itemStack, source }) => {
    if (!source?.isValid || !itemStack) return;
    if (itemStack.typeId !== "jjba:stand" && itemStack.typeId !== "jjba:stand2") return;

    const memory = getMemory(source.id);
    memory.usedRightClickTick = system.currentTick;


    if (source.hasTag("ts_exhausted") && !isPlayerChargingTimeStop(source)) {
        try { source.removeTag("ts_exhausted"); } catch { }
        try { source.removeTag("ts_counter_charge"); } catch { }
    }


    if (source.hasTag("tusk_wormhole_barrage") || source.hasTag("tim_unravel")) {
        delete holdingPlayers[source.id];
        delete queuedInputs[source.id];
        return;
    }
    if (isPlayerWindingMandom(source)) {
        cancelMandomWindup(source, false);
        delete holdingPlayers[source.id];
        delete queuedInputs[source.id];
        return;
    }
    if (source.hasTag("clashing") || isPlayerChargingTimeStop(source)) return;

    const isSneaking = source.isSneaking || getScore(source, "sneak") === 1;
    const is2ndItem = itemStack.typeId === "jjba:stand2";


    if (getStunScore(source) > 1 && !canBypassTsStun(source, itemStack.typeId, isSneaking)) {
        if (source.isSneaking && !source.hasTag("tsed")) {
            executeComboEscape(source, memory);
        }
        return;
    }


    if (!is2ndItem && isSneaking && !source.hasTag("onSkill")) {
        startBlocking(source, memory);
        return;
    }

    if (source.hasTag("twau_tandem")) {
        delete queuedInputs[source.id];
        return;
    }

    if (getCdScore(source) !== 0 || source.hasTag("onSkill")) {
        queuedInputs[source.id] = {
            type: "hold",
            isSneaking,
            itemStack: itemStack.typeId,
            tick: system.currentTick
        };
        return;
    }

    delete queuedInputs[source.id];
    memory.charge = 0;
    memory.SneakCharge = 0;
    memory.chargeMax = false;
    memory.SneakChargeMax = false;
    memory.autoStopped = false;

    holdingPlayers[source.id] = { isSneaking, itemTypeId: itemStack.typeId };
    source.addTag(`charging${isSneaking ? "S" : ""}`);
});

world.afterEvents.itemStopUse.subscribe(({ source, itemStack }) => {
    if (!source?.isValid) return;
    const memory = getMemory(source.id);

    if (memory.isBlocking || source.hasTag("blocking")) {
        stopBlocking(source, memory);
        delete holdingPlayers[source.id];
        return;
    }

    const itemTypeId = itemStack?.typeId ?? holdingPlayers[source.id]?.itemTypeId;
    if (itemTypeId !== "jjba:stand" && itemTypeId !== "jjba:stand2") {
        delete holdingPlayers[source.id];
        return;
    }

    source.removeTag("charging");
    source.removeTag("chargingS");

    const isSneaking = holdingPlayers[source.id]?.isSneaking ?? (source.isSneaking || getScore(source, "sneak") === 1);

    if ((getStunScore(source) > 1 && !canBypassTsStun(source, itemTypeId, isSneaking)) || source.hasTag("clashing") || source.hasTag("ts_exhausted") || source.hasTag("mandom_windup") || source.hasTag("tusk_wormhole_barrage") || source.hasTag("twau_tandem")) {
        delete holdingPlayers[source.id];
        delete queuedInputs[source.id];
        return;
    }

    if (getCdScore(source) !== 0 || source.hasTag("onSkill")) {
        if (queuedInputs[source.id] && queuedInputs[source.id].type === "hold") {
            queuedInputs[source.id].type = "tap";
        }
        delete holdingPlayers[source.id];
        return;
    }

    if (memory.autoStopped) {
        delete holdingPlayers[source.id];
        memory.charge = 0;
        memory.SneakCharge = 0;
        memory.chargeMax = false;
        memory.SneakChargeMax = false;
        memory.autoStopped = false;
        return;
    }

    if (!holdingPlayers[source.id]) {
        if (queuedInputs[source.id]) {
            const input = queuedInputs[source.id];
            const is2ndItem = input.itemStack === "jjba:stand2";
            source.addTag(`chargeT${input.isSneaking ? "S" : ""}${is2ndItem ? "B" : ""}`);
            delete queuedInputs[source.id];
        }
        return;
    }

    delete holdingPlayers[source.id];

    const is2ndItem = itemTypeId === "jjba:stand2";
    const isMax = isSneaking ? memory.SneakChargeMax : memory.chargeMax;

    source.addTag(`charge${isMax ? "M" : "T"}${isSneaking ? "S" : ""}${is2ndItem ? "B" : ""}`);

    memory.charge = 0;
    memory.SneakCharge = 0;
    memory.chargeMax = false;
    memory.SneakChargeMax = false;
    memory.autoStopped = false;
});


system.runInterval(() => {
    const currentTick = system.currentTick;


    tickStandClashes();


    for (const player of world.getAllPlayers()) {
        if (!player?.isValid) continue;
        const memory = getMemory(player.id);
        const stun = getStunScore(player);
        const isJumping = Boolean(player.isJumping);
        const isSneaking = Boolean(player.isSneaking);


        if (memory.blockCooldown > 0) memory.blockCooldown--;
        if (memory.dashCooldown > 0) memory.dashCooldown--;
        if (memory.evasiveCooldown > 0) memory.evasiveCooldown--;
        if (memory.clashCooldown > 0) memory.clashCooldown--;


        if (memory.isBlocking || player.hasTag("blocking")) {
            if (
                !isSneaking ||
                stun > 1 ||
                player.hasTag("onSkill") ||
                player.hasTag("clashing") ||
                player.hasTag("ts_exhausted") ||
                player.hasTag("tusk_rotation") ||
                player.hasTag("tusk_detached") ||
                player.hasTag("tusk_spatial") ||
                player.hasTag("tusk_wormhole_barrage") ||
                player.hasTag("tim_unravel") ||
                !isHoldingStandItem(player)
            ) {
                stopBlocking(player, memory);
            } else if (getEnergy(player) <= 0) {

                breakGuard(player, "energy");
            } else {
                memory.blockTicks++;

                if (memory.blockTicks > ParryWindowTicks && player.hasTag("parry")) {
                    try { player.removeTag("parry"); } catch { }
                }


                if (memory.blockTicks % 2 === 0) {
                    playBlockSustainVFX(player);
                }

                try {
                    player.addEffect("slowness", 4, { amplifier: 2, showParticles: false });
                } catch { }
            }
        }


        if (isSneaking && !memory.wasSneaking) {
            memory.sneakTaps++;
            memory.sneakTapTicks = 0;
            if (
                memory.sneakTaps >= 2 &&
                stun > 0 &&
                !player.hasTag("tsed") &&
                !player.hasTag("ts_exhausted") &&
                !player.hasTag("clashing")
            ) {
                executeComboEscape(player, memory);
                memory.sneakTaps = 0;
            }
        }
        if (memory.sneakTaps > 0) {
            memory.sneakTapTicks++;
            if (memory.sneakTapTicks > 10) {
                memory.sneakTaps = 0;
                memory.sneakTapTicks = 0;
            }
        }


        if (isJumping && !memory.wasJumping) {
            memory.jumps++;
            memory.jumpTicks = 0;
            if (
                memory.jumps >= 2 &&
                memory.dashCooldown <= 0 &&
                stun <= 0 &&
                !player.hasTag("onSkill") &&
                !player.hasTag("blocking") &&
                !player.hasTag("clashing") &&
                !player.hasTag("ts_exhausted") &&
                !player.hasTag("tusk_rotation") &&
                !player.hasTag("tusk_detached") &&
                !player.hasTag("tusk_spatial") &&
                !player.hasTag("tusk_wormhole_barrage") &&
                !player.hasTag("tim_unravel")
            ) {
                const movement = detectMovementDirection(player.getVelocity(), player.getViewDirection());
                if (movement) {
                    executeDirectionalDash(player, memory, movement);
                    memory.jumps = 0;
                    memory.jumpTicks = 0;
                }
            }
        }
        if (memory.jumps > 0) {
            memory.jumpTicks++;
            if (memory.jumpTicks > 10) {
                memory.jumps = 0;
                memory.jumpTicks = 0;
            }
        }

        memory.wasJumping = isJumping;
        memory.wasSneaking = isSneaking;
        memory.lastSp1 = getScore(player, "sp1");
    }


    for (const playerId in queuedInputs) {
        const player = world.getEntity(playerId);
        if (!player?.isValid) {
            delete queuedInputs[playerId];
            continue;
        }

        const input = queuedInputs[playerId];
        if ((currentTick - (input.tick ?? currentTick)) > 12) {
            delete queuedInputs[playerId];
            continue;
        }

        const itemStack = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
        if (!itemStack || itemStack.typeId !== input.itemStack || player.hasTag("tusk_wormhole_barrage") || player.hasTag("twau_tandem") || (getStunScore(player) > 1 && !canBypassTsStun(player, input.itemStack, input.isSneaking))) {
            delete queuedInputs[playerId];
            continue;
        }

        if (getCdScore(player) === 0 && !player.hasTag("onSkill")) {
            if (input.type === "hold") {
                holdingPlayers[playerId] = { isSneaking: input.isSneaking, itemTypeId: input.itemStack };
                player.addTag(`charging${input.isSneaking ? "S" : ""}`);
            } else if (input.type === "tap") {
                const is2ndItem = input.itemStack === "jjba:stand2";
                player.addTag(`chargeT${input.isSneaking ? "S" : ""}${is2ndItem ? "B" : ""}`);
            }
            delete queuedInputs[playerId];
        }
    }


    for (const playerId in holdingPlayers) {
        const player = world.getEntity(playerId);
        if (!player?.isValid) {
            delete holdingPlayers[playerId];
            continue;
        }

        const itemStack = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex);
        if (!itemStack || (itemStack.typeId !== "jjba:stand" && itemStack.typeId !== "jjba:stand2")) {
            delete holdingPlayers[playerId];
            continue;
        }

        const memory = getMemory(playerId);
        const isSneaking = holdingPlayers[playerId].isSneaking;
        const is2ndItem = itemStack.typeId === "jjba:stand2";

        if ((getStunScore(player) > 1 && !canBypassTsStun(player, itemStack.typeId, isSneaking)) || player.hasTag("clashing") || player.hasTag("ts_exhausted") || player.hasTag("mandom_windup") || player.hasTag("tusk_wormhole_barrage") || player.hasTag("twau_tandem")) {
            delete holdingPlayers[playerId];
            continue;
        }

        if (getCdScore(player) !== 0 || player.hasTag("onSkill")) {
            queuedInputs[playerId] = {
                type: "hold",
                isSneaking: holdingPlayers[playerId].isSneaking,
                itemStack: itemStack.typeId,
                tick: currentTick
            };
            delete holdingPlayers[playerId];
            continue;
        }

        if (isSneaking) {
            const isTuskWheelHold = is2ndItem && getScore(player, "standC") === 1;
            const sneakThreshold = isTuskWheelHold ? 8 : MaxHoldTime;
            if (memory.SneakCharge < sneakThreshold) {
                memory.SneakCharge++;
                if (memory.SneakCharge >= sneakThreshold) {
                    memory.SneakChargeMax = true;
                    player.removeTag("chargingS");
                    if (isTuskWheelHold) {
                        openTuskActWheel(player);
                    } else {
                        player.addTag(`chargeMS${is2ndItem ? "B" : ""}`);
                    }
                    memory.autoStopped = true;
                    delete holdingPlayers[playerId];
                }
            }
        } else {
            if (memory.charge < MaxHoldTime) {
                memory.charge++;
                if (memory.charge >= MaxHoldTime) {
                    memory.chargeMax = true;
                    player.removeTag("charging");
                    player.addTag(`chargeM${is2ndItem ? "B" : ""}`);
                    memory.autoStopped = true;
                    delete holdingPlayers[playerId];
                }
            }
        }
    }
}, 1);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    delete CombatMemory[playerId];
    delete holdingPlayers[playerId];
    delete queuedInputs[playerId];
});
