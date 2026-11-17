import { world, system } from "@minecraft/server";
import * as mc from "@minecraft/server";
import { isTimeStopped, getTsHudToken } from "./utils/tsState.js";


const playerSpecialStates = new Map();

export const MaxEnergy = 100;
export const MaxSpecial = 100;
const MaxCooldownTicks = 250;

function getPlayerState(playerId) {
    let state = playerSpecialStates.get(playerId);
    if (!state) {
        state = {
            cooldown: 0,
            progress: 0,
            energyCooldown: 0,
            energyProgress: 0,
            initialized: false,
            energyInitialized: false
        };
        playerSpecialStates.set(playerId, state);
    }
    return state;
}

function getOrCreateSpecialObjective() {
    let objective = world.scoreboard.getObjective("special");
    if (!objective) {
        try {
            objective = world.scoreboard.addObjective("special", "special");
        } catch {
            return world.scoreboard.getObjective("special");
        }
    }
    return objective;
}

function getOrCreateEnergyObjective() {
    let objective = world.scoreboard.getObjective("energy");
    if (!objective) {
        try {
            objective = world.scoreboard.addObjective("energy", "energy");
        } catch {
            return world.scoreboard.getObjective("energy");
        }
    }
    return objective;
}

export function getMaxEnergy(player) {
    return MaxEnergy;
}

export function getMaxSpecial(player) {
    return MaxSpecial;
}

export function isPlayerInTimeStopOrCharging(player) {
    if (!player || !player.isValid) return false;
    if (player.hasTag("ts_counter_charge")) return false;
    if (player.hasTag("ts_exhausted") || player.hasTag("mandom_windup") || player.hasTag("ts") || player.hasTag("tsed") || isTimeStopped()) {
        return true;
    }
    try {
        const tsScore = world.scoreboard.getObjective("ts")?.getScore(player.scoreboardIdentity ?? player) ?? 0;
        if (tsScore > 0) return true;
    } catch { }
    return false;
}

export function getEnergy(player) {
    if (!player) return 0;
    const state = playerSpecialStates.get(player.id);
    if (state && typeof state.exactEnergy === "number") {
        return state.exactEnergy;
    }
    const objective = getOrCreateEnergyObjective();
    if (!objective) return 0;
    try {
        const score = objective.getScore(player.scoreboardIdentity ?? player);
        if (typeof score === "number") {
            if (state) state.exactEnergy = score;
            return score;
        }
    } catch { }
    try {
        const score = objective.getScore(player);
        if (typeof score === "number") {
            if (state) state.exactEnergy = score;
            return score;
        }
    } catch { }
    return 0;
}

export function setEnergy(player, amount) {
    if (!player || !player.isValid) return;
    const current = getEnergy(player);

    if (isPlayerInTimeStopOrCharging(player) && amount > current) {
        return;
    }
    const state = getPlayerState(player.id);
    state.exactEnergy = Math.max(0, Math.min(MaxEnergy, amount));
    const objective = getOrCreateEnergyObjective();
    if (!objective) return;
    const clamped = Math.max(0, Math.min(MaxEnergy, Math.round(state.exactEnergy)));

    let success = false;
    try {
        objective.setScore(player.scoreboardIdentity ?? player, clamped);
        success = true;
    } catch { }

    if (!success) {
        try {
            objective.setScore(player, clamped);
            success = true;
        } catch { }
    }

    if (!success) {
        try {
            player.runCommand(`scoreboard players set @s energy ${clamped}`);
        } catch { }
    }
}

export function removeEnergy(player, amount) {
    setEnergy(player, getEnergy(player) - amount);
}

export function addEnergy(player, amount) {
    if (!player || !player.isValid) return;

    if (isPlayerInTimeStopOrCharging(player)) return;
    setEnergy(player, getEnergy(player) + amount);
}

export function getEnergyCooldown(player) {
    if (!player) return 0;
    const state = playerSpecialStates.get(player.id);
    return state ? state.energyCooldown : 0;
}

export function setEnergyCooldown(player, ticks) {
    if (!player) return;
    const state = getPlayerState(player.id);
    state.energyCooldown = Math.min(MaxCooldownTicks, Math.max(0, Math.round(ticks)));
}


export function useEnergy(player, cost, delayTicks = 0) {
    if (!player || !player.isValid) return false;
    cost = Number(cost);
    if (isNaN(cost) || cost < 0) return false;

    const current = getEnergy(player);
    const deficit = Math.max(0, cost - current);

    setEnergy(player, current - cost);

    const state = getPlayerState(player.id);
    const baseCooldown = Math.max(0, Math.round(Number(delayTicks) || 0));
    const targetCooldown = Math.max(state.energyCooldown, baseCooldown) + Math.round(deficit);
    state.energyCooldown = Math.min(MaxCooldownTicks, Math.max(0, targetCooldown));
    state.energyProgress = 0;

    return true;
}

export function getSpecial(player) {
    if (!player) return 0;
    const objective = getOrCreateSpecialObjective();
    if (!objective) return 0;
    try {
        const score = objective.getScore(player.scoreboardIdentity ?? player);
        if (typeof score === "number") return score;
    } catch { }
    try {
        const score = objective.getScore(player);
        if (typeof score === "number") return score;
    } catch { }
    return 0;
}

export function setSpecial(player, amount) {
    if (!player || !player.isValid) return;
    const objective = getOrCreateSpecialObjective();
    if (!objective) return;
    const maxSpecial = getMaxSpecial(player);
    const clamped = Math.max(0, Math.min(maxSpecial, Math.round(amount)));

    let success = false;
    try {
        objective.setScore(player.scoreboardIdentity ?? player, clamped);
        success = true;
    } catch { }

    if (!success) {
        try {
            objective.setScore(player, clamped);
            success = true;
        } catch { }
    }

    if (!success) {
        try {
            player.runCommand(`scoreboard players set @s special ${clamped}`);
        } catch { }
    }
}

export function removeSpecial(player, amount) {
    setSpecial(player, getSpecial(player) - amount);
}

export function addSpecial(player, amount) {
    setSpecial(player, getSpecial(player) + amount);
}

export function getSpecialCooldown(player) {
    if (!player) return 0;
    const state = playerSpecialStates.get(player.id);
    return state ? state.cooldown : 0;
}

export function setSpecialCooldown(player, ticks) {
    if (!player) return;
    const state = getPlayerState(player.id);
    state.cooldown = Math.min(MaxCooldownTicks, Math.max(0, Math.round(ticks)));
}


export function parseSpecialSkillArgs(input) {
    if (Array.isArray(input)) {
        const cost = Number(input[0]);
        const cooldown = input[1] !== undefined && input[1] !== null && input[1] !== "" ? Number(input[1]) : 0;
        if (isNaN(cost) || cost < 0) return null;
        return { cost, cooldown: isNaN(cooldown) || cooldown < 0 ? 0 : Math.round(cooldown) };
    }

    if (typeof input !== "string") {
        input = String(input ?? "");
    }
    input = input.trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    if (lower === "max" || lower === "full" || lower === "reset") {
        return { action: "max" };
    }
    if (lower.startsWith("charge") || lower.startsWith("add") || lower.startsWith("+")) {
        const numStr = input.replace(/^(charge|add|\+)\s*/i, "").trim();
        const amount = parseFloat(numStr) || 1;
        return { action: "charge", amount };
    }

    if (lower.startsWith("skill")) {
        input = input.slice(5).trim();
    }

    let cost = 0;
    let cooldown = 0;

    if (input.includes("/")) {
        const parts = input.split("/").map(s => s.trim());
        cost = parseFloat(parts[0]);
        cooldown = parts[1] !== undefined && parts[1] !== "" ? parseFloat(parts[1]) : 0;
    } else if (input.includes(" ")) {
        const parts = input.split(/\s+/);
        cost = parseFloat(parts[0]);
        cooldown = parts[1] !== undefined ? parseFloat(parts[1]) : 0;
    } else {
        cost = parseFloat(input);
        cooldown = 0;
    }

    if (isNaN(cost) || cost < 0) return null;
    if (isNaN(cooldown) || cooldown < 0) cooldown = 0;

    return { cost, cooldown: Math.round(cooldown) };
}


export function useSpecialSkill(player, costPercent, delayTicks = 0) {
    if (!player || !player.isValid) return false;

    const maxSpecial = getMaxSpecial(player);
    const currentSpecial = getSpecial(player);
    const currentPercent = maxSpecial > 0 ? (currentSpecial / maxSpecial) * 100 : 0;

    let deficitPercent = 0;
    let newSpecial = 0;

    if (currentPercent >= costPercent) {
        deficitPercent = 0;
        const newPercent = currentPercent - costPercent;
        newSpecial = Math.round((newPercent / 100) * maxSpecial);
    } else {
        deficitPercent = costPercent - currentPercent;
        newSpecial = 0;
    }

    setSpecial(player, newSpecial);

    const state = getPlayerState(player.id);
    const baseCooldown = Math.max(0, Math.round(delayTicks));
    const deficitTicks = Math.round(deficitPercent);


    const targetCooldown = Math.max(state.cooldown, baseCooldown) + deficitTicks;
    state.cooldown = Math.min(MaxCooldownTicks, Math.max(0, targetCooldown));
    state.progress = 0;

    return true;
}

export function executeSpecialSkill(player, argString) {
    if (!player || !player.isValid) return false;
    const parsed = parseSpecialSkillArgs(argString);
    if (!parsed) return false;

    if (parsed.action === "max") {
        const max = getMaxSpecial(player);
        setSpecial(player, max);
        const state = getPlayerState(player.id);
        state.cooldown = 0;
        state.progress = 0;
        return true;
    }

    if (parsed.action === "charge") {
        const state = getPlayerState(player.id);
        if (state.cooldown <= 0) {
            addSpecial(player, parsed.amount ?? 1);
        }
        return true;
    }

    return useSpecialSkill(player, parsed.cost, parsed.cooldown);
}

function resolvePlayerFromMessage(rawMessage) {
    const trimmed = (rawMessage ?? "").trim();
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx !== -1) {
        const token = trimmed.slice(0, spaceIdx).trim().toLowerCase();
        const remaining = trimmed.slice(spaceIdx + 1).trim();

        if (token === "@p" || token === "@s" || token === "@a") {
            const players = world.getAllPlayers();
            if (players.length > 0) return { player: players[0], args: remaining };
        }

        for (const p of world.getAllPlayers()) {
            if (p.name.toLowerCase() === token) {
                return { player: p, args: remaining };
            }
        }
    }
    return { player: null, args: trimmed };
}

const playerAirState = new Map();

function canBreatheWater(player, breathable) {
    try {
        if (breathable?.breathesWater) return true;
    } catch { }
    try {
        if (player.getEffect("water_breathing") || player.getEffect("conduit_power")) return true;
    } catch { }
    return false;
}

function getHeadFluidInfo(player) {
    try {
        const head = player.getHeadLocation();
        const block = player.dimension.getBlock(head);
        if (!block) return { inWater: false, inLava: false };
        const isLava = block.typeId === "minecraft:lava" || block.typeId === "minecraft:flowing_lava";
        if (isLava) return { inWater: false, inLava: true };
        const inWater = Boolean(block.isLiquid || block.isWaterlogged);
        return { inWater, inLava: false };
    } catch {
        return { inWater: false, inLava: false };
    }
}

function hasHudAirBubbles(player, isCreative) {
    if (isCreative) {
        playerAirState.delete(player.id);
        return false;
    }
    const tick = system.currentTick;
    let st = playerAirState.get(player.id);
    if (st && tick - st.tick < 2) {
        return st.showBubbles;
    }

    let breathable = null;
    try {
        breathable = player.getComponent("minecraft:breathable");
    } catch { }

    const maxAir = Math.max(1, Math.round((breathable?.totalSupply > 0 ? breathable.totalSupply : 15) * 20));
    const inhaleRate = maxAir / Math.max(1, (breathable?.inhaleTime > 0 ? breathable.inhaleTime : 3) * 20);
    const dt = st ? Math.max(1, tick - st.tick) : 1;
    let air = st ? st.air : maxAir;

    const { inWater, inLava } = getHeadFluidInfo(player);
    let breathesOk = true;
    if (inLava) {
        breathesOk = Boolean(breathable?.breathesLava);
    } else if (inWater) {
        breathesOk = canBreatheWater(player, breathable);
    } else {
        breathesOk = breathable?.breathesAir ?? true;
    }

    air = breathesOk
        ? Math.min(maxAir, air + inhaleRate * dt)
        : Math.max(0, air - dt);

    const showBubbles = air < maxAir || inWater;
    playerAirState.set(player.id, { tick, air, showBubbles });
    return showBubbles;
}

function getMountHeartRows(player) {
    try {
        const riding = player.getComponent("minecraft:riding")?.entityRidingOn;
        if (!riding?.isValid) return 0;
        const mountHealth = riding.getComponent("minecraft:health");
        if (!mountHealth) return 0;
        const maxHp = Math.max(
            mountHealth.effectiveMax ?? 0,
            mountHealth.currentValue ?? 0,
            mountHealth.defaultValue ?? 20
        );
        if (maxHp <= 0) return 0;
        return Math.max(1, Math.min(4, Math.ceil(maxHp / 20)));
    } catch {
        return 0;
    }
}

function getHudPositionToken(player) {
    let gm = "survival";
    try {
        gm = String(player.getGameMode?.() ?? "survival").toLowerCase();
    } catch { }

    if (gm === "spectator") return "pos:hide";

    const isCreative = gm === "creative";
    const mountRows = getMountHeartRows(player);
    if (isCreative && mountRows === 0) return "pos:c";

    const showBubbles = hasHudAirBubbles(player, isCreative);


    const totalRightRows = isCreative
        ? mountRows
        : 1 + mountRows + (showBubbles ? 1 : 0);
    const extraRows = Math.max(0, Math.min(5, totalRightRows - 1));
    if (extraRows === 0) return "pos:s0";
    const rowFlags = [];
    for (let i = 1; i <= extraRows; i++) {
        rowFlags.push(`r${i};`);
    }
    return `pos:s${extraRows} ${rowFlags.join(" ")}`;
}


system.runInterval(() => {
    getOrCreateEnergyObjective();
    getOrCreateSpecialObjective();

    for (const player of world.getAllPlayers()) {
        if (!player?.isValid) continue;

        const state = getPlayerState(player.id);


        if (!state.energyInitialized) {
            state.energyInitialized = true;
            if (getEnergy(player) <= 0) {
                setEnergy(player, MaxEnergy);
            }
        }


        const tsActive = isPlayerInTimeStopOrCharging(player);
        const isEnergyRegenPaused = player.hasTag("blocking") || player.hasTag("tusk_rotation") || player.hasTag("tusk_wormhole_barrage") || player.hasTag("twau_tandem");
        if (tsActive || isEnergyRegenPaused) {
            state.energyProgress = 0;
        } else if (state.energyCooldown > 0) {
            state.energyCooldown--;
            state.energyProgress = 0;
        } else {
            const currentEnergy = getEnergy(player);
            if (currentEnergy < MaxEnergy) {
                state.energyProgress = (state.energyProgress ?? 0) + (MaxEnergy / 200);
                if (state.energyProgress >= 1) {
                    const addE = Math.floor(state.energyProgress);
                    state.energyProgress -= addE;
                    setEnergy(player, currentEnergy + addE);
                }
            } else {
                state.energyProgress = 0;
                if (currentEnergy > MaxEnergy) {
                    setEnergy(player, MaxEnergy);
                }
            }
        }


        if (!state.initialized) {
            state.initialized = true;
        }


        if (state.cooldown > 0) {
            state.cooldown--;
            state.progress = 0;
            continue;
        }


        const currentSpecial = getSpecial(player);
        if (currentSpecial > MaxSpecial) {
            setSpecial(player, MaxSpecial);
        }
    }
}, 1);

let tuskHudTokenProvider = null;
let smDinoHudTokenProvider = null;

export function registerTuskHudTokenProvider(fn) {
    tuskHudTokenProvider = fn;
}

export function registerSmDinoHudTokenProvider(fn) {
    smDinoHudTokenProvider = fn;
}

export function pushPlayerHudTitle(player) {
    if (!player?.isValid) return;

    const tuskToken = tuskHudTokenProvider ? (tuskHudTokenProvider(player) || "") : "";
    const tsHudToken = getTsHudToken(player);
    const smDinoToken = smDinoHudTokenProvider ? (smDinoHudTokenProvider(player) || "") : "";
    const posToken = getHudPositionToken(player);

    const energy = getEnergy(player);
    const energyVal = Math.round(Math.max(0, Math.min(MaxEnergy, energy)));

    let titleText = `_mmba: ${posToken} energy:${energyVal}`;
    const standC = world.scoreboard.getObjective("standC")?.getScore(player) ?? 0;
    const hasSpec = player.hasTag("hamon") || player.hasTag("spin") || player.hasTag("spinUser") || (standC === 1 && getSpecial(player) > 0);
    if (hasSpec) {
        const specialScore = getSpecial(player);
        const specialVal = Math.round(Math.max(0, Math.min(MaxSpecial, specialScore)));
        titleText += ` power:${specialVal}`;
    }


    const tsObj = world.scoreboard.getObjective("ts");
    const tsScore = tsObj ? (tsObj.getScore(player) ?? 0) : 0;
    if (tsScore >= 2 || player.hasTag("ts")) {
        const tsVal = Math.round(Math.max(0, Math.min(100, tsScore)));
        titleText += ` ts:${tsVal}`;
    }

    if (player.hasTag("ataxia")) {
        titleText += " ataxia";
    }

    if (tuskToken) {
        titleText += ` ${tuskToken}`;
    }

    if (tsHudToken) {
        titleText += ` ${tsHudToken}`;
    }

    if (smDinoToken) {
        titleText += ` ${smDinoToken}`;
    }

    try {
        player.onScreenDisplay.setTitle(titleText);
    } catch { }
}


system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        pushPlayerHudTitle(player);
    }
}, 2);


world.afterEvents?.playerLeave?.subscribe(({ playerId }) => {
    playerSpecialStates.delete(playerId);
    playerAirState.delete(playerId);
});


world.afterEvents?.playerSpawn?.subscribe(({ player, initialSpawn }) => {
    if (!player || initialSpawn) return;
    playerAirState.delete(player.id);
    const state = playerSpecialStates.get(player.id);
    if (state) {
        state.cooldown = 0;
        state.progress = 0;
        state.energyCooldown = 0;
        state.energyProgress = 0;
    }
});


system.beforeEvents.startup.subscribe((init) => {
    const registry = init?.customCommandRegistry;
    if (!registry?.registerCommand) {
        console.warn("[energy.js] customCommandRegistry not available (need @minecraft/server 2.x)");
        return;
    }

    const successStatus = mc.CustomCommandStatus?.Success ?? 0;
    const failureStatus = mc.CustomCommandStatus?.Failure ?? 1;
    const permAny = mc.CommandPermissionLevel?.Any ?? mc.CustomCommandPermissionLevel?.Any ?? 0;
    const intType = mc.CustomCommandParamType?.Integer ?? 0;

    const getPlayer = (origin) => {
        const p = origin?.sourceEntity;
        return p && p.typeId === "minecraft:player" ? p : null;
    };

    try {

        registry.registerCommand(
            {
                name: "xvoid:specialskill",
                description: "Consume special power (<cost> [cooldown])",
                cheatsRequired: false,
                permissionLevel: permAny,
                mandatoryParameters: [{ type: intType, name: "cost" }],
                optionalParameters: [{ type: intType, name: "cooldown" }]
            },
            (origin, cost, cooldown) => {
                const player = getPlayer(origin);
                if (!player) {
                    return { status: failureStatus, message: "This command must be run by a player." };
                }
                system.run(() => {
                    executeSpecialSkill(player, [cost, cooldown ?? 0]);
                });
                return { status: successStatus };
            }
        );


        registry.registerCommand(
            {
                name: "xvoid:energy",
                description: "Consume energy (<cost> [cooldown])",
                cheatsRequired: false,
                permissionLevel: permAny,
                mandatoryParameters: [{ type: intType, name: "cost" }],
                optionalParameters: [{ type: intType, name: "cooldown" }]
            },
            (origin, cost, cooldown) => {
                const player = getPlayer(origin);
                if (!player) {
                    return { status: failureStatus, message: "This command must be run by a player." };
                }
                system.run(() => {
                    useEnergy(player, cost, cooldown ?? 0);
                });
                return { status: successStatus };
            }
        );
    } catch (e) {
        console.warn(`[energy.js] Failed to register commands: ${e}`);
    }
});


system.afterEvents.scriptEventReceive.subscribe((event) => {
    const id = (event.id ?? "").toLowerCase();
    if (!id.endsWith(":skill") && !id.endsWith(":special") && !id.endsWith(":specialskill")) return;

    let player = event.sourceEntity;
    let message = event.message ?? "";

    if (!player || player.typeId !== "minecraft:player") {
        const resolved = resolvePlayerFromMessage(message);
        if (!resolved.player) return;
        player = resolved.player;
        message = resolved.args;
    }

    executeSpecialSkill(player, message);
});
