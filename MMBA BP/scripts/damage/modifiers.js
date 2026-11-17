export function parseAttackModifiers(args) {
    const modifiers = {
        hitCount: null,
        durationSeconds: null,
        intervalTicks: 1,
        stagger: false,
        barrage: false,
        barragePush: 1,
        barrageDown: 0.5,
        heavy: false,
        heavyBack: 0,
        heavyUp: 0,
        downslam: false,
        downslamTicks: 28,
        downslamPush: 0.35,
        blockable: false,
        stay: false,
        delayTicks: 0
    };

    for (const arg of args) {
        const normalized = arg.toLowerCase();
        if (normalized.startsWith("hit:")) {
            const value = parseInt(arg.slice(4), 10);
            if (!Number.isNaN(value) && value > 0) modifiers.hitCount = value;
        } else if (normalized.startsWith("dur:")) {
            const value = parseFloat(arg.slice(4));
            if (!Number.isNaN(value) && value > 0) modifiers.durationSeconds = value;
        } else if (normalized.startsWith("int:")) {
            const value = parseFloat(arg.slice(4));
            if (!Number.isNaN(value) && value >= 1) modifiers.intervalTicks = Math.max(1, Math.floor(value));
        } else if (normalized.startsWith("delay:")) {

            const raw = arg.slice(6);
            if (raw.toLowerCase().endsWith("s")) {
                const seconds = parseFloat(raw.slice(0, -1));
                if (!Number.isNaN(seconds) && seconds >= 0) modifiers.delayTicks = Math.round(seconds * 20);
            } else {
                const ticks = parseInt(raw, 10);
                if (!Number.isNaN(ticks) && ticks >= 0) modifiers.delayTicks = ticks;
            }
        } else if (normalized === "stagger") {
            modifiers.stagger = true;
        } else if (normalized.startsWith("barrage")) {
            modifiers.barrage = true;
            if (normalized.includes(":")) {
                const parts = normalized.slice(8).split("/");
                if (parts.length === 1) {
                    const push = parseFloat(parts[0]);
                    if (!Number.isNaN(push)) modifiers.barragePush = push;
                } else if (parts.length >= 2) {
                    const push = parseFloat(parts[0]);
                    const down = parseFloat(parts[1]);
                    if (!Number.isNaN(push)) modifiers.barragePush = push;
                    if (!Number.isNaN(down)) modifiers.barrageDown = down;
                }
            }
        } else if (normalized.startsWith("heavy:")) {
            modifiers.heavy = true;
            const parts = normalized.slice(6).split("/");
            if (parts.length === 1) {
                const back = parseFloat(parts[0]);
                if (!Number.isNaN(back)) modifiers.heavyBack = back;
            } else if (parts.length >= 2) {
                const back = parseFloat(parts[0]);
                const up = parseFloat(parts[1]);
                if (!Number.isNaN(back)) modifiers.heavyBack = back;
                if (!Number.isNaN(up)) modifiers.heavyUp = up;
            }
        } else if (normalized === "downslam" || normalized.startsWith("downslam:")) {
            modifiers.downslam = true;
            if (normalized.includes(":")) {
                const parts = normalized.slice(9).split("/");
                const ticks = parseInt(parts[0], 10);
                if (!Number.isNaN(ticks) && ticks > 0) modifiers.downslamTicks = ticks;
                if (parts.length >= 2) {
                    const push = parseFloat(parts[1]);
                    if (!Number.isNaN(push)) modifiers.downslamPush = push;
                }
            }
        } else if (normalized === "stay") {
            modifiers.stay = true;
        } else if (normalized === "blockable") {
            modifiers.blockable = true;
        }
    }

    return modifiers;
}


export function parseOffsetNotation(notation, playerViewDir = { x: 0, y: 0, z: -1 }) {
    if (!notation || notation === "") {
        return { x: 0, y: 0, z: 0 };
    }


    if (notation.match(/^\^{3}(-?\d+(?:\.\d+)?)$/)) {
        const value = parseFloat(notation.slice(3));
        return {
            x: playerViewDir.x * value,
            y: 0,
            z: playerViewDir.z * value
        };
    }


    if (notation.match(/^\^{2}(-?\d+(?:\.\d+)?)$/)) {
        const value = parseFloat(notation.slice(2));
        return { x: 0, y: value, z: 0 };
    }


    if (notation.match(/^\^(-?\d+(?:\.\d+)?)$/)) {
        const value = parseFloat(notation.slice(1));
        const rightX = -playerViewDir.z;
        const rightZ = playerViewDir.x;
        return { x: rightX * value, y: 0, z: rightZ * value };
    }


    if (notation.includes("~")) {
        const regex = /~(-?\d+(?:\.\d+)?)?~(-?\d+(?:\.\d+)?)?~(-?\d+(?:\.\d+)?)?/;
        const match = notation.match(regex);
        if (match) {
            return {
                x: match[1] ? parseFloat(match[1]) : 0,
                y: match[2] ? parseFloat(match[2]) : 0,
                z: match[3] ? parseFloat(match[3]) : 0
            };
        }
    }

    return { x: 0, y: 0, z: 0 };
}


export function parseParticleParameter(args, playerViewDir) {
    const particleArg = args.find(arg => arg.toLowerCase().startsWith("p="));
    if (!particleArg) return null;

    const particleName = particleArg.slice(2);
    let offset = { x: 0, y: 0, z: 0 };

    const particleIndex = args.indexOf(particleArg);
    if (particleIndex >= 0 && particleIndex < args.length - 1) {
        const nextArg = args[particleIndex + 1];
        if (nextArg && (nextArg.includes("~") || nextArg.includes("^"))) {
            offset = parseOffsetNotation(nextArg, playerViewDir);
        }
    }

    return { name: particleName, offset };
}
