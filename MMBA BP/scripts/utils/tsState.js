export const tsStopperIds = new Set();
export const tsInvertActiveIds = new Set();
export const tsMutedActiveIds = new Set();

export function isTimeStopped() {
    return tsStopperIds.size > 0;
}

export function getTsHudToken(player) {
    if (!player?.id) return "";
    const tokens = [];
    if (tsInvertActiveIds.has(player.id)) tokens.push("ts_invert");
    if (tsMutedActiveIds.has(player.id)) tokens.push("ts_muted");
    return tokens.join(" ");
}
