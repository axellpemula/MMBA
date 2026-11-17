import { world, system, MolangVariableMap } from "@minecraft/server";
import { applyHitscanDamage } from "../damage/damage.js";
import { isTimeStopped } from "./tsState.js";
import { raycastSolidBlock } from "./blocks.js";
import { getTimDetachedShootOrigin, getTimDetachedShootDir } from "../stands/tim/tim.js";
import { TimHitboxType, getTimHitboxOwner, isOwnTimHitbox } from "../stands/tim/timHitboxState.js";

const Guns = {
    "xvoid:revolver": { name: "revolver", recoil: 2.5, maxAmmo: 6, damage: 7, range: 50, pellets: 1, spread: 0, burstCount: 3, burstDelay: 3, cooldown: 12, reloadTime: 10, perRound: true, sound: "xvoid.5Mista_gun_fire1", pitch: 1, aim: { burstCount: 1, damage: 10.5, recoil: 0, cooldown: 20 } },
    "xvoid:shotgun": { name: "shotgun", recoil: 6, maxAmmo: 4, damage: 2.5, range: 12, pellets: 8, spread: 0.15, burstCount: 1, burstDelay: 3, cooldown: 15, reloadTime: 18, perRound: true, sound: "xvoid.5Mista_gun_fire3", pitch: 1, knockback: 0.9, aim: { spread: 0.05, range: 24 } },
    "xvoid:tommy_gun": { name: "tommy gun", recoil: 0.8, maxAmmo: 50, damage: 2, range: 38, pellets: 1, spread: 0.05, auto: true, burstCount: 10, burstDelay: 2, cooldown: 2, reloadTime: 45, sound: "xvoid.5Mista_gun_fire2", pitch: 1.4, punchBurst: 3 },
};
const isGunId = (id) => id in Guns;

const stats = (player, id) => (player.isSneaking && Guns[id].aim ? { ...Guns[id], ...Guns[id].aim } : Guns[id]);

const Config = {
    ammoId: "xvoid:bullet",
    trailParticle: "gun:trail",
    trailStep: 0.2,
    trailStart: 0.95,
    knockback: 0.01,
    knockbackUp: 0.1,
    hitParticle: "minecraft:critical_hit_emitter",
    smokeParticle: "gun:spark",
};


const AmmoRe = /Ammo:\s*(\d+)\s*\/\s*(\d+)/;

function parseAmmo(item) {
    for (const line of item.getLore() ?? []) {
        const m = AmmoRe.exec(line);
        if (m) return { ammo: +m[1], max: +m[2] };
    }
    const max = Guns[item.typeId]?.maxAmmo ?? 6;
    return { ammo: max, max };
}
const getAmmo = (item) => parseAmmo(item).ammo;
const getMaxAmmo = (item) => parseAmmo(item).max;


function setAmmo(item, ammo) {
    const max = getMaxAmmo(item);
    const line = `§rAmmo: ${ammo}/${max}`;
    const lore = (item.getLore() ?? []).filter((l) => !AmmoRe.test(l));
    lore.unshift(line);
    item.setLore(lore);
}

function isCreative(player) {
    try {
        const m = player.getGameMode?.();
        if (m !== undefined) return String(m).toLowerCase() === "creative";
    } catch { }
    try { return player.runCommand("testfor @s[m=creative]").successCount > 0; } catch { return false; }
}


const busy = new Map();
const lastUseTick = new Map();
const cooldownUntil = new Map();
const holding = new Set();
const heat = new Map();
const HeatDecay = 0.2;
const HeatMax = 7;
const ignoreStartUntil = new Map();


const WalkSpeed = 0.215;
const playerMovement = new Map();

system.runInterval(() => {
    const now = system.currentTick;
    for (const player of world.getAllPlayers()) {
        try {
            const loc = player.location;
            const prev = playerMovement.get(player.id);
            if (prev) {
                const dt = now - prev.lastTick;
                if (dt > 0) {
                    const dx = loc.x - prev.lastLoc.x;
                    const dz = loc.z - prev.lastLoc.z;
                    const distH = Math.hypot(dx, dz);

                    const measuredSpeed = distH < 2 ? distH / dt : 0;

                    let velSpeed = 0;
                    try {
                        const v = player.getVelocity?.();
                        if (v) velSpeed = Math.hypot(v.x, v.z);
                    } catch { }

                    let instSpeed = Math.max(measuredSpeed, velSpeed);
                    if (player.isSprinting && instSpeed < 0.22) {
                        instSpeed = 0.28;
                    }

                    prev.speed = prev.speed * 0.4 + instSpeed * 0.6;
                    prev.lastLoc.x = loc.x;
                    prev.lastLoc.y = loc.y;
                    prev.lastLoc.z = loc.z;
                    prev.lastTick = now;
                }
            } else {
                playerMovement.set(player.id, {
                    lastLoc: { x: loc.x, y: loc.y, z: loc.z },
                    lastTick: now,
                    speed: 0
                });
            }
        } catch { }
    }
}, 1);

function getPlayerSpeed(player) {
    let speed = 0;
    const tracked = playerMovement.get(player.id);
    if (tracked) {
        speed = tracked.speed;
        const dt = system.currentTick - tracked.lastTick;
        if (dt > 0) {
            try {
                const loc = player.location;
                const distH = Math.hypot(loc.x - tracked.lastLoc.x, loc.z - tracked.lastLoc.z);
                if (distH < 2) {
                    const currentRate = distH / dt;
                    if (currentRate > speed) speed = currentRate;
                }
            } catch { }
        }
    }
    try {
        const v = player.getVelocity?.();
        if (v) {
            const velSpeed = Math.hypot(v.x, v.z);
            if (velSpeed > speed) speed = velSpeed;
        }
    } catch { }

    if (player.isSprinting) {
        speed = Math.max(speed, 0.28);
    }
    return speed;
}


function bumpAnim(player, prop) {
    try { player.setProperty(prop, ((player.getProperty(prop) ?? 0) + 1) % 100); } catch { }
}

function getHeld(player) {
    const item = player.getComponent("inventory")?.container?.getItem(player.selectedSlotIndex);
    return item && isGunId(item.typeId) ? item : undefined;
}


function saveAmmo(player, slot, ammo) {
    const container = player.getComponent("inventory").container;
    const item = container.getItem(slot);
    if (!item || !isGunId(item.typeId)) return false;
    setAmmo(item, ammo);
    container.setItem(slot, item);
    return true;
}


const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function isJohnnyCrawling(player) {
    try {
        const stand = player.getProperty("property:stand");
        if (stand !== 1) return false;
        const act = player.getProperty("property:act");
        if (act !== 0 && act !== 1 && act !== 2) return false;
        if (player.getComponent("minecraft:riding") !== undefined) return false;
        if (player.isGliding || player.isSwimming || player.isClimbing) return false;
        return true;
    } catch {
        return false;
    }
}

function getShootOrigin(player) {
    const timOrigin = getTimDetachedShootOrigin(player);
    if (timOrigin) return timOrigin;
    const head = player.getHeadLocation();
    if (isJohnnyCrawling(player)) {
        return { x: head.x, y: head.y - 0.82, z: head.z };
    }
    return head;
}

function bullet(player, g, dir, hits) {
    const dim = player.dimension;
    const origin = getShootOrigin(player);


    let entityHit;
    for (const hit of dim.getEntitiesFromRay(origin, dir, { maxDistance: g.range })) {
        const e = hit.entity;
        if (e.id === player.id || isOwnTimHitbox(player, e)) continue;
        if (e.typeId === "minecraft:item" || e.typeId === "minecraft:xp_orb" || e.typeId === "xvoid:twau_tandem" || e.hasTag("non_target")) continue;
        if (e.typeId === TimHitboxType && !getTimHitboxOwner(e)?.isValid) continue;
        entityHit = hit;
        break;
    }


    const blockHit = raycastSolidBlock(dim, origin, dir, g.range);
    let blockDist = Infinity;
    if (blockHit) {
        const f = blockHit.faceLocation;
        blockDist = dist(origin, { x: blockHit.block.x + f.x, y: blockHit.block.y + f.y, z: blockHit.block.z + f.z });
    }


    let end, target;
    if (entityHit && entityHit.distance <= blockDist) {
        end = { x: origin.x + dir.x * entityHit.distance, y: origin.y + dir.y * entityHit.distance, z: origin.z + dir.z * entityHit.distance };
        target = entityHit.entity;
    } else if (blockHit) {
        end = { x: origin.x + dir.x * blockDist, y: origin.y + dir.y * blockDist, z: origin.z + dir.z * blockDist };
        const tid = blockHit.block.typeId;
        if (tid.includes("glass")) {
            try { dim.runCommand(`setblock ${blockHit.block.x} ${blockHit.block.y} ${blockHit.block.z} air destroy`); } catch { }
        } else if (tid === "minecraft:tnt") {
            try {
                dim.runCommand(`setblock ${blockHit.block.x} ${blockHit.block.y} ${blockHit.block.z} air`);
                dim.spawnEntity("minecraft:tnt", { x: blockHit.block.x + 0.5, y: blockHit.block.y, z: blockHit.block.z + 0.5 });
            } catch { }
        }
    } else {
        end = { x: origin.x + dir.x * g.range, y: origin.y + dir.y * g.range, z: origin.z + dir.z * g.range };
    }


    const total = dist(origin, end);
    let lastB = "";
    const lineLen = total - Config.trailStart;

    if (lineLen > 0) {
        const startPos = {
            x: origin.x + dir.x * Config.trailStart,
            y: origin.y - 0.15 + dir.y * Config.trailStart,
            z: origin.z + dir.z * Config.trailStart
        };
        createElectricityVFX(dim, startPos, end, {
            particleId: Config.trailParticle,
            segments: Math.max(1, Math.ceil(lineLen / 2.0)),
            thickness: 0.8,
            lengthScale: 1.0
        });
    }
    for (let d = Config.trailStart; d < total; d += Config.trailStep) {
        try {
            const loc = { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d };

            const b = dim.getBlock(loc);
            if (b && b.typeId !== "minecraft:air") {
                const bPos = `${b.x},${b.y},${b.z}`;
                if (bPos !== lastB) {
                    lastB = bPos;
                    const tid = b.typeId;
                    if (/(grass|double_plant|flower|fern|rose|orchid|tulip|bluet|daisy|dandelion|poppy|allium|cornflower|lily|sunflower|lilac|peony|pitcher|torchflower|spore_blossom|roots|fungus|mushroom|wheat|carrots|potatoes|beetroot|stem|sugar_cane|kelp|seagrass|vine|bush|sapling|azalea|leaves)/.test(tid) && !tid.includes("grass_block") && !tid.includes("grass_path") && !tid.includes("glass")) {
                        try { dim.runCommand(`setblock ${b.x} ${b.y} ${b.z} air destroy`); } catch { }
                    }
                }
            }
        } catch { }
    }

    if (target || blockHit) {
        try { dim.spawnParticle(Config.hitParticle, end); } catch { }
    }
    if (target) {
        const resolved = target.typeId === TimHitboxType ? getTimHitboxOwner(target) : target;
        if (resolved?.isValid) hits.set(resolved, (hits.get(resolved) ?? 0) + 1);
    }
}


export function createElectricityVFX(dimension, startPos, endPos, options = {}) {
    if (!dimension) return;

    const particleId = options.particleId || "gun:trail";
    const segments = Math.max(1, options.segments ?? 1);

    const thickness = options.thickness ?? 0.8;
    const lengthScale = options.lengthScale ?? 1.0;

    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const dz = endPos.z - startPos.z;

    let distSq = dx * dx + dy * dy + dz * dz;
    if (distSq <= 1e-12) distSq = 1.0;
    const length = Math.sqrt(distSq);

    const segLen = length / segments;
    const dir = { x: dx / length, y: dy / length, z: dz / length };


    const spreadX = segLen * 0.5 * lengthScale;
    const spreadY = 0.04 * thickness;

    for (let i = 0; i < segments; i++) {

        const center = {
            x: startPos.x + dir.x * (segLen * (i + 0.5)),
            y: startPos.y + dir.y * (segLen * (i + 0.5)),
            z: startPos.z + dir.z * (segLen * (i + 0.5))
        };

        try {

            const vars = new MolangVariableMap();
            vars.setVector3("variable.dir", dir);
            vars.setFloat("variable.spreadX", spreadX);
            vars.setFloat("variable.spreadY", spreadY);
            dimension.spawnParticle(particleId, center, vars);
        } catch (e) {
            console.warn(`Trail particle failed: ${e}`);
        }
    }
}


function shoot(player, g) {
    const dim = player.dimension;
    const view = getTimDetachedShootDir(player) ?? player.getViewDirection();

    try {
        const head = getShootOrigin(player);
        const d = Config.trailStart;
        dim.spawnParticle(Config.smokeParticle, {
            x: head.x + view.x * d,
            y: head.y - 0.15 + view.y * d,
            z: head.z + view.z * d
        });
    } catch { }


    const speed = getPlayerSpeed(player);
    const speedFactor = Math.min(2.5, speed / WalkSpeed);
    const isAirborne = player.isOnGround === false;


    const baseStance = player.isSneaking ? 0.5 : 1.0;
    const recoilMult = baseStance + (speedFactor * 0.6) + (isAirborne ? 0.4 : 0);
    const rc = (g.recoil ?? 0) * recoilMult;


    const hs0 = heat.get(player.id);
    const climb = hs0 ? Math.max(0, hs0.v - (system.currentTick - hs0.t) * HeatDecay) : 0;
    const pitch = Math.asin(Math.max(-1, Math.min(1, view.y))) + climb * Math.PI / 180;
    const hz = Math.hypot(view.x, view.z) || 1;
    const base = { x: view.x / hz * Math.cos(pitch), y: Math.sin(pitch), z: view.z / hz * Math.cos(pitch) };


    const baseSpread = g.spread ?? 0;
    const spreadMult = (player.isSneaking ? 0.7 : 1.0) + (speedFactor * 0.8) + (isAirborne ? 0.6 : 0);
    let moveSpreadBloom = (speedFactor * 0.05) + (isAirborne ? 0.06 : 0);
    if (player.isSneaking && speedFactor < 0.35) {
        moveSpreadBloom *= 0.25;
    }
    const effectiveSpread = (baseSpread * spreadMult) + moveSpreadBloom;

    const hits = new Map();
    for (let i = 0; i < g.pellets; i++) {
        const r = () => (Math.random() - 0.5) * 2 * effectiveSpread;
        const d = { x: base.x + r(), y: base.y + r(), z: base.z + r() };
        const len = Math.hypot(d.x, d.y, d.z);
        bullet(player, g, { x: d.x / len, y: d.y / len, z: d.z / len }, hits);
    }

    bumpAnim(player, "property:gun_shot");
    dim.playSound(g.sound, getShootOrigin(player), { volume: 1, pitch: g.pitch });

    const now = system.currentTick;
    const hs = heat.get(player.id);
    const cur = hs ? Math.max(0, hs.v - (now - hs.t) * HeatDecay) : 0;
    const maxClimb = HeatMax * (1 + Math.min(1.0, speedFactor * 0.4) + (isAirborne ? 0.3 : 0));
    heat.set(player.id, { v: Math.min(maxClimb, cur + rc), t: now });

    try { player.addEffect("slowness", 10, { amplifier: 1, showParticles: false }); } catch { }
    try {
        const intensity = Math.min(0.14, 0.03 + rc * 0.03).toFixed(3);
        player.runCommand(`camerashake add @s ${intensity} 0.1 rotational`);
        player.runCommand(`camerashake add @a[rm=0.1] ${intensity} 0.1`);
    } catch { }
    for (const [target, n] of hits) {
        if (!target.isValid) continue;
        try {
            applyHitscanDamage(player, target, g.damage * n);
            const kb = g.knockback ?? Config.knockback;
            if (kb > 0 && !target.hasTag("blocking") && !target.hasTag("tusk_detached") && !target.hasTag("tusk_spatial") && !target.hasTag("tusk_rotation") && !target.hasTag("tim_unravel")) {
                target.applyKnockback({ x: base.x * kb, z: base.z * kb }, Config.knockbackUp);
            }
            dim.playSound("random.orb", target.location, { volume: 0.5, pitch: 0.8 });
        } catch { }
    }
}


function emptyClick(player) {
    player.dimension.playSound("random.click", player.location, { volume: 0.8, pitch: 1.5 });
}

function canUseGun(player, typeId) {
    if (isTimeStopped()) return false;
    if (player.hasTag("tim_unravel")) {
        if (typeId === "xvoid:tommy_gun" || typeId === "xvoid:shotgun") {
            try { player.onScreenDisplay.setActionBar("§c2-handed guns (Tommy / Shotgun) cannot be used while detached!"); } catch { }
            return false;
        }
        return true;
    }
    if (player.hasTag("onSkill")) {

        return player.hasTag("tim_grapple") && typeId === "xvoid:revolver";
    }
    return true;
}


function fire(player, count, hold = false) {
    const gun = getHeld(player);
    if (!gun || !canUseGun(player, gun.typeId)) return;
    const b = busy.get(player.id);
    if (b) {
        if (b.type === 'reload' && gun && getAmmo(gun) > 0) {
            system.clearRun(b.id);
            busy.delete(player.id);
            player.onScreenDisplay.setActionBar("§cReload cancelled");
        } else return;
    }
    if (system.currentTick < (cooldownUntil.get(player.id) ?? 0)) return;
    const slot = player.selectedSlotIndex;
    const g = stats(player, gun.typeId);
    if (getAmmo(gun) <= 0) return (player.isSneaking || player.hasTag("tim_unravel")) ? reload(player) : emptyClick(player);

    busy.set(player.id, { type: 'fire' });
    let fired = 0;
    let lastAmmoLeft = getAmmo(gun);
    let pending;
    const done = () => {
        busy.delete(player.id);
        cooldownUntil.set(player.id, system.currentTick + g.cooldown);
        if (pending !== undefined) {
            lastAmmoLeft = pending;

            ignoreStartUntil.set(player.id, system.currentTick + 10);
            try { saveAmmo(player, slot, pending); } catch { }
        }
        if (lastAmmoLeft <= 0 && player.isValid && player.hasTag("tim_unravel")) {
            system.runTimeout(() => {
                if (player?.isValid && player.hasTag("tim_unravel")) reload(player);
            }, 1);
        }
    };
    const step = () => {
        try {
            if (!player.isValid || isTimeStopped() || player.selectedSlotIndex !== slot) return done();
            if (hold && !holding.has(player.id)) return done();
            const item = player.getComponent("inventory").container.getItem(slot);
            if (item?.typeId !== gun.typeId) return done();
            const ammo = pending ?? getAmmo(item);
            if (ammo <= 0) {
                lastAmmoLeft = 0;
                if (!player.hasTag("tim_unravel")) emptyClick(player);
                return done();
            }

            shoot(player, stats(player, item.typeId));
            lastAmmoLeft = ammo - 1;
            if (hold) pending = lastAmmoLeft;
            else saveAmmo(player, slot, lastAmmoLeft);
            player.onScreenDisplay.setActionBar(`§eAmmo: ${lastAmmoLeft}/${getMaxAmmo(item)}`);
            fired++;
            if (fired < count && lastAmmoLeft > 0) system.runTimeout(step, g.burstDelay);
            else done();
        } catch (e) {
            done();
        }
    };
    step();
}

function getReloadTime(player, g, gunId) {
    let t = g.reloadTime;
    if (gunId === "xvoid:revolver") {
        try {
            const stand = player.getProperty("property:stand");
            if (stand === 6 || stand === 4) {
                t = Math.max(1, Math.round(t / 2));
            }
        } catch { }
    }
    return t;
}

function reload(player) {
    if (busy.get(player.id)) return;
    const gun = getHeld(player);
    if (!gun || !canUseGun(player, gun.typeId)) return;
    const slot = player.selectedSlotIndex;
    const g = Guns[gun.typeId];
    const reloadTicks = getReloadTime(player, g, gun.typeId);
    const { ammo, max } = parseAmmo(gun);
    if (ammo >= max) return;

    const container = player.getComponent("inventory").container;
    const creative = isCreative(player);
    let available = 0;
    if (creative) {
        available = 999;
    } else {
        for (let i = 0; i < container.size; i++) {
            const it = container.getItem(i);
            if (it?.typeId === Config.ammoId) available += it.amount;
        }
    }
    if (available === 0) {
        player.onScreenDisplay.setActionBar("§cNo bullets!");
        return emptyClick(player);
    }

    busy.set(player.id, { type: 'reload', id: -1 });
    player.onScreenDisplay.setActionBar("§7Reloading...");
    bumpAnim(player, "property:gun_reload");
    player.dimension.playSound("random.door_open", player.location, { volume: 0.8, pitch: 1.6 });

    let ticks = 0;
    const id = system.runInterval(() => {
        try {

            if (!player.isValid || isTimeStopped() || player.selectedSlotIndex !== slot || container.getItem(slot)?.typeId !== gun.typeId) {
                system.clearRun(id);
                busy.delete(player.id);
                if (player.isValid) player.onScreenDisplay.setActionBar("§cReload cancelled");
                return;
            }
            if (!player.hasTag("tim_unravel")) {
                try { player.addEffect("slowness", 5, { amplifier: 3, showParticles: false }); } catch { }
            }
            if (++ticks < reloadTicks) return;


            const current = container.getItem(slot);
            const cur = getAmmo(current);
            const maxA = getMaxAmmo(current);
            let need = g.perRound ? 1 : maxA - cur;
            let taken = 0;
            if (isCreative(player)) {
                taken = need;
            } else {
                for (let i = 0; i < container.size && need > 0; i++) {
                    const it = container.getItem(i);
                    if (it?.typeId !== Config.ammoId) continue;
                    const take = Math.min(it.amount, need);
                    if (take === it.amount) container.setItem(i);
                    else { it.amount -= take; container.setItem(i, it); }
                    need -= take;
                    taken += take;
                }
            }
            if (taken > 0) saveAmmo(player, slot, cur + taken);
            if (taken > 0 && g.perRound && cur + taken < maxA) {

                ticks = 0;
                bumpAnim(player, "property:gun_reload");
                player.dimension.playSound("random.click", player.location, { volume: 0.8, pitch: 1.2 });
                player.onScreenDisplay.setActionBar(`§7Reloading... ${cur + taken}/${maxA}`);
                return;
            }
            system.clearRun(id);
            busy.delete(player.id);
            if (taken === 0) return player.onScreenDisplay.setActionBar("§cNo bullets!");
            player.dimension.playSound("random.door_close", player.location, { volume: 0.8, pitch: 1.8 });
            player.onScreenDisplay.setActionBar(`§aReloaded ${cur + taken}/${maxA}`);
        } catch (e) {
            system.clearRun(id);
            busy.delete(player.id);
        }
    }, 1);
    busy.set(player.id, { type: 'reload', id });
}


world.afterEvents.itemUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack || !isGunId(itemStack.typeId)) return;
    if (!canUseGun(player, itemStack.typeId)) return;
    lastUseTick.set(player.id, system.currentTick);
    const g = Guns[itemStack.typeId];
    if (g.auto) return;
    fire(player, stats(player, itemStack.typeId).burstCount);
});


world.afterEvents.itemStartUse.subscribe(({ source: player, itemStack }) => {
    if (!itemStack || !Guns[itemStack.typeId]?.auto) return;
    if (!canUseGun(player, itemStack.typeId)) return;
    if (system.currentTick < (ignoreStartUntil.get(player.id) ?? 0)) return;
    holding.add(player.id);
    lastUseTick.set(player.id, system.currentTick);
    fire(player, Infinity, true);
});
world.afterEvents.itemStopUse?.subscribe(({ source }) => holding.delete(source.id));
world.afterEvents.itemReleaseUse?.subscribe(({ source }) => holding.delete(source.id));
world.afterEvents.itemCompleteUse?.subscribe(({ source }) => holding.delete(source.id));


function onPunch(player) {
    const held = getHeld(player);
    if (!player?.isValid || !held || !canUseGun(player, held.typeId)) return;
    if (system.currentTick - (lastUseTick.get(player.id) ?? -100) < 3) return;
    if (player.isSneaking) return reload(player);
    fire(player, Guns[held.typeId].punchBurst ?? 1);
}

if (world.afterEvents.playerSwingStart) {
    world.afterEvents.playerSwingStart.subscribe(({ player }) => onPunch(player));
} else {
    world.afterEvents.entityHitEntity.subscribe(({ damagingEntity }) => {
        if (damagingEntity?.typeId === "minecraft:player") onPunch(damagingEntity);
    });
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
    busy.delete(playerId);
    lastUseTick.delete(playerId);
    cooldownUntil.delete(playerId);
    holding.delete(playerId);
    heat.delete(playerId);
    playerMovement.delete(playerId);
    ignoreStartUntil.delete(playerId);
});
