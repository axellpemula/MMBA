import { world, system, MolangVariableMap } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { getNails, MaxNails } from "./tusk.js";

const WheelTitle = "§t§wTusk Act Wheel";
const openWheels = new Set();

function getScore(player, objectiveName) {
    try {
        return world.scoreboard.getObjective(objectiveName)?.getScore(player) ?? 0;
    } catch {
        return 0;
    }
}

function setScore(player, objectiveName, value) {
    try {
        const obj = world.scoreboard.getObjective(objectiveName);
        if (obj) obj.setScore(player, Math.round(value));
    } catch { }
}

export function isActUnlocked(player, actIndex) {
    if (!player?.isValid) return false;
    const hasAct2 = player.hasTag("spin") && player.hasTag("lesson4");
    const hasAct3 = hasAct2 && player.hasTag("axl_ro");
    const hasAct4 = hasAct3 && player.hasTag("lesson5");

    switch (actIndex) {
        case 0: return true;
        case 1: return hasAct2;
        case 2: return hasAct3;
        case 3: return hasAct4;
        default: return false;
    }
}

function getActUnlockRequirement(actIndex) {
    switch (actIndex) {
        case 1: return "Spin Lesson 4";
        case 2: return "Defeat Axl RO";
        case 3: return "Spin Lesson 5";
        default: return "";
    }
}

function getActColorCode(actIndex) {
    switch (actIndex) {
        case 0: return "§b";
        case 1: return "§e";
        case 2: return "§9";
        case 3: return "§d";
        default: return "§f";
    }
}

function getActRoman(actIndex) {
    return ["ACT I", "ACT II", "ACT III", "ACT IV"][actIndex] ?? "ACT I";
}

const ActSwitchVoice = [
    "johnny.original_02",
    "johnny.original_04",
    "johnny.original_06",
    "johnny.original_08",
];

function getSwitchParticle(actIndex) {
    switch (actIndex) {
        case 0: return "tusk1:naila";
        case 1: return "tusk2:naila";
        case 2: return "tusk3:naila";
        case 3: return "tusk4:drill_finisher";
        default: return "tusk1:naila";
    }
}

function formatSlotLabel(actIndex, currentAct, unlocked) {
    const color = getActColorCode(actIndex);
    const title = getActRoman(actIndex);
    if (!unlocked) {
        return `§l§r§7${title}\n§cLocked`;
    }
    if (actIndex === currentAct) {
        return `§s§r§a§l► ${title} ◄`;
    }
    return `§u§r${color}§l${title}`;
}

const DpadActByButton = {
    1: 0,
    3: 1,
    5: 2,
    7: 3,
};

function showWheelForm(player, busyRetries = 0) {
    if (!player?.isValid) {
        openWheels.delete(player?.id);
        return;
    }

    const currentAct = Math.max(0, Math.min(3, getScore(player, "act")));
    const nails = getNails(player);

    const slots = [
        {
            index: 0,
            unlocked: isActUnlocked(player, 0),
            iconOn: "textures/ui/tusk/model_act1",
            iconLock: "textures/ui/tusk/model_act1",
        },
        {
            index: 1,
            unlocked: isActUnlocked(player, 1),
            iconOn: "textures/ui/tusk/model_act2",
            iconLock: "textures/ui/tusk/model_act2_lock",
        },
        {
            index: 2,
            unlocked: isActUnlocked(player, 2),
            iconOn: "textures/ui/tusk/model_act3",
            iconLock: "textures/ui/tusk/model_act3_lock",
        },
        {
            index: 3,
            unlocked: isActUnlocked(player, 3),
            iconOn: "textures/ui/tusk/model_act4",
            iconLock: "textures/ui/tusk/model_act4_lock",
        },
    ];

    const hubColor = getActColorCode(currentAct);
    const hubAct = getActRoman(currentAct);
    const bodyText = `§d§lTUSK\n${hubColor}${hubAct}\n§f${nails}/${MaxNails}`;

    const form = new ActionFormData()
        .title(WheelTitle)
        .body(bodyText);

    const addActButton = (actIndex) => {
        const s = slots[actIndex];
        const label = formatSlotLabel(s.index, currentAct, s.unlocked);
        const icon = s.unlocked ? s.iconOn : s.iconLock;
        form.button(label, icon);
    };


    form.button("§0§r");
    addActButton(0);
    form.button("§0§r");
    addActButton(1);
    form.button(`§x§r§c§lEXIT\n${hubColor}${hubAct} §f${nails}/${MaxNails}`, "textures/ui/stand_ui/close_icon");
    addActButton(2);
    form.button("§0§r");
    addActButton(3);
    form.button("§0§r");

    form.show(player).then((response) => {
        if (!player?.isValid) {
            openWheels.delete(player?.id);
            return;
        }

        if (response.canceled) {
            if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries < 12) {
                system.runTimeout(() => {
                    showWheelForm(player, busyRetries + 1);
                }, 2);
                return;
            }
            openWheels.delete(player.id);
            return;
        }

        const sel = DpadActByButton[response.selection];
        if (typeof sel !== "number") {
            openWheels.delete(player.id);
            return;
        }

        const picked = slots[sel];
        if (!picked.unlocked) {
            const req = getActUnlockRequirement(sel);
            try {
                player.playSound("xvoid.oramuda_button2", { volume: 0.7, pitch: 0.55 });
                player.onScreenDisplay.setActionBar(`§c${getActRoman(sel)} Locked — Requires: §f${req}`);
            } catch { }
            system.runTimeout(() => {
                showWheelForm(player, 0);
            }, 2);
            return;
        }

        openWheels.delete(player.id);

        if (getScore(player, "standC") !== 1) return;
        if (player.hasTag("onSkill") || player.hasTag("tusk_rotation") || player.hasTag("tusk_detached") || player.hasTag("tusk_spatial") || player.hasTag("tusk_wormhole_barrage")) {
            return;
        }

        player.removeTag("tusk_shot_queued");
        setScore(player, "act", sel);
        setScore(player, "sp1", 0);
        setScore(player, "m1", 0);
        try {
            player.setProperty("property:act", sel);
        } catch { }

        const loc = { x: player.location.x, y: player.location.y + 1.1, z: player.location.z };
        try {
            player.dimension.playSound("xvoid.steelball_turn2", player.location, {
                volume: 0.85,
                pitch: 1.05 + sel * 0.08
            });
            const switchVoice = ActSwitchVoice[sel];
            if (switchVoice) {
                player.dimension.playSound(switchVoice, player.location, { volume: 0.85, pitch: 1.0 });
            }
            player.dimension.spawnParticle(getSwitchParticle(sel), loc, new MolangVariableMap());
        } catch { }
    }).catch(() => {
        openWheels.delete(player?.id);
    });
}

export function openTuskActWheel(player) {
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    if (openWheels.has(player.id)) return;
    if (getScore(player, "standC") !== 1) return;
    if (
        player.hasTag("onSkill") ||
        player.hasTag("tusk_rotation") ||
        player.hasTag("tusk_wormhole_barrage") ||
        player.hasTag("tusk_detached") ||
        player.hasTag("tusk_spatial") ||
        player.hasTag("clashing") ||
        player.hasTag("tsed")
    ) {
        return;
    }


    player.removeTag("chargeMSB");
    player.removeTag("chargeTSB");
    player.removeTag("chargingS");

    openWheels.add(player.id);
    try {
        player.playSound("xvoid.steelball_turn", { volume: 0.7, pitch: 1.25 });
    } catch { }

    showWheelForm(player, 0);
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    openWheels.delete(playerId);
});
