import { world, system, MolangVariableMap } from "@minecraft/server";
import { isTimeStopped } from "../../utils/tsState.js";
import { recordDirectDamage, recordDamageOverride } from "../../damage/indicator.js";

const activeBleeds = new Map();
const BleedStepInterval = 2;

const BaseStepPct = 1 - Math.pow(0.85, BleedStepInterval / 100);

const AntiHealMaxTickGain = 2.5;


export function applyBleed(target, durationTicks = 100, _legacyDps = 1.6, attacker = null) {
    if (!target?.isValid) return;
    if (target.hasTag("century_active") || target.hasTag("tusk_rotation")) return;

    const hp = target.getComponent("minecraft:health");
    if (!hp || hp.currentValue <= 0) return;

    const stepPct = BaseStepPct;
    const existing = activeBleeds.get(target.id);
    if (existing) {
        existing.remainingTicks = Math.max(existing.remainingTicks, durationTicks);
        existing.stepPct = Math.max(existing.stepPct, stepPct);
        existing.lastHp = Math.min(existing.lastHp, hp.currentValue);
        existing.lastMaxHp = hp.effectiveMax;
        if (attacker?.id) existing.attackerId = attacker.id;
    } else {
        activeBleeds.set(target.id, {
            entity: target,
            remainingTicks: durationTicks,
            stepPct,
            attackerId: attacker?.id ?? null,
            fxCooldown: 0,
            lastHp: hp.currentValue,
            lastMaxHp: hp.effectiveMax
        });
        target.addTag("tusk_bleeding");
    }
}

system.runInterval(() => {
    if (activeBleeds.size === 0) return;
    const stopped = isTimeStopped();

    for (const [id, st] of activeBleeds) {
        const entity = st.entity;
        if (!entity?.isValid) {
            activeBleeds.delete(id);
            continue;
        }

        if (entity.hasTag("century_active") || entity.hasTag("tusk_rotation")) {
            entity.removeTag("tusk_bleeding");
            activeBleeds.delete(id);
            continue;
        }

        const hp = entity.getComponent("minecraft:health");
        if (!hp || hp.currentValue <= 0) {
            entity.removeTag("tusk_bleeding");
            activeBleeds.delete(id);
            continue;
        }


        if (stopped && !entity.hasTag("ts") && entity.hasTag("tsed")) {
            continue;
        }


        let curHp = hp.currentValue;
        if (hp.effectiveMax === st.lastMaxHp && curHp > st.lastHp) {
            const gain = curHp - st.lastHp;
            if (gain <= AntiHealMaxTickGain) {
                curHp = st.lastHp;
                try { hp.setCurrentValue(curHp); } catch { }
            }
        }


        if (st.remainingTicks % BleedStepInterval === 0) {
            const stepDmg = curHp * st.stepPct;
            const nextHp = curHp - stepDmg;
            if (nextHp <= 0.05) {
                try {
                    recordDamageOverride(entity, Math.max(0.01, curHp));
                    const attacker = st.attackerId ? world.getEntity(st.attackerId) : undefined;
                    entity.applyDamage(999, attacker?.isValid ? { cause: "override", damagingEntity: attacker } : { cause: "override" });
                } catch {
                    try { entity.kill(); } catch { }
                }
                activeBleeds.delete(id);
                continue;
            }
            try {
                hp.setCurrentValue(nextHp);
                curHp = nextHp;
                recordDirectDamage(entity, stepDmg);
            } catch { }
        }

        st.lastHp = curHp;
        st.lastMaxHp = hp.effectiveMax;

        st.remainingTicks--;
        if (st.remainingTicks <= 0) {
            entity.removeTag("tusk_bleeding");
            activeBleeds.delete(id);
            continue;
        }

        st.fxCooldown--;
        if (st.fxCooldown <= 0) {
            st.fxCooldown = 6;
            try {
                entity.dimension.spawnParticle("tusk:bleed_drop", entity.location, new MolangVariableMap());
            } catch { }
        }
    }
}, 1);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "xvoid:tusk_bleed") return;
    const target = ev.sourceEntity;
    if (!target?.isValid) return;
    const parts = (ev.message || "").trim().split(/\s+/);
    const ticks = Math.max(10, parseInt(parts[0], 10) || 100);
    const dps = parseFloat(parts[1]) || 1.6;
    applyBleed(target, ticks, dps, ev.initiator ?? null);
});
