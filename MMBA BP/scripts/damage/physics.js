import { system, world } from "@minecraft/server";
import { Colors, spawnImpactRing, spawnPunchShockwave, spawnGlowFlash, spawnStarburst } from "../utils/vfx.js";

const trackedEntities = new Map();


const CrashVelocityThreshold = 0.5;

export function applyHeavyKnockback(target, casterViewDir, backDist, upDist) {
    if (!target?.isValid || target.hasTag("tusk_detached") || target.hasTag("tusk_spatial") || target.hasTag("tusk_rotation")) return;

    const viewLength = Math.sqrt(casterViewDir.x * casterViewDir.x + casterViewDir.z * casterViewDir.z);
    let dirX = 0, dirZ = 0;
    if (viewLength > 0.001) {
        dirX = casterViewDir.x / viewLength;
        dirZ = casterViewDir.z / viewLength;
    } else {
        dirZ = -1;
    }

    try {


        const impulseH = backDist * 0.25;
        const impulseV = upDist > 0 ? upDist * 0.3 : 0;


        target.applyKnockback({ x: dirX * impulseH, z: dirZ * impulseH }, impulseV);
    } catch(e) {
        console.warn(`Failed to apply heavy knockback: ${e}`);
    }


    trackedEntities.set(target.id, {
        entity: target,
        lastVelocity: { x: 0, y: 0, z: 0 },
        ticksAirborne: 0,
        active: true
    });
}

system.runInterval(() => {
    for (const [id, data] of trackedEntities.entries()) {
        const target = data.entity;

        try {

            target.location;
        } catch(e) {
            trackedEntities.delete(id);
            continue;
        }

        let vel;
        try {
            vel = target.getVelocity();
        } catch(e) {
            trackedEntities.delete(id);
            continue;
        }

        const hMag = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
        const vMag = Math.abs(vel.y);


        const pVel = data.lastVelocity;
        const pMagH = Math.sqrt(pVel.x * pVel.x + pVel.z * pVel.z);

        let crashed = false;
        let crashMomentum = 0;


        if (data.ticksAirborne > 1) {


            if (pMagH > CrashVelocityThreshold && hMag < pMagH * 0.3) {
                crashed = true;
                crashMomentum = pMagH;
            }


            if (pVel.y < -CrashVelocityThreshold && vel.y > pVel.y * 0.3) {
                crashed = true;
                crashMomentum = Math.max(crashMomentum, Math.abs(pVel.y));
            }
        }

        if (crashed) {

            try {
                const stunObj = world.scoreboard.getObjective("stun");
                if (stunObj) stunObj.setScore(target, 20);


                const damage = crashMomentum * 10;
                target.applyDamage(damage, { cause: "fall" });


                const crashLoc = { x: target.location.x, y: target.location.y + 0.5, z: target.location.z };
                const crashNormal = Math.abs(pVel.y) > pMagH
                    ? { x: 0, y: 1, z: 0 }
                    : { x: -pVel.x, y: 0.1, z: -pVel.z };
                spawnPunchShockwave(target.dimension, crashLoc, crashNormal);
                spawnImpactRing(target.dimension, crashLoc, crashNormal, {
                    radius: Math.min(5.5, 2.8 + crashMomentum * 1.5),
                    time: 0.36,
                    color: Colors.steel,
                    alpha: 0.85,
                    soft: false
                });
                spawnGlowFlash(target.dimension, crashLoc, {
                    size: 2.6,
                    life: 0.32,
                    color: Colors.hot,
                    alpha: 0.65
                });
                spawnStarburst(target.dimension, crashLoc, { size: 1.9, life: 0.25 });

                target.dimension.playSound("dig.stone", target.location);
            } catch(e) {}


            try { target.removeTag("knock"); } catch(e) {}
            try { target.removeTag("knockD"); } catch(e) {}
            trackedEntities.delete(id);
            continue;
        }


        const totalMag = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        if (totalMag > 0.4) {
            if (vel.y < -0.2) {
                try {
                    target.removeTag("knock");
                    target.addTag("knockD");
                } catch(e) {}
            } else {
                try {
                    target.removeTag("knockD");
                    target.addTag("knock");
                } catch(e) {}
            }
        } else if (data.ticksAirborne > 2) {

            try { target.removeTag("knock"); } catch(e) {}
            try { target.removeTag("knockD"); } catch(e) {}
            trackedEntities.delete(id);
            continue;
        }

        data.lastVelocity = vel;
        data.ticksAirborne++;
    }
}, 1);
