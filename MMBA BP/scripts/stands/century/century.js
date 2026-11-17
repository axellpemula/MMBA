import { world, system } from "@minecraft/server";

const CenturyTag = "century_active";

system.runInterval(() => {
    const standCObj = world.scoreboard.getObjective("standC");
    if (!standCObj) return;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        let standC = 0;
        try {
            standC = standCObj.getScore(player) ?? 0;
        } catch { }

        const equippable = player.getComponent("equippable");
        const mainhand = equippable?.getEquipment("Mainhand");
        const isHoldingStand2 = mainhand?.typeId === "jjba:stand2";
        const isSneaking = player.isSneaking;

        const shouldBeActive = (standC === 7) && isHoldingStand2 && isSneaking;

        if (shouldBeActive) {
            if (!player.hasTag(CenturyTag)) {
                player.addTag(CenturyTag);
                try {
                    player.runCommand("inputpermission set @s lateral_movement disabled");
                    player.runCommand("inputpermission set @s jump disabled");
                    player.runCommand("effect @s slowness 1 255 true");
                } catch { }
            }
            try {
                player.onScreenDisplay.setActionBar("§e< 20th Century Boy — Absolute Defense >");
            } catch { }
        } else {
            if (player.hasTag(CenturyTag)) {
                player.removeTag(CenturyTag);
                try {
                    player.runCommand("inputpermission set @s lateral_movement enabled");
                    player.runCommand("inputpermission set @s jump enabled");
                    player.runCommand("effect @s slowness 0 0 true");
                } catch { }
            }
        }
    }
}, 1);


world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (initialSpawn) return;
    try {
        if (player.hasTag(CenturyTag)) {
            player.removeTag(CenturyTag);
            player.runCommand("inputpermission set @s lateral_movement enabled");
            player.runCommand("inputpermission set @s jump enabled");
        }
    } catch { }
});
