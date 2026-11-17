import { world, system } from "@minecraft/server";
import { getSlotArmor } from './def.js';

const damageTracking = new Map();
const healthTracking = new Map();
const stoppedAttacks = new Set();
const DamageWindowTicks = 20;


const damageOverrides = new Map();

export function recordDamageOverride(entity, realAmount) {
    damageOverrides.set(entity.id, { tick: system.currentTick, amount: realAmount });
}

function recordTrackedDamage(entity, damage) {
    if (!entity || !entity.isValid || damage <= 0) return;
    const entityId = entity.id;
    const currentTick = system.currentTick;

    let tracking = damageTracking.get(entityId);
    if (!tracking) {
        tracking = {
            lastDamageTime: currentTick,
            totalDamage: damage,
            resetTimeout: null,
            indicator: null
        };
        damageTracking.set(entityId, tracking);
    } else {
        if (currentTick - tracking.lastDamageTime > DamageWindowTicks) {
            tracking.totalDamage = damage;
        } else {
            tracking.totalDamage += damage;
        }
        tracking.lastDamageTime = currentTick;
    }

    spawnIndicator(entity, tracking.totalDamage, false);
}


export function recordDirectDamage(entity, amount) {
    recordTrackedDamage(entity, amount);
}

function spawnIndicator(entity, amount, isHeal = false) {
    try {
        if (!entity || !entity.isValid || amount <= 0) return;

        const position = {
            x: entity.location.x,
            y: entity.location.y + 2,
            z: entity.location.z
        };

        const tracking = damageTracking.get(entity.id) || {};

        if (tracking.indicator) {
            try {
                tracking.indicator.kill();
            } catch (e) {}
            tracking.indicator = null;
        }

        const indicator = entity.dimension.spawnEntity("xvoid:dmg", position);
        if (indicator) {
            const displayAmount = amount % 1 === 0 ? Math.floor(amount) : Number(amount.toFixed(2)).toString();
            indicator.nameTag = isHeal ? `§a+${displayAmount}` : `${displayAmount}`;
            tracking.indicator = indicator;
            damageTracking.set(entity.id, tracking);
        }
    } catch (e) {
    }
}

function updateEntityHealthStates() {
    try {
        const seenEntities = new Map();
        for (const player of world.getAllPlayers()) {
            const dimension = player.dimension;
            const entities = dimension.getEntities({
                excludeTypes: [
                "xp_orb", "xvoid:dmg", "item", "armor_stand", "thrown_trident", "arrow",
                "area_effect_cloud", "minecart", "chest_minecart", "command_block_minecart",
                "dragon_fireball", "egg", "snowball", "ender_crystal", "ender_pearl",
                "evocation_fang", "falling_block", "fireball", "fireworks_rocket",
                "fishing_hook", "leash_knot", "lightning_bolt", "lingering_potion",
                "llama_spit", "xvoid:tim_hitbox"
            ],
                excludeFamilies: ["damage", "atk", "inanimate"]
            });

            for (const entity of entities) {
                if (!entity || !entity.isValid || seenEntities.has(entity.id)) continue;
                seenEntities.set(entity.id, entity);
            }
        }

        for (const entity of seenEntities.values()) {
            const healthComp = entity.getComponent("minecraft:health");
            if (!healthComp) continue;

            const currentHealth = healthComp.currentValue;
            const previous = healthTracking.get(entity.id);

            if (!previous) {
                healthTracking.set(entity.id, { lastHealth: currentHealth });
                continue;
            }

            if (currentHealth > previous.lastHealth) {
                const healAmount = currentHealth - previous.lastHealth;
                if (!entity.hasTag("blocking") && !entity.hasTag("tusk_bleeding")) {
                    spawnIndicator(entity, healAmount, true);
                }
            }

            previous.lastHealth = currentHealth;
            healthTracking.set(entity.id, previous);
        }
    } catch (e) {
    }
}

world.afterEvents.entityHurt.subscribe((event) => {
    try {
        const entity = event.hurtEntity;
        const currentTick = system.currentTick;

        if (!entity || !entity.isValid || entity.typeId === "xvoid:tim_hitbox") return;

        const entityId = entity.id;


        const override = damageOverrides.get(entityId);
        let damage = event.damage;
        if (override && override.tick === currentTick) {
            damage = override.amount;
            damageOverrides.delete(entityId);
        }

        recordTrackedDamage(entity, damage);

    } catch (e) {
        console.warn("Error in entityHurt event:", e);
    }
});

system.runInterval(() => {
    updateEntityHealthStates();
}, 2);

system.runInterval(() => {
    const currentTick = system.currentTick;

    for (const [entityId, tracking] of damageTracking.entries()) {
        if (currentTick - tracking.lastDamageTime > 200) {
            if (tracking.indicator) {
                try {
                    tracking.indicator.kill();
                } catch (e) {}
            }
            damageTracking.delete(entityId);
        }
    }
}, 100);
