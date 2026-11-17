import { world, system, EquipmentSlot } from "@minecraft/server";

const ProgressionItems = {
    "jjba:spin_basic": {
        tag: "spin",
        alreadyMessage: "§cYou already know the Spin!",
        successMessage: "§aYou learned the Spin!"
    },
    "jjba:spin_lesson_1": {
        tag: "lesson1",
        alreadyMessage: "§cYou already completed Spin Lesson 1!",
        successMessage: "§eYou completed Spin Lesson 1!"
    },
    "jjba:spin_lesson_2": {
        tag: "lesson2",
        alreadyMessage: "§cYou already completed Spin Lesson 2!",
        successMessage: "§eYou completed Spin Lesson 2!"
    },
    "jjba:spin_lesson_3": {
        tag: "lesson3",
        alreadyMessage: "§cYou already completed Spin Lesson 3!",
        successMessage: "§eYou completed Spin Lesson 3!"
    },
    "jjba:spin_lesson_4": {
        tag: "lesson4",
        alreadyMessage: "§cYou already completed Spin Lesson 4!",
        successMessage: "§6You completed Spin Lesson 4!"
    },
    "jjba:axl_ro": {
        tag: "axl_ro",
        alreadyMessage: "§cYou already have Axl RO's power!",
        successMessage: "§5You obtained Axl RO's power!"
    }
};

function consumeItem(player, typeId) {
    if (!player?.isValid) return;


    const slot = player.selectedSlotIndex;
    const inventory = player.getComponent("inventory");
    const container = inventory?.container;

    if (container && slot !== undefined) {
        const item = container.getItem(slot);
        if (item && item.typeId === typeId) {
            if (item.amount > 1) {
                item.amount -= 1;
                container.setItem(slot, item);
            } else {
                container.setItem(slot, undefined);
            }
            return;
        }
    }


    const equippable = player.getComponent("minecraft:equippable");
    if (equippable) {
        const main = equippable.getEquipment(EquipmentSlot.Mainhand);
        if (main && main.typeId === typeId) {
            if (main.amount > 1) {
                main.amount -= 1;
                equippable.setEquipment(EquipmentSlot.Mainhand, main);
            } else {
                equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
            }
            return;
        }

        const off = equippable.getEquipment(EquipmentSlot.Offhand);
        if (off && off.typeId === typeId) {
            if (off.amount > 1) {
                off.amount -= 1;
                equippable.setEquipment(EquipmentSlot.Offhand, off);
            } else {
                equippable.setEquipment(EquipmentSlot.Offhand, undefined);
            }
            return;
        }
    }


    if (container) {
        for (let i = 0; i < container.size; i++) {
            const item = container.getItem(i);
            if (item && item.typeId === typeId) {
                if (item.amount > 1) {
                    item.amount -= 1;
                    container.setItem(i, item);
                } else {
                    container.setItem(i, undefined);
                }
                return;
            }
        }
    }
}

world.afterEvents.itemUse.subscribe((event) => {
    const { source: player, itemStack } = event;
    if (!player?.isValid || !itemStack) return;

    const config = ProgressionItems[itemStack.typeId];
    if (!config) return;

    if (player.hasTag(config.tag)) {
        player.sendMessage(config.alreadyMessage);
        return;
    }

    player.addTag(config.tag);
    player.sendMessage(config.successMessage);
    player.playSound("random.levelup", { volume: 0.8, pitch: 1.1 });


    system.run(() => {
        consumeItem(player, itemStack.typeId);
    });
});
