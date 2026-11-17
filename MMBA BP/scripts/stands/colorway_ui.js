import { world, system } from "@minecraft/server";
import { ModalFormData, FormCancelationReason } from "@minecraft/server-ui";

const FormTag = "§s§c";
const PreviewItemId = "minecraft:stick";

const PropHue = "property:stand_hue";
const PropSat = "property:stand_sat";
const PropBri = "property:stand_bri";
const PropPreview = "property:stand_preview";

const openMenus = new Set();

function clampInt(value, min, max, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.round(num)));
}

function getIntProp(player, prop, min, max, fallback = 0) {
    try {
        return clampInt(player.getProperty(prop), min, max, fallback);
    } catch {
        return fallback;
    }
}

function setPropSafe(player, prop, value) {
    try {
        if (player?.isValid) {
            player.setProperty(prop, value);
        }
    } catch {

    }
}

function closePreview(player, onExit = null) {
    if (!player) return;
    openMenus.delete(player.id);
    setPropSafe(player, PropPreview, 0);
    if (typeof onExit === "function") {
        system.runTimeout(() => {
            if (player?.isValid) {
                onExit(player);
            }
        }, 2);
    }
}

export function isColorwayMenuOpen(playerId) {
    return openMenus.has(playerId);
}

function showColorwayForm(player, busyRetries = 0, onExit = null) {
    if (!player?.isValid) return;

    const hue = getIntProp(player, PropHue, -180, 180, 0);
    const sat = getIntProp(player, PropSat, -100, 100, 0);
    const bri = getIntProp(player, PropBri, -100, 100, 0);

    const form = new ModalFormData()
        .title({ rawtext: [{ text: FormTag }, { translate: "mmba.colorway.title" }] })
        .slider({ translate: "mmba.colorway.hue" }, -180, 180, { valueStep: 1, defaultValue: hue })
        .slider({ translate: "mmba.colorway.sat" }, -100, 100, { valueStep: 1, defaultValue: sat })
        .slider({ translate: "mmba.colorway.bri" }, -100, 100, { valueStep: 1, defaultValue: bri })
        .toggle({ translate: "mmba.colorway.reset" }, { defaultValue: false })
        .submitButton({ translate: "mmba.colorway.apply" });

    form.show(player).then((response) => {
        if (!player?.isValid) {
            openMenus.delete(player?.id);
            return;
        }

        if (response.canceled) {
            if (response.cancelationReason === FormCancelationReason.UserBusy && busyRetries < 6) {
                system.runTimeout(() => {
                    showColorwayForm(player, busyRetries + 1, onExit);
                }, 4);
                return;
            }
            closePreview(player, onExit);
            return;
        }

        const values = response.formValues;
        if (Array.isArray(values) && values.length >= 4 && values[3] === true) {
            setPropSafe(player, PropHue, 0);
            setPropSafe(player, PropSat, 0);
            setPropSafe(player, PropBri, 0);
        } else if (Array.isArray(values) && values.length >= 3) {
            setPropSafe(player, PropHue, clampInt(values[0], -180, 180, 0));
            setPropSafe(player, PropSat, clampInt(values[1], -100, 100, 0));
            setPropSafe(player, PropBri, clampInt(values[2], -100, 100, 0));
        }


        system.runTimeout(() => {
            if (!player?.isValid || !openMenus.has(player.id)) {
                closePreview(player, onExit);
                return;
            }
            showColorwayForm(player, 0, onExit);
        }, 2);
    }).catch(() => {
        closePreview(player, onExit);
    });
}

export function openStandColorway(player, onExit = null) {
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    if (openMenus.has(player.id)) return;

    openMenus.add(player.id);
    setPropSafe(player, PropPreview, 1);

    system.runTimeout(() => {
        if (!player?.isValid) {
            openMenus.delete(player.id);
            return;
        }
        showColorwayForm(player, 0, onExit);
    }, 2);
}

world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    if (ev.itemStack?.typeId !== PreviewItemId) return;
    openStandColorway(player, null);
});

world.afterEvents.playerLeave.subscribe((ev) => {
    openMenus.delete(ev.playerId);
});
