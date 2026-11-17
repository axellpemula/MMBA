export const familyDefenseValues = {
    "other":0
};


export const armorDefenseValues = {
    "minecraft:diamond_helmet": { slot: "Head", defense: 3, toughness: 2 },
    "minecraft:diamond_chestplate": { slot: "Chest", defense: 8, toughness: 2 },
    "minecraft:diamond_leggings": { slot: "Legs", defense: 6, toughness: 2 },
    "minecraft:diamond_boots": { slot: "Feet", defense: 3, toughness: 2 },
    "minecraft:netherite_helmet": { slot: "Head", defense: 3, toughness: 3 },
    "minecraft:netherite_chestplate": { slot: "Chest", defense: 8, toughness: 3 },
    "minecraft:netherite_leggings": { slot: "Legs", defense: 6, toughness: 3 },
    "minecraft:netherite_boots": { slot: "Feet", defense: 3, toughness: 3 },
    "minecraft:iron_helmet": { slot: "Head", defense: 2, toughness: 0 },
    "minecraft:iron_chestplate": { slot: "Chest", defense: 6, toughness: 0 },
    "minecraft:iron_leggings": { slot: "Legs", defense: 5, toughness: 0 },
    "minecraft:iron_boots": { slot: "Feet", defense: 2, toughness: 0 },
    "minecraft:golden_helmet": { slot: "Head", defense: 1, toughness: 0 },
    "minecraft:golden_chestplate": { slot: "Chest", defense: 5, toughness: 0 },
    "minecraft:golden_leggings": { slot: "Legs", defense: 3, toughness: 0 },
    "minecraft:golden_boots": { slot: "Feet", defense: 1, toughness: 0 },
    "minecraft:chainmail_helmet": { slot: "Head", defense: 2, toughness: 0 },
    "minecraft:chainmail_chestplate": { slot: "Chest", defense: 5, toughness: 0 },
    "minecraft:chainmail_leggings": { slot: "Legs", defense: 4, toughness: 0 },
    "minecraft:chainmail_boots": { slot: "Feet", defense: 2, toughness: 0 },
    "minecraft:leather_helmet": { slot: "Head", defense: 1, toughness: 0 },
    "minecraft:leather_chestplate": { slot: "Chest", defense: 3, toughness: 0 },
    "minecraft:leather_leggings": { slot: "Legs", defense: 2, toughness: 0 },
    "minecraft:leather_boots": { slot: "Feet", defense: 1, toughness: 0 },

};


export function getSlotArmor(entity, slot) {
    try {
        const equippable = entity.getComponent("minecraft:equippable");
        if (equippable) {
            const equipment = equippable.getEquipmentSlot(slot);
            if (equipment.hasItem() && armorDefenseValues[equipment.typeId]) {
                return armorDefenseValues[equipment.typeId];
            }
        }
    } catch (e) {}
    return { defense: 0, toughness: 0 };
}

export function calculateArmorReduction(entity, incomingDamage) {
    try {
        const head = getSlotArmor(entity, "Head");
        const chest = getSlotArmor(entity, "Chest");
        const legs = getSlotArmor(entity, "Legs");
        const feet = getSlotArmor(entity, "Feet");

        const totalDefense = head.defense + chest.defense + legs.defense + feet.defense;
        const totalToughness = head.toughness + chest.toughness + legs.toughness + feet.toughness;

        if (totalDefense <= 0) return 0;
        const reduction = Math.min(20, Math.max(totalDefense / 5, totalDefense - incomingDamage / (2 + totalToughness / 4))) / 25;
        return Math.max(0, Math.min(0.8, reduction));
    } catch {
        return 0;
    }
}
