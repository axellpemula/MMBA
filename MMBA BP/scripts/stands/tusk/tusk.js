import { world, system } from "@minecraft/server";
import { registerTuskHudTokenProvider } from "../../energy.js";
import { isTimeStopped } from "../../utils/tsState.js";

export const MaxNails = 10;

export const RegenTicks = [40, 150, 100, 40];

const NailsObjective = "nails";
const tuskStates = new Map();

function getOrCreateNailsObjective() {
    let obj = world.scoreboard.getObjective(NailsObjective);
    if (!obj) {
        try {
            obj = world.scoreboard.addObjective(NailsObjective, NailsObjective);
        } catch {
            obj = world.scoreboard.getObjective(NailsObjective);
        }
    }
    return obj;
}

function getScore(player, objName) {
    try {
        const obj = world.scoreboard.getObjective(objName);
        return obj ? (obj.getScore(player) ?? 0) : 0;
    } catch {
        return 0;
    }
}

function readRawNailsScore(player) {
    try {
        const obj = getOrCreateNailsObjective();
        if (!obj) return undefined;
        return obj.getScore(player);
    } catch {
        return undefined;
    }
}

function writeNailsScore(player, value) {
    if (!player?.isValid) return;
    try {
        const obj = getOrCreateNailsObjective();
        if (obj) obj.setScore(player, value);
    } catch { }
}

function getAct(player) {
    return Math.max(0, Math.min(3, getScore(player, "act") | 0));
}

function isTuskUser(player) {
    return Boolean(player?.isValid) && getScore(player, "standC") === 1;
}

function getOrCreateState(player) {
    const id = player.id;
    let st = tuskStates.get(id);
    if (!st) {
        const existing = readRawNailsScore(player);
        const startNails = typeof existing === "number"
            ? Math.max(0, Math.min(MaxNails, existing | 0))
            : MaxNails;
        st = {
            nailsReady: startNails,
            lastSyncedScore: startNails,
            regenProgress: 0
        };
        tuskStates.set(id, st);
        if (existing !== startNails) {
            writeNailsScore(player, startNails);
        }
    }
    return st;
}


export function getNails(player) {
    if (!player?.isValid) return 0;
    return getOrCreateState(player).nailsReady;
}


export function getNailRegenProgress(player) {
    if (!player?.isValid) return 0;
    return getOrCreateState(player).regenProgress;
}


export function setNails(player, count) {
    if (!player?.isValid) return 0;
    const st = getOrCreateState(player);
    const clamped = Math.max(0, Math.min(MaxNails, Math.floor(Number(count) || 0)));
    st.nailsReady = clamped;
    if (clamped >= MaxNails) st.regenProgress = 0;
    st.lastSyncedScore = clamped;
    writeNailsScore(player, clamped);
    return clamped;
}


export function addNails(player, amount = 1) {
    if (!player?.isValid) return 0;
    const st = getOrCreateState(player);
    return setNails(player, st.nailsReady + Math.floor(Number(amount) || 0));
}


export function consumeNails(player, count = 1, requireFull = false) {
    if (!player?.isValid) return 0;
    const want = Math.max(0, Math.floor(Number(count) || 0));
    if (want === 0) return 0;
    const st = getOrCreateState(player);
    if (st.nailsReady <= 0 || (requireFull && st.nailsReady < want)) return 0;
    const spent = Math.min(want, st.nailsReady);
    st.nailsReady -= spent;
    st.lastSyncedScore = st.nailsReady;
    writeNailsScore(player, st.nailsReady);
    return spent;
}

function resolveTargetPlayer(event) {
    let player = event.sourceEntity ?? event.initiator;
    if (player?.isValid && player.typeId === "minecraft:player") return player;
    const all = world.getAllPlayers();
    return all.length === 1 && all[0]?.isValid ? all[0] : null;
}

function handleNailScriptEvent(player, rawMsg) {
    const trimmed = String(rawMsg ?? "").trim();
    if (!trimmed) {
        consumeNails(player, 1);
        return;
    }

    const parts = trimmed.split(/[\s/]+/);
    const head = parts[0].toLowerCase();

    if (head === "max" || head === "full" || head === "reset") {
        const st = getOrCreateState(player);
        st.regenProgress = 0;
        setNails(player, MaxNails);
        return;
    }
    if (head === "clear" || head === "empty") {
        const st = getOrCreateState(player);
        st.regenProgress = 0;
        setNails(player, 0);
        return;
    }
    if (head === "set") {
        setNails(player, Number(parts[1] ?? 0));
        return;
    }
    if (head === "add" || head.startsWith("+")) {
        const val = head.startsWith("+") ? Number(head.slice(1) || parts[1] || 1) : Number(parts[1] ?? 1);
        addNails(player, Math.max(0, val));
        return;
    }
    if (head === "consume" || head === "use" || head === "remove") {
        consumeNails(player, Number(parts[1] ?? 1));
        return;
    }
    if (head.startsWith("-")) {
        consumeNails(player, Number(head.slice(1) || parts[1] || 1));
        return;
    }

    const numericCost = Number(head);
    if (!Number.isNaN(numericCost)) {
        consumeNails(player, numericCost);
    }
}

system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "xvoid:nail") return;
    const player = resolveTargetPlayer(event);
    if (!player?.isValid) return;
    handleNailScriptEvent(player, event.message);
});


registerTuskHudTokenProvider((player) => {
    if (!isTuskUser(player)) return "";
    const act = getAct(player);
    if (act > 2) return "";

    const st = getOrCreateState(player);
    const tokens = [`tA${act + 1}`];
    for (let i = 0; i < MaxNails; i++) {
        if (i < st.nailsReady) tokens.push(`n${i}R`);
    }
    if (st.nailsReady < MaxNails && st.regenProgress > 0) {
        const step = Math.min(7, Math.floor(st.regenProgress * 8));
        if (step >= 1) {
            tokens.push(`n${st.nailsReady}F${step}`);
        }
    }
    return `tusk:${tokens.join(";")};`;
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!player?.isValid || initialSpawn) return;
    if (!isTuskUser(player)) return;
    const st = getOrCreateState(player);
    st.regenProgress = 0;
    setNails(player, MaxNails);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    tuskStates.delete(playerId);
});


system.runInterval(() => {
    getOrCreateNailsObjective();
    const frozen = isTimeStopped();

    for (const player of world.getAllPlayers()) {
        if (!player?.isValid) continue;
        if (!isTuskUser(player)) continue;

        const st = getOrCreateState(player);


        const sbScore = readRawNailsScore(player);
        if (typeof sbScore === "number" && sbScore !== st.lastSyncedScore) {
            const clamped = Math.max(0, Math.min(MaxNails, sbScore | 0));
            st.nailsReady = clamped;
            if (clamped >= MaxNails) st.regenProgress = 0;
            st.lastSyncedScore = clamped;
            if (clamped !== sbScore) writeNailsScore(player, clamped);
        }

        const isVictimFrozen = frozen && !player.hasTag("ts");
        const isRotationPaused = player.hasTag("tusk_rotation") || player.hasTag("tusk_detached") || player.hasTag("tusk_spatial") || player.hasTag("tusk_wormhole_barrage");
        if (!isVictimFrozen && !isRotationPaused && st.nailsReady < MaxNails) {
            const act = getAct(player);
            const ticksPerNail = RegenTicks[act] ?? 40;
            st.regenProgress += 1 / ticksPerNail;
            if (st.regenProgress >= 1) {
                const gained = Math.floor(st.regenProgress);
                st.nailsReady = Math.min(MaxNails, st.nailsReady + gained);
                st.regenProgress = st.nailsReady >= MaxNails ? 0 : (st.regenProgress - gained);
            }
        } else if (st.nailsReady >= MaxNails) {
            st.regenProgress = 0;
        }

        if (sbScore !== st.nailsReady || st.lastSyncedScore !== st.nailsReady) {
            writeNailsScore(player, st.nailsReady);
            st.lastSyncedScore = st.nailsReady;
        }
    }
}, 1);
