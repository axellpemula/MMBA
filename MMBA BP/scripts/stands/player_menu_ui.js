import { world, system } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import {
    statConf,
    getScore,
    getStatPoints,
    getAttackerStatMultiplier,
    getDefStatReduction,
    getPenetrationFactor,
    getCritMultiplier
} from "../damage/rpgStats.js";
import { openStandColorway, isColorwayMenuOpen } from "./colorway_ui.js";

const MenuItemId = "jjba:player_menu";
const StatsFormTag = "§p§m§1";
const StandFormTag = "§p§m§2";
const CodexFormTag = "§p§m§3";
const MeritObjective = "merit";
const VitObjective = "vit";
const MaxVitGroup = 200;

const openMenus = new Set();

const StatList = [
    { key: "vit", objective: VitObjective },
    { key: "atk", objective: statConf.atk.objective },
    { key: "def", objective: statConf.def.objective },
    { key: "pen", objective: statConf.pen.objective },
    { key: "dex", objective: statConf.dex.objective }
];

const SelectableStands = [
    { id: 1, key: "tusk" },
    { id: 2, key: "twau" },
    { id: 4, key: "mandom" },
    { id: 5, key: "boku" },
    { id: 6, key: "tim" }
];

const TransientStandTags = [
    "onSkill", "blocking", "parry", "charging", "chargingS",
    "chargeT", "chargeTS", "chargeTB", "chargeTSB",
    "chargeM", "chargeMS", "chargeMB", "chargeMSB",
    "low", "high", "lowCD", "uncancelable",
    "tim_grapple", "tim_unravel",
    "tusk_detached", "tusk_spatial", "tusk_rotation", "tusk_wormhole_barrage", "tusk_shot_queued",
    "twau_tandem", "century_active"
];

function getOrCreateObjective(name) {
    let obj = world.scoreboard.getObjective(name);
    if (!obj) {
        try {
            obj = world.scoreboard.addObjective(name, name);
        } catch {
            obj = world.scoreboard.getObjective(name);
        }
    }
    return obj;
}

function setScore(player, objectiveName, value) {
    if (!player?.isValid) return;
    try {
        const obj = getOrCreateObjective(objectiveName);
        if (obj) {
            obj.setScore(player, Math.max(0, Math.round(value)));
        }
    } catch { }
}

function setStandPreview(player, enabled) {
    try {
        if (player?.isValid) {
            player.setProperty("property:stand_preview", enabled ? 1 : 0);
        }
    } catch { }
}

function getMeritPoints(player) {
    return Math.max(0, Math.floor(getScore(player, MeritObjective)));
}

export function syncPlayerVitHealth(player, forceRestore = false) {
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    try {
        const hp = player.getComponent("minecraft:health");
        if (!hp) return;

        const vit = Math.max(0, Math.floor(getStatPoints(player, VitObjective)));
        const clampedVit = Math.min(MaxVitGroup, vit);
        const targetMax = 20 + clampedVit * 5;
        const prevMax = Math.round(hp.effectiveMax ?? 20);
        const prevHp = hp.currentValue ?? 20;

        if (!forceRestore && prevMax === targetMax) return;

        player.triggerEvent("xvoid:vit_clear");
        player.triggerEvent(`xvoid:vit.${clampedVit}`);

        system.run(() => {
            if (!player?.isValid) return;
            try {
                const newHpComp = player.getComponent("minecraft:health");
                if (!newHpComp) return;
                const newMax = newHpComp.effectiveMax ?? targetMax;
                let restored = prevHp;
                if (newMax > prevMax) {
                    restored = Math.min(newMax, prevHp + (newMax - prevMax));
                } else {
                    restored = Math.min(newMax, prevHp);
                }
                if (restored > 0) {
                    newHpComp.setCurrentValue(restored);
                }
            } catch { }
        });
    } catch { }
}

function formatStatBonus(player, key, val) {
    switch (key) {
        case "vit":
            return String(20 + val * 5);
        case "atk":
            return `x${getAttackerStatMultiplier(player).toFixed(2)}`;
        case "def":
            return `-${(getDefStatReduction(player) * 100).toFixed(1)}%`;
        case "pen":
            return `${(getPenetrationFactor(player) * 100).toFixed(1)}%`;
        case "dex": {
            const chance = val <= 0
                ? 0
                : Math.min(100, Math.round((statConf.dex.critChanceBase + val * statConf.dex.critChancePerPoint) * 100));
            const mult = getCritMultiplier(player).toFixed(2);
            return `${chance}% / x${mult}`;
        }
        default:
            return "0";
    }
}

function addTabButtons(form, activeTab) {
    form.button({
        rawtext: [
            { text: activeTab === "stats" ? "§t§1§r" : "§t§0§r" },
            { translate: "mmba.menu.tab.stats" }
        ]
    });
    form.button({
        rawtext: [
            { text: activeTab === "stand" ? "§t§1§r" : "§t§0§r" },
            { translate: "mmba.menu.tab.stand" }
        ]
    });
    form.button({
        rawtext: [
            { text: activeTab === "codex" ? "§t§1§r" : "§t§0§r" },
            { translate: "mmba.menu.tab.codex" }
        ]
    });
}

function buildCodexBody() {
    return {
        rawtext: [
            { translate: "mmba.codex.controls_title" },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.m1", with: ["\uE015"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.low", with: ["\uE085", "\uE015"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.high", with: ["\uE084", "\uE018"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.heavy", with: ["\uE018"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.barrage", with: ["\uE018"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.block", with: ["\uE085", "\uE018"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.special", with: ["\uE018"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.dash", with: ["\uE084"] },
            { text: "\n" },
            { translate: "mmba.codex.ctrl.evasive", with: ["\uE085"] },
            { text: "\n\n" },
            { translate: "mmba.codex.stats_title" },
            { text: "\n" },
            { translate: "mmba.codex.stats_1" },
            { text: "\n" },
            { translate: "mmba.codex.stats_2" },
            { text: "\n" },
            { translate: "mmba.codex.stats_3" }
        ]
    };
}

function getStandTranslateKey(standId) {
    const found = SelectableStands.find(s => s.id === standId);
    if (found) return `mmba.stand.name.${found.key}`;
    return "mmba.stand.name.none";
}

function equipStand(player, standId) {
    if (!player?.isValid) return;

    for (const tag of TransientStandTags) {
        try { player.removeTag(tag); } catch { }
    }
    try { player.runCommand("function util/returnMovement"); } catch { }
    try { player.runCommand("scriptevent xvoid:damage stop"); } catch { }

    setScore(player, "standC", standId);
    setScore(player, "act", 0);
    setScore(player, "sp1", 0);
    setScore(player, "m1", 0);
    setScore(player, "cd", 0);
    setScore(player, "movesScript", 0);

    try {
        player.setProperty("property:stand", standId);
        player.setProperty("property:act", 0);
        player.setProperty("property:m1", 0);
        player.setProperty("property:blocking", 0);
        player.setProperty("property:attack", 0);
        player.setProperty("property:tim_limb", 0);
        player.setProperty("property:tim_detach", 0);
    } catch { }

    try {
        player.playSound("xvoid.steelball_turn2", { volume: 0.75, pitch: 1.1 });
    } catch { }
}

function playUiSound(player, soundId, pitch = 1.0, volume = 0.7) {
    try {
        player.playSound(soundId, { volume, pitch });
    } catch { }
}

function showActionBar(player, rawMessage) {
    try {
        player.onScreenDisplay?.setActionBar(rawMessage);
    } catch { }
}

function closeMenuCleanly(player) {
    if (!player) return;
    openMenus.delete(player.id);
    setStandPreview(player, false);
}

function showStatsForm(player, busyRetries = 0) {
    if (!player?.isValid) {
        openMenus.delete(player?.id);
        return;
    }

    setStandPreview(player, false);

    const merit = getMeritPoints(player);
    const level = Math.max(0, Math.floor(player.level ?? 0));
    let totalInvested = 0;

    const form = new ActionFormData()
        .title(`${StatsFormTag}${player.name}`)
        .body({
            rawtext: [
                { translate: "mmba.menu.points", with: [String(merit), String(level)] }
            ]
        });

    addTabButtons(form, "stats");

    for (const stat of StatList) {
        const val = getStatPoints(player, stat.objective);
        totalInvested += val;
        const canUpgrade = merit >= 1;
        const bonusStr = formatStatBonus(player, stat.key, val);

        form.button({
            rawtext: [
                { text: canUpgrade ? "§s§a§r" : "§s§l§r" },
                { translate: `mmba.menu.stat.${stat.key}`, with: [String(val), bonusStr] }
            ]
        });
    }

    const canConvert = level >= 1;
    form.button({
        rawtext: [
            { text: canConvert ? "§a§1§r" : "§a§0§r" },
            { translate: "mmba.menu.btn.convert" }
        ]
    });

    const canReset = totalInvested > 0;
    form.button({
        rawtext: [
            { text: canReset ? "§r§1§r" : "§r§0§r" },
            { translate: "mmba.menu.btn.reset" }
        ]
    });

    form.show(player).then((response) => {
        if (!player?.isValid) {
            openMenus.delete(player?.id);
            return;
        }

        if (response.canceled) {
            if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries < 8) {
                system.runTimeout(() => {
                    showStatsForm(player, busyRetries + 1);
                }, 2);
                return;
            }
            closeMenuCleanly(player);
            return;
        }

        const sel = response.selection;

        if (sel === 0) {
            showStatsForm(player, 0);
            return;
        }
        if (sel === 1) {
            playUiSound(player, "random.click", 1.1, 0.7);
            showStandForm(player, 0);
            return;
        }
        if (sel === 2) {
            playUiSound(player, "random.click", 1.1, 0.7);
            showCodexForm(player, 0);
            return;
        }


        if (sel >= 3 && sel <= 7) {
            const stat = StatList[sel - 3];
            const currentVal = getStatPoints(player, stat.objective);
            const currentMerit = getMeritPoints(player);

            if (currentMerit < 1) {
                playUiSound(player, "note.bass", 0.7, 0.7);
                showActionBar(player, { translate: "mmba.menu.msg.no_points" });
            } else {
                setScore(player, MeritObjective, currentMerit - 1);
                setScore(player, stat.objective, currentVal + 1);
                if (stat.key === "vit") {
                    syncPlayerVitHealth(player);
                }
                playUiSound(player, "random.orb", 1.25, 0.65);
            }

            system.runTimeout(() => {
                if (player?.isValid && openMenus.has(player.id)) {
                    showStatsForm(player, 0);
                }
            }, 1);
            return;
        }


        if (sel === 8) {
            const currentLevel = Math.max(0, Math.floor(player.level ?? 0));
            if (currentLevel < 1) {
                playUiSound(player, "note.bass", 0.7, 0.7);
                showActionBar(player, { translate: "mmba.menu.msg.no_levels" });
            } else {
                try {
                    player.addLevels(-1);
                    setScore(player, MeritObjective, getMeritPoints(player) + 2);
                    playUiSound(player, "random.levelup", 1.2, 0.6);
                    showActionBar(player, { translate: "mmba.menu.msg.converted" });
                } catch {
                    playUiSound(player, "note.bass", 0.7, 0.7);
                }
            }

            system.runTimeout(() => {
                if (player?.isValid && openMenus.has(player.id)) {
                    showStatsForm(player, 0);
                }
            }, 1);
            return;
        }


        if (sel === 9) {
            let refund = 0;
            for (const stat of StatList) {
                refund += getStatPoints(player, stat.objective);
            }
            if (refund <= 0) {
                playUiSound(player, "note.bass", 0.7, 0.7);
                showActionBar(player, { translate: "mmba.menu.msg.nothing_reset" });
            } else {
                for (const stat of StatList) {
                    setScore(player, stat.objective, 0);
                }
                setScore(player, MeritObjective, getMeritPoints(player) + refund);
                syncPlayerVitHealth(player);
                playUiSound(player, "random.orb", 0.85, 0.8);
                showActionBar(player, { translate: "mmba.menu.msg.reset_done", with: [String(refund)] });
            }

            system.runTimeout(() => {
                if (player?.isValid && openMenus.has(player.id)) {
                    showStatsForm(player, 0);
                }
            }, 1);
            return;
        }

        closeMenuCleanly(player);
    }).catch(() => {
        closeMenuCleanly(player);
    });
}

function showStandForm(player, busyRetries = 0) {
    if (!player?.isValid) {
        openMenus.delete(player?.id);
        return;
    }

    setStandPreview(player, true);

    const currentStand = Math.max(0, Math.floor(getScore(player, "standC")));
    const activeKey = getStandTranslateKey(currentStand);

    const form = new ActionFormData()
        .title({ rawtext: [{ text: StandFormTag }, { translate: "mmba.menu.title" }] })
        .body({ translate: activeKey });

    addTabButtons(form, "stand");


    form.button({
        rawtext: [
            { text: "§c§0§r" },
            { translate: "mmba.stand.btn.colorway" }
        ]
    });


    for (const stand of SelectableStands) {
        const isActive = currentStand === stand.id;
        form.button({
            rawtext: [
                { text: isActive ? "§s§1§r" : "§s§0§r" },
                { translate: `mmba.stand.name.${stand.key}` }
            ]
        });
    }

    form.show(player).then((response) => {
        if (!player?.isValid) {
            openMenus.delete(player?.id);
            return;
        }

        if (response.canceled) {
            if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries < 8) {
                system.runTimeout(() => {
                    showStandForm(player, busyRetries + 1);
                }, 2);
                return;
            }
            closeMenuCleanly(player);
            return;
        }

        const sel = response.selection;
        if (sel === 0) {
            setStandPreview(player, false);
            playUiSound(player, "random.click", 1.1, 0.7);
            showStatsForm(player, 0);
            return;
        }
        if (sel === 1) {
            showStandForm(player, 0);
            return;
        }
        if (sel === 2) {
            setStandPreview(player, false);
            playUiSound(player, "random.click", 1.1, 0.7);
            showCodexForm(player, 0);
            return;
        }
        if (sel === 3) {
            openMenus.delete(player.id);
            playUiSound(player, "random.click", 1.1, 0.7);
            openStandColorway(player, (p) => openPlayerMenu(p, "stand"));
            return;
        }

        if (sel >= 4 && sel < 4 + SelectableStands.length) {
            const picked = SelectableStands[sel - 4];
            equipStand(player, picked.id);
            showActionBar(player, {
                translate: "mmba.stand.msg.equipped",
                with: [{ translate: `mmba.stand.name.${picked.key}` }]
            });
            system.runTimeout(() => {
                if (player?.isValid && openMenus.has(player.id)) {
                    showStandForm(player, 0);
                }
            }, 1);
            return;
        }

        closeMenuCleanly(player);
    }).catch(() => {
        closeMenuCleanly(player);
    });
}

function showCodexForm(player, busyRetries = 0) {
    if (!player?.isValid) {
        openMenus.delete(player?.id);
        return;
    }

    setStandPreview(player, false);

    const form = new ActionFormData()
        .title({ rawtext: [{ text: CodexFormTag }, { translate: "mmba.menu.title" }] })
        .body(buildCodexBody());

    addTabButtons(form, "codex");

    form.show(player).then((response) => {
        if (!player?.isValid) {
            openMenus.delete(player?.id);
            return;
        }

        if (response.canceled) {
            if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries < 8) {
                system.runTimeout(() => {
                    showCodexForm(player, busyRetries + 1);
                }, 2);
                return;
            }
            closeMenuCleanly(player);
            return;
        }

        const sel = response.selection;
        if (sel === 0) {
            playUiSound(player, "random.click", 1.1, 0.7);
            showStatsForm(player, 0);
            return;
        }
        if (sel === 1) {
            playUiSound(player, "random.click", 1.1, 0.7);
            showStandForm(player, 0);
            return;
        }
        if (sel === 2) {
            showCodexForm(player, 0);
            return;
        }

        closeMenuCleanly(player);
    }).catch(() => {
        closeMenuCleanly(player);
    });
}

export function openPlayerMenu(player, tab = "stats") {
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    if (openMenus.has(player.id) || isColorwayMenuOpen(player.id)) return;

    openMenus.add(player.id);
    playUiSound(player, "random.click", 1.1, 0.65);

    if (tab === "stand") {
        showStandForm(player, 0);
    } else if (tab === "codex") {
        showCodexForm(player, 0);
    } else {
        showStatsForm(player, 0);
    }
}

world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    if (ev.itemStack?.typeId !== MenuItemId) return;
    openPlayerMenu(player, "stats");
});

world.afterEvents.playerSpawn.subscribe(({ player }) => {
    system.runTimeout(() => {
        if (player?.isValid) {
            syncPlayerVitHealth(player, true);
        }
    }, 2);
});

system.runInterval(() => {
    for (const player of world.getAllPlayers()) {
        syncPlayerVitHealth(player, false);
    }
}, 20);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    openMenus.delete(playerId);
});
