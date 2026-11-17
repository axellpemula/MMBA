import {
    Colors,
    spawnImpactRing,
    spawnBlockShield,
    spawnGlowFlash,
    spawnStarburst,
    triggerImpactFrame
} from "../../utils/vfx.js";

export { Colors };

const UP = Object.freeze({ x: 0, y: 1, z: 0 });


function resolveTarget(targetOrDim, arg2, arg3) {
    if (!targetOrDim) return null;
    let dim = null;
    let loc = null;
    let hitLoc = null;
    let normal = UP;

    if (targetOrDim.dimension) {

        dim = targetOrDim.dimension;
        loc = targetOrDim.location;
        if (arg2 && typeof arg2.x === "number") {
            if (arg3 && typeof arg3.x === "number") {
                normal = arg2;
                hitLoc = arg3;
            } else {
                normal = arg2;
            }
        }
        if (!hitLoc) {
            hitLoc = { x: loc.x, y: loc.y + 1.0, z: loc.z };
        }
    } else if (typeof targetOrDim.spawnParticle === "function") {

        dim = targetOrDim;
        hitLoc = arg2 || { x: 0, y: 0, z: 0 };
        loc = hitLoc;
        if (arg3 && typeof arg3.x === "number") {
            normal = arg3;
        }
    }

    if (!dim || !hitLoc) return null;
    return { dim, loc: loc || hitLoc, hitLoc, normal };
}


export function playBlockStartVFX(player, viewDir = null) {
    if (!player?.isValid) return;
    try {
        const dim = player.dimension;
        const loc = player.location;
        let dir = viewDir;
        if (!dir || typeof dir.x !== "number") {
            try { dir = player.getViewDirection(); } catch { }
        }
        if (!dir || typeof dir.x !== "number") {
            dir = { x: 0, y: 0, z: 1 };
        }

        const shieldPos = {
            x: loc.x + dir.x * 0.8,
            y: loc.y + 1.1 + dir.y * 0.8,
            z: loc.z + dir.z * 0.8
        };

        spawnBlockShield(dim, shieldPos, dir, { size: 1.8, color: Colors.cyan, alpha: 0.9 });
        spawnImpactRing(dim, shieldPos, dir, { radius: 2.2, time: 0.22, color: Colors.cyan, alpha: 0.95 });
        spawnGlowFlash(dim, shieldPos, { size: 1.8, life: 0.2, color: Colors.cyan, alpha: 0.85 });
        dim.playSound("random.orb", loc, { volume: 0.7, pitch: 1.6 });
        dim.playSound("random.click", loc, { volume: 0.5, pitch: 1.5 });
    } catch { }
}


export function playBlockSustainVFX(player, viewDir = null) {
    if (!player?.isValid) return;
    try {
        const dim = player.dimension;
        const loc = player.location;
        let dir = viewDir;
        if (!dir || typeof dir.x !== "number") {
            try { dir = player.getViewDirection(); } catch { }
        }
        if (!dir || typeof dir.x !== "number") {
            dir = { x: 0, y: 0, z: 1 };
        }

        const shieldPos = {
            x: loc.x + dir.x * 1.2,
            y: loc.y + 1.1 + dir.y * 0.8,
            z: loc.z + dir.z * 1.2
        };

        spawnBlockShield(dim, shieldPos, dir, { size: 1.8, color: Colors.cyan, alpha: 0.75 });
    } catch { }
}


export function playBlockImpactVFX(defender, normal = UP, hitLoc = null) {
    const res = resolveTarget(defender, normal, hitLoc);
    if (!res) return;
    const { dim, loc, hitLoc: pos, normal: norm } = res;

    try {
        dim.spawnParticle("xvoid:parry_sparks", pos);
        spawnBlockShield(dim, pos, norm, { size: 2.0, color: Colors.cyan, alpha: 1.0 });
        spawnImpactRing(dim, pos, norm, { radius: 2.0, time: 0.22, color: Colors.cyan, alpha: 0.95 });
        spawnGlowFlash(dim, pos, { size: 1.6, life: 0.18, color: Colors.cyan, alpha: 0.8 });
        spawnStarburst(dim, pos, { size: 1.8, life: 0.22 });
        dim.playSound("random.anvil_land", loc, { volume: 0.6, pitch: 1.1 });
    } catch { }
}


export function playParryVFX(defender, normal = UP, hitLoc = null) {
    const res = resolveTarget(defender, normal, hitLoc);
    if (!res) return;
    const { dim, loc, hitLoc: pos, normal: norm } = res;

    try {

        triggerImpactFrame(dim, pos, 2);


        dim.spawnParticle("xvoid:parry_sparks", pos);
        spawnImpactRing(dim, pos, norm, { radius: 2.8, time: 0.28, color: Colors.gold, alpha: 0.95 });
        spawnGlowFlash(dim, pos, { size: 2.6, life: 0.18, color: Colors.gold, alpha: 0.9 });
        spawnStarburst(dim, pos, { size: 2.2, life: 0.25 });
        dim.playSound("random.anvil_land", loc, { volume: 0.9, pitch: 1.85 });
        dim.playSound("xvoid.flash1", loc, { volume: 0.8, pitch: 1.2 });
    } catch { }
}


export function playGuardBreakVFX(defender, hitLoc = null) {
    const res = resolveTarget(defender, UP, hitLoc);
    if (!res) return;
    const { dim, loc, hitLoc: pos } = res;

    try {
        dim.spawnParticle("xvoid:parry_sparks", pos);
        dim.spawnParticle("sfx:impact", loc);
        dim.spawnParticle("xvoid:dust_puff", pos);
        spawnImpactRing(dim, pos, UP, { radius: 2.8, time: 0.3, color: Colors.crimson, alpha: 0.95 });
        spawnGlowFlash(dim, pos, { size: 2.6, life: 0.2, color: Colors.crimson, alpha: 0.9 });
        dim.playSound("random.break", loc, { volume: 1.2, pitch: 0.7 });
        dim.playSound("xvoid.groundHit", loc, { volume: 0.9, pitch: 1.1 });
    } catch { }
}
