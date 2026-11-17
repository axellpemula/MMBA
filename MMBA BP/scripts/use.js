import { world, system } from "@minecraft/server";

system.runInterval(() => {
    const objective = world.scoreboard.getObjective("standC");
    if (!objective) return;

    const standUsers = [];
    const nonStandUsers = [];

    for (const player of world.getAllPlayers()) {
        let score = 0;
        try {
            score = objective.getScore(player) ?? 0;
        } catch {
            score = 0;
        }
        (score > 0 ? standUsers : nonStandUsers).push(player);
    }

    if (!standUsers.length || !nonStandUsers.length) return;

    for (const standUser of standUsers) {
        try {
            standUser.playAnimation("stand_invis", {
                players: nonStandUsers,
                blendOutTime: 0,
                stopExpression: "0"
            });
        } catch { }
    }
}, 2);
