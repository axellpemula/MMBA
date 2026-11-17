import { world } from "@minecraft/server";

const maxInvestent = 3;

export const statConf = {
    maxPointsPerStat: 100,

    atk: {
        objective: "atk",
        percentPerPoint: (maxInvestent - 1) / 100
    },
    def: {
        objective: "def",
        softCap: 100 * (1 / maxInvestent) / (1 - 1 / maxInvestent)
    },
    pen: {
        objective: "pen",
        get softCap() { return statConf.def.softCap; }
    },
    dex: {
        objective: "dex",
        critChanceBase: 0.1,
        critChancePerPoint: 0.015,
        critChanceSaturationPoints: 70,
        baseCritMultiplier: 1.5,
        critDamagePerPointPhase1: 0.015,
        critDamagePerPointPhase2: 0.03
    },
    luck: {
        objective: "luck",
        dodgeCap: 0.2,
        dodgePerPoint: 0.5 / 100,
        critResistPerPoint: 0.01,
        minEnemyCritChance: 0.05
    }
};

export function getScore(entity, objectiveName) {
    const obj = world.scoreboard.getObjective(objectiveName);
    if (obj && obj.hasParticipant(entity)) {
        return obj.getScore(entity);
    }
    return 0;
}


export function getStatPoints(entity, objectiveName) {
    const raw = getScore(entity, objectiveName);
    return Math.max(0, raw);
}


export function getAttackerStatMultiplier(caster) {
    const atk = getStatPoints(caster, statConf.atk.objective);
    return 1 + atk * statConf.atk.percentPerPoint;
}


export function getDefStatReduction(target) {
    const def = getStatPoints(target, statConf.def.objective);
    if (def <= 0) return 0;
    return def / (def + statConf.def.softCap);
}


export function getPenetrationFactor(caster) {
    const pen = getStatPoints(caster, statConf.pen.objective);
    if (pen <= 0) return 0;
    return pen / (pen + statConf.pen.softCap);
}


export function getEffectiveDefReduction(caster, target) {
    const defReduction = getDefStatReduction(target);
    const penFactor = getPenetrationFactor(caster);
    return defReduction * (1 - penFactor);
}


export function rollDodge(target) {
    const luck = getStatPoints(target, statConf.luck.objective);
    if (luck <= 0) return false;
    const dodgeChance = Math.min(statConf.luck.dodgeCap, luck * statConf.luck.dodgePerPoint);
    return Math.random() < dodgeChance;
}

export function rollCrit(caster, target) {
    const dex = getStatPoints(caster, statConf.dex.objective);
    if (dex <= 0) return false;

    const luck = getStatPoints(target, statConf.luck.objective);
    let chance = Math.min(1, statConf.dex.critChanceBase + (dex * statConf.dex.critChancePerPoint));
    chance -= luck * statConf.luck.critResistPerPoint;
    chance = Math.max(statConf.luck.minEnemyCritChance, chance);

    return Math.random() < chance;
}


export function getCritMultiplier(caster) {
    const dex = getStatPoints(caster, statConf.dex.objective);
    const sat = statConf.dex.critChanceSaturationPoints;
    const phase1Points = Math.min(dex, sat);
    const phase2Points = Math.max(0, dex - sat);

    return statConf.dex.baseCritMultiplier
        + phase1Points * statConf.dex.critDamagePerPointPhase1
        + phase2Points * statConf.dex.critDamagePerPointPhase2;
}
