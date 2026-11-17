import { world, system } from "@minecraft/server";
import * as mc from "@minecraft/server";


const StandObjective = "standC";
const StandValue = 4;
const RefreshInterval = 20;

const RewindTicks = 120;
const SnapSearch = 20;
const Ring = RewindTicks + 160;
const RadiusSq = 50 * 50;
const OverlapSq = 100 * 100;
const BlocksPerTick = 128;
const PruneInterval = 40;

const TrackRadius = 80;
const RewindOtherHealth = true;

const LoreInterval = 5;


const AmmoItems = new Set([
    "xvoid:bullet",
]);

const Slots = 4;
const SlotMandom = 0;

const Commands = ["xvoid:mandom", "jojo:mandom"];
const ChatTriggers = new Set(["!mandom"]);

const Dims = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const TrackedDrops = new Set([
    "minecraft:item",
    "minecraft:arrow",
    "minecraft:thrown_trident",
    "minecraft:splash_potion",
    "minecraft:lingering_potion",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:wind_charge_projectile",
]);

const ExcludedTypes = new Set([
    ...TrackedDrops,
    "xvoid:dmg",
    "xvoid:tim_hitbox",
    "minecraft:xp_orb",
    "minecraft:lightning_bolt",
    "minecraft:area_effect_cloud",
    "minecraft:falling_block",
    "minecraft:tnt",
    "minecraft:fireball",
    "minecraft:small_fireball",
]);


function on(signal, fn, label) {
    if (!signal || typeof signal.subscribe !== "function") {
        console.warn(`[mandom] ${label} unavailable; feature disabled`);
        return;
    }
    signal.subscribe(fn);
}

function isPlayer(ent) {
    return ent.typeId === "minecraft:player";
}

function isStandUser(ent) {
    const obj = world.scoreboard.getObjective(StandObjective);
    if (!obj) return false;
    try { return obj.getScore(ent.scoreboardIdentity ?? ent) === StandValue; } catch (_) { return false; }
}


class EntityBuffer {
    constructor(entity) {
        this.entity = entity;
        this.health = entity.getComponent("minecraft:health");
        this.tick = new Int32Array(Ring).fill(-1);
        this.x = new Float64Array(Ring);
        this.y = new Float64Array(Ring);
        this.z = new Float64Array(Ring);
        this.rx = new Float32Array(Ring);
        this.ry = new Float32Array(Ring);
        this.hp = new Float32Array(Ring);
        this.dim = new Int8Array(Ring);
        this.vx = new Float32Array(Ring);
        this.vy = new Float32Array(Ring);
        this.vz = new Float32Array(Ring);
        this.cdRing = new Int32Array(Ring * Slots);
        this.cd = new Int32Array(Slots);
        this.cdScore = new Int32Array(Ring);
        this.stunScore = new Int32Array(Ring);

        this.hasInventory = entity.typeId === "minecraft:player";
        this.loreSnaps = [];
    }

    reset() {
        this.tick.fill(-1);
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
        this.loreSnaps = [];
    }

    sample(t, cdObj, stunObj) {
        const e = this.entity;
        const i = t % Ring;
        const loc = e.location;
        const rot = e.getRotation();
        let h = this.health;
        if (!h || !h.isValid) h = this.health = e.getComponent("minecraft:health");

        this.tick[i] = t;
        this.x[i] = loc.x;
        this.y[i] = loc.y;
        this.z[i] = loc.z;
        this.rx[i] = rot.x;
        this.ry[i] = rot.y;
        this.hp[i] = h ? h.currentValue : 0;

        let vel;
        try { vel = e.getVelocity(); } catch (_) { }
        this.vx[i] = vel ? vel.x : 0;
        this.vy[i] = vel ? vel.y : 0;
        this.vz[i] = vel ? vel.z : 0;

        const dimIdx = Dims.indexOf(e.dimension.id);
        this.dim[i] = dimIdx === -1 ? 0 : dimIdx;

        const base = i * Slots;
        for (let k = 0; k < Slots; k++) this.cdRing[base + k] = this.cd[k];


        const who = e.scoreboardIdentity;
        let cScore = 0;
        let sScore = 0;
        if (who) {
            if (cdObj) { try { cScore = cdObj.getScore(who) ?? 0; } catch (_) { } }
            if (stunObj) { try { sScore = stunObj.getScore(who) ?? 0; } catch (_) { } }
        }
        this.cdScore[i] = cScore > 0 ? t + cScore : 0;
        this.stunScore[i] = sScore > 0 ? t + sScore : 0;

        if (this.hasInventory && t % LoreInterval === 0) this.snapLore(t);
    }


    snapLore(t) {
        const slots = [];
        const ammo = new Map();
        try {
            const inv = this.entity.getComponent("minecraft:inventory")?.container;
            if (inv) {
                for (let s = 0; s < inv.size; s++) {
                    const it = inv.getItem(s);
                    if (!it) continue;
                    if (AmmoItems.has(it.typeId)) ammo.set(it.typeId, (ammo.get(it.typeId) ?? 0) + it.amount);
                    const lore = it.getLore();
                    if (lore.length > 0) slots.push({ slot: s, typeId: it.typeId, lore });
                }
            }
        } catch (_) { }
        this.loreSnaps.push({ tick: t, slots, ammo });
        const cutoff = t - Ring;
        while (this.loreSnaps.length > 0 && this.loreSnaps[0].tick < cutoff) this.loreSnaps.shift();
    }


    restoreLore(target) {
        if (!this.hasInventory || this.loreSnaps.length === 0) return;
        let snap = null;
        for (const s of this.loreSnaps) {
            if (s.tick <= target) snap = s; else break;
        }
        snap ??= this.loreSnaps[0];

        const inv = this.entity.getComponent("minecraft:inventory")?.container;
        if (!inv) return;

        const apply = (item, slot, lore) => {
            const cur = item.getLore();
            if (cur.length === lore.length && cur.every((l, i) => l === lore[i])) return;
            item.setLore(lore);
            inv.setItem(slot, item);
        };

        const claimed = new Set();
        const pending = [];
        for (const e of snap.slots) {
            const item = e.slot < inv.size ? inv.getItem(e.slot) : undefined;
            if (item && item.typeId === e.typeId) {
                apply(item, e.slot, e.lore);
                claimed.add(e.slot);
            } else pending.push(e);
        }


        const snapSlots = new Set(snap.slots.map((e) => e.slot));
        for (const e of pending) {
            for (let s = 0; s < inv.size; s++) {
                if (claimed.has(s) || snapSlots.has(s)) continue;
                const item = inv.getItem(s);
                if (!item || item.typeId !== e.typeId) continue;
                apply(item, s, e.lore);
                claimed.add(s);
                break;
            }
        }


        this.restoreAmmo(inv, snap);


        this.loreSnaps = this.loreSnaps.filter((s) => s.tick <= snap.tick);
    }


    restoreAmmo(inv, snap) {
        if (!snap.ammo || snap.ammo.size === 0) return;

        const now = new Map();
        for (let s = 0; s < inv.size; s++) {
            const it = inv.getItem(s);
            if (it && AmmoItems.has(it.typeId)) now.set(it.typeId, (now.get(it.typeId) ?? 0) + it.amount);
        }

        for (const [typeId, had] of snap.ammo) {
            let missing = had - (now.get(typeId) ?? 0);
            if (missing <= 0) continue;
            let max = 64;
            try { max = new mc.ItemStack(typeId, 1).maxAmount; } catch (_) { }
            while (missing > 0) {
                const n = Math.min(missing, max);
                try { giveBack(this.entity, new mc.ItemStack(typeId, n)); } catch (_) { break; }
                missing -= n;
            }
        }
    }


    findSnapshot(target) {
        const idx = ((target % Ring) + Ring) % Ring;
        if (this.tick[idx] === target) return idx;

        for (let d = 1; d <= SnapSearch; d++) {
            const tb = target - d;
            const ib = ((tb % Ring) + Ring) % Ring;
            if (this.tick[ib] === tb) return ib;
            const ta = target + d;
            const ia = ((ta % Ring) + Ring) % Ring;
            if (this.tick[ia] === ta) return ia;
        }

        let oldestTick = Infinity;
        let oldestIdx = -1;
        for (let i = 0; i < Ring; i++) {
            const t = this.tick[i];
            if (t !== -1 && t < oldestTick) { oldestTick = t; oldestIdx = i; }
        }
        return oldestIdx;
    }


    overwriteHistory(i, fromTick, toTick) {
        const x = this.x[i], y = this.y[i], z = this.z[i];
        const rx = this.rx[i], ry = this.ry[i], hp = this.hp[i], dim = this.dim[i];
        const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
        const cs = this.cdScore[i], ss = this.stunScore[i];
        for (let t = fromTick; t <= toTick; t++) {
            const j = t % Ring;
            this.tick[j] = t;
            this.x[j] = x; this.y[j] = y; this.z[j] = z;
            this.rx[j] = rx; this.ry[j] = ry;
            this.hp[j] = hp; this.dim[j] = dim;
            this.vx[j] = vx; this.vy[j] = vy; this.vz[j] = vz;
            this.cdScore[j] = cs; this.stunScore[j] = ss;
            const base = j * Slots;
            for (let k = 0; k < Slots; k++) this.cdRing[base + k] = this.cd[k];
        }
    }
}

const buffers = new Map();
const leftCooldowns = new Map();

function register(entity) {
    let b = buffers.get(entity.id);
    if (b) {
        b.entity = entity;
        b.health = entity.getComponent("minecraft:health");
        return b;
    }
    b = new EntityBuffer(entity);
    const left = leftCooldowns.get(entity.id);
    if (left !== undefined) {
        b.cd[SlotMandom] = left;
        leftCooldowns.delete(entity.id);
    }
    buffers.set(entity.id, b);
    return b;
}

function dropBuffer(id, b) {
    if (b.cd[SlotMandom] > system.currentTick) leftCooldowns.set(id, b.cd[SlotMandom]);
    buffers.delete(id);
}

const FilteredFamilies = ["inanimate", "damage", "atk", "real"];

const FilteredParticleTypes = new Set([
    "xvoid:dmg",
    "xvoid:tim_hitbox",
    "minecraft:xp_orb", "xp_orb",
    "minecraft:item", "item",
    "minecraft:armor_stand", "armor_stand",
    "minecraft:thrown_trident", "thrown_trident",
    "minecraft:arrow", "arrow",
    "minecraft:area_effect_cloud", "area_effect_cloud",
    "minecraft:minecart", "minecart",
    "minecraft:chest_minecart", "chest_minecart",
    "minecraft:command_block_minecart", "command_block_minecart",
    "minecraft:hopper_minecart", "hopper_minecart",
    "minecraft:tnt_minecart", "tnt_minecart",
    "minecraft:furnace_minecart", "furnace_minecart",
    "minecraft:dragon_fireball", "dragon_fireball",
    "minecraft:egg", "egg",
    "minecraft:snowball", "snowball",
    "minecraft:ender_crystal", "ender_crystal",
    "minecraft:ender_pearl", "ender_pearl",
    "minecraft:evocation_fang", "evocation_fang",
    "minecraft:falling_block", "falling_block",
    "minecraft:fireball", "fireball",
    "minecraft:small_fireball", "small_fireball",
    "minecraft:fireworks_rocket", "fireworks_rocket",
    "minecraft:fishing_hook", "fishing_hook",
    "minecraft:leash_knot", "leash_knot",
    "minecraft:lightning_bolt", "lightning_bolt",
    "minecraft:lingering_potion", "lingering_potion",
    "minecraft:splash_potion", "splash_potion",
    "minecraft:llama_spit", "llama_spit",
    "minecraft:wind_charge_projectile", "wind_charge_projectile",
    "minecraft:breeze_wind_charge_projectile", "breeze_wind_charge_projectile",
    "minecraft:tnt", "tnt",
]);

function isInanimateOrFiltered(ent) {
    if (!ent || !ent.isValid) return true;
    const typeId = ent.typeId;
    if (FilteredParticleTypes.has(typeId)) return true;

    for (const fam of FilteredFamilies) {
        try {
            if (ent.matches({ families: [fam] })) return true;
        } catch (_) { }
    }
    return false;
}


function refreshTracked() {
    const obj = world.scoreboard.getObjective(StandObjective);
    const seen = new Set();
    const casters = [];

    if (obj) {
        for (const part of obj.getParticipants()) {
            let score;
            try { score = obj.getScore(part); } catch (_) { continue; }
            if (score !== StandValue) continue;
            let ent;
            try { ent = part.getEntity(); } catch (_) { continue; }
            if (!ent || !ent.isValid) continue;
            seen.add(ent.id);
            register(ent);
            casters.push(ent);
        }
    }


    for (const c of casters) {
        let near;
        try {
            near = c.dimension.getEntities({ location: c.location, maxDistance: TrackRadius });
        } catch (_) { continue; }
        for (const ent of near) {
            if (seen.has(ent.id) || !ent.isValid || ExcludedTypes.has(ent.typeId) || isInanimateOrFiltered(ent)) continue;
            seen.add(ent.id);
            register(ent);
        }
    }

    for (const [id, b] of buffers) {
        if (!seen.has(id)) dropBuffer(id, b);
    }
}


export function setCooldown(entity, slot, readyAtTick) {
    const b = buffers.get(entity.id);
    if (b && slot >= 0 && slot < Slots) b.cd[slot] = readyAtTick;
}

on(world.afterEvents.playerSpawn, (e) => {
    const b = buffers.get(e.player.id);
    if (b && !e.initialSpawn) b.reset();
}, "playerSpawn");

on(world.afterEvents.playerLeave, (e) => {
    const b = buffers.get(e.playerId);
    if (b) dropBuffer(e.playerId, b);
}, "playerLeave");


const blockLog = [];

function logBlock(tick, dimensionId, x, y, z, permutation, extra) {
    blockLog.push({ tick, dimensionId, x, y, z, permutation, ...extra });
}

let airPerm = null;
function getAir() {
    return airPerm ??= mc.BlockPermutation.resolve("minecraft:air");
}

on(world.afterEvents.playerBreakBlock, (e) => {
    const b = e.block;
    logBlock(system.currentTick, e.dimension.id, b.x, b.y, b.z, e.brokenBlockPermutation);
}, "playerBreakBlock");

on(world.afterEvents.playerPlaceBlock, (e) => {
    const b = e.block;
    let stack;
    try { stack = b.getItemStack(1, true); } catch (_) { }
    let creative = false;
    try { creative = e.player.getGameMode() === mc.GameMode.Creative; } catch (_) { }


    logBlock(system.currentTick, b.dimension.id, b.x, b.y, b.z, getAir(), {
        placerId: e.player.id,
        placedType: b.typeId,
        stack: creative ? undefined : stack,
    });
}, "playerPlaceBlock");

on(world.beforeEvents?.explosion, (e) => {
    if (e.cancel) return;
    const t = system.currentTick;
    const dimId = e.dimension.id;
    const blocks = e.getImpactedBlocks();
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        logBlock(t, dimId, b.x, b.y, b.z, b.permutation);
    }
}, "beforeEvents.explosion");

function pruneBlockLog(now) {
    const cutoff = now - Ring;
    let n = 0;
    while (n < blockLog.length && blockLog[n].tick < cutoff) n++;
    if (n > 0) blockLog.splice(0, n);
}


function dedupeOldestFirst(list) {
    const map = new Map();
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const key = `${e.x},${e.y},${e.z}`;
        if (!map.has(key)) map.set(key, e);
    }
    return Array.from(map.values());
}


function extractBlocks(dimId, cx, cy, cz, target) {
    const picked = [];
    let w = 0;
    for (let r = 0; r < blockLog.length; r++) {
        const e = blockLog[r];
        let take = false;
        if (e.tick >= target && e.dimensionId === dimId) {
            const dx = e.x - cx, dy = e.y - cy, dz = e.z - cz;
            take = dx * dx + dy * dy + dz * dz <= RadiusSq;
        }
        if (take) picked.push(e);
        else blockLog[w++] = e;
    }
    blockLog.length = w;
    return picked;
}


function giveBack(player, stack) {
    if (!player || !player.isValid || !stack) return;
    let leftover = stack;
    try {
        const inv = player.getComponent("minecraft:inventory")?.container;
        if (inv) leftover = inv.addItem(stack);
    } catch (_) { }
    if (leftover) {
        try { player.dimension.spawnItem(leftover, player.location); } catch (_) { }
    }
}


function refundPlacedBlocks(dim, fresh) {
    const latest = new Map();
    for (const e of fresh) {
        if (e.placerId) latest.set(`${e.x},${e.y},${e.z}`, e);
    }
    if (latest.size === 0) return;

    const players = new Map();
    for (const p of world.getAllPlayers()) players.set(p.id, p);

    for (const e of latest.values()) {
        if (!e.stack) continue;
        const player = players.get(e.placerId);
        if (!player || !player.isValid) continue;

        let cur;
        try { cur = dim.getBlock(e); } catch (_) { continue; }
        if (!cur || !cur.isValid || cur.typeId !== e.placedType) continue;

        giveBack(player, e.stack);
    }
}


const dropSpawn = new Map();

function distSq(l, cx, cy, cz) {
    const dx = l.x - cx, dy = l.y - cy, dz = l.z - cz;
    return dx * dx + dy * dy + dz * dz;
}


function findDropper(ent) {
    const l = ent.location;
    const dimId = ent.dimension.id;
    let best = null, bd = Infinity;
    for (const p of world.getAllPlayers()) {
        if (p.dimension.id !== dimId) continue;
        const pl = p.location;
        const dh = (pl.x - l.x) ** 2 + (pl.z - l.z) ** 2;
        const dy = l.y - pl.y;
        if (dh > 2.25 || dy < 0.8 || dy > 2.0) continue;
        if (dh < bd) { bd = dh; best = p; }
    }
    return best;
}

function findShooter(arrow) {
    try {
        const owner = arrow.getComponent("minecraft:projectile")?.owner;
        if (owner) return isPlayer(owner) ? owner : null;
    } catch (_) { }

    const l = arrow.location;
    let best = null, bd = 9;
    for (const p of world.getAllPlayers()) {
        if (p.dimension.id !== arrow.dimension.id) continue;
        const d = distSq(p.location, l.x, l.y, l.z);
        if (d < bd) { bd = d; best = p; }
    }
    return best;
}


function arrowWasConsumed(p) {
    try {
        if (p.getGameMode() === mc.GameMode.Creative) return false;
    } catch (_) { }
    try {
        const held = p.getComponent("minecraft:equippable")?.getEquipment(mc.EquipmentSlot.Mainhand);
        if (!held || held.typeId !== "minecraft:bow") return false;
        if (held.getComponent("minecraft:enchantable")?.hasEnchantment("infinity")) return false;
        return true;
    } catch (_) { return false; }
}

on(world.afterEvents.entitySpawn, (e) => {
    const ent = e.entity;
    if (!TrackedDrops.has(ent.typeId)) return;
    if (e.cause === "Loaded") return;

    const rec = { tick: system.currentTick, type: ent.typeId };
    try {
        if (ent.typeId === "minecraft:item") {
            const p = findDropper(ent);
            if (p) rec.ownerId = p.id;
        } else if (ent.typeId === "minecraft:arrow") {
            const p = findShooter(ent);
            if (p && arrowWasConsumed(p)) rec.ownerId = p.id;
        }
    } catch (_) { }
    dropSpawn.set(ent.id, rec);
}, "entitySpawn");


on(world.afterEvents.projectileHitEntity, (e) => {
    const rec = dropSpawn.get(e.projectile.id);
    if (rec) rec.hit = true;
}, "projectileHitEntity");

on(world.afterEvents.entityRemove, (e) => {
    const rec = dropSpawn.get(e.removedEntityId);
    if (rec && rec.hit && rec.ownerId) return;
    dropSpawn.delete(e.removedEntityId);
}, "entityRemove");

function purgeDrops(dimId, cx, cy, cz, target) {
    const players = new Map();
    for (const p of world.getAllPlayers()) players.set(p.id, p);

    for (const [id, rec] of dropSpawn) {
        if (rec.tick < target) continue;
        const ent = world.getEntity(id);


        if (!ent || !ent.isValid) {
            if (rec.hit && rec.ownerId) {
                const owner = players.get(rec.ownerId);
                if (owner && owner.isValid && owner.dimension.id === dimId &&
                    distSq(owner.location, cx, cy, cz) <= RadiusSq) {
                    giveBack(owner, new mc.ItemStack("minecraft:arrow", 1));
                }
            }
            dropSpawn.delete(id);
            continue;
        }

        if (ent.dimension.id !== dimId) continue;
        if (distSq(ent.location, cx, cy, cz) > RadiusSq) continue;

        let refund;
        if (rec.ownerId) {
            if (rec.type === "minecraft:item") {
                try { refund = ent.getComponent("minecraft:item")?.itemStack; } catch (_) { }
            } else if (rec.type === "minecraft:arrow") {
                refund = new mc.ItemStack("minecraft:arrow", 1);
            }
        }

        dropSpawn.delete(id);
        try { ent.remove(); } catch (_) { }
        if (refund) giveBack(players.get(rec.ownerId), refund);
    }
}

function pruneDrops(now) {
    const cutoff = now - Ring;
    for (const [id, rec] of dropSpawn) if (rec.tick < cutoff) dropSpawn.delete(id);
}


class RestoreJob {
    constructor(dimension, x, y, z, entries) {
        this.dimension = dimension;
        this.dimId = dimension.id;
        this.x = x; this.y = y; this.z = z;
        this.entries = entries;
        this.cursor = 0;
    }

    get done() { return this.cursor >= this.entries.length; }

    remaining() { return this.entries.slice(this.cursor); }

    step(limit) {
        const end = Math.min(this.cursor + limit, this.entries.length);
        const n = end - this.cursor;
        for (; this.cursor < end; this.cursor++) {
            const e = this.entries[this.cursor];
            try {
                const block = this.dimension.getBlock(e);
                if (block && block.isValid) block.setPermutation(e.permutation);
            } catch (_) { }
        }
        return n;
    }
}

const jobs = [];

function pumpJobs() {
    let budget = BlocksPerTick;
    while (budget > 0 && jobs.length > 0) {
        const job = jobs[0];
        budget -= job.step(budget);
        if (job.done) jobs.shift();
    }
}


function absorbOverlappingJobs(dimId, x, y, z) {
    let carried = [];
    for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i];
        if (j.dimId !== dimId) continue;
        const dx = j.x - x, dy = j.y - y, dz = j.z - z;
        if (dx * dx + dy * dy + dz * dz < OverlapSq) {
            carried = j.remaining().concat(carried);
            jobs.splice(i, 1);
        }
    }
    return carried;
}


function restoreEntityVelocity(ent, vx, vy, vz) {
    if (!ent?.isValid) return;
    if (Math.abs(vx) < 0.0001 && Math.abs(vy) < 0.0001 && Math.abs(vz) < 0.0001) return;

    try {
        const effVy = Math.abs(vy) >= 0.1 ? vy : 0;
        if (isPlayer(ent)) {
            let knockApplied = false;
            try {
                const h = Math.hypot(vx, vz);
                if (h > 0.001) {
                    ent.applyKnockback({ x: vx, z: vz }, effVy);
                    knockApplied = true;
                } else if (Math.abs(effVy) > 0.001) {
                    ent.applyKnockback({ x: 0, z: 0 }, effVy);
                    knockApplied = true;
                }
            } catch (_) { }

            if (!knockApplied) {
                try { ent.applyImpulse({ x: vx, y: effVy, z: vz }); } catch (_) { }
            }
        } else {
            ent.applyImpulse({ x: vx, y: effVy, z: vz });
        }
    } catch (_) { }
}

function rewindEntities(caster, dim, dimId, cx, cy, cz, target, now) {
    const cdObjective = world.scoreboard.getObjective("cd");
    const stunObjective = world.scoreboard.getObjective("stun");
    const dimIdx = Dims.indexOf(dimId);

    for (const b of buffers.values()) {
        const ent = b.entity;
        if (!ent.isValid || ent.dimension.id !== dimId) continue;

        const l = ent.location;
        const dx = l.x - cx, dy = l.y - cy, dz = l.z - cz;
        if (dx * dx + dy * dy + dz * dz > RadiusSq) continue;

        const i = b.findSnapshot(target);
        if (i < 0 || b.dim[i] !== dimIdx) continue;
        const h = b.health;
        if (h && h.isValid && h.currentValue <= 0) continue;

        const vx = b.vx[i];
        const vy = b.vy[i];
        const vz = b.vz[i];

        try {
            ent.teleport(
                { x: b.x[i], y: b.y[i], z: b.z[i] },
                { dimension: dim, rotation: { x: b.rx[i], y: b.ry[i] }, keepVelocity: false }
            );
            ent.clearVelocity();
        } catch (_) { continue; }

        restoreEntityVelocity(ent, vx, vy, vz);


        if (h && h.isValid && b.hp[i] > 0 && (RewindOtherHealth || isStandUser(ent))) {
            try { h.setCurrentValue(Math.min(b.hp[i], h.effectiveMax)); } catch (_) { }
        }


        const base = i * Slots;
        for (let k = 0; k < Slots; k++) {
            b.cd[k] = b.cdRing[base + k];
        }


        try { b.restoreLore(target); } catch (_) { }

        const who = ent.scoreboardIdentity;
        if (who && cdObjective) {
            try { cdObjective.setScore(who, Math.max(0, b.cdScore[i] - b.tick[i])); } catch (_) { }
        }
        if (who && stunObjective) {
            try { stunObjective.setScore(who, Math.max(0, b.stunScore[i] - b.tick[i])); } catch (_) { }
        }


        b.overwriteHistory(i, Math.min(b.tick[i] + 1, target + 1), now);

        if (isPlayer(ent) && ent.id === caster?.entity?.id) {
            try {
                ent.playSound("portal.travel", { volume: 0.6, pitch: 1.8 });
                ent.playSound("random.levelup", { volume: 0.5, pitch: 2.0 });
            } catch (_) { }
        }
    }
}


const frozenCheckpoints = new Map();

export function freezeCheckpoint(entity, now = system.currentTick) {
    if (!entity?.isValid) return now - RewindTicks;
    const target = now - RewindTicks;
    frozenCheckpoints.set(entity.id, target);
    return target;
}

export function clearFrozenCheckpoint(entity) {
    if (!entity?.id) return;
    frozenCheckpoints.delete(entity.id);
}

export function getEffectiveTargetTick(entity, now = system.currentTick) {
    if (entity?.id && frozenCheckpoints.has(entity.id)) {
        return frozenCheckpoints.get(entity.id);
    }
    return now - RewindTicks;
}


export function activateMandom(entity, targetTickOverride = null) {
    if (!entity || !entity.isValid || !isStandUser(entity)) return false;
    const now = system.currentTick;
    const buf = buffers.get(entity.id) ?? register(entity);
    const dim = entity.dimension;
    const dimId = dim.id;
    const { x: cx, y: cy, z: cz } = entity.location;
    const target = typeof targetTickOverride === "number"
        ? targetTickOverride
        : getEffectiveTargetTick(entity, now);
    frozenCheckpoints.delete(entity.id);
    const carried = absorbOverlappingJobs(dimId, cx, cy, cz);
    const fresh = extractBlocks(dimId, cx, cy, cz, target);
    refundPlacedBlocks(dim, fresh);
    const entries = dedupeOldestFirst(carried.concat(fresh));
    entries.sort((a, b) => a.y - b.y);


    purgeDrops(dimId, cx, cy, cz, target);
    rewindEntities(buf, dim, dimId, cx, cy, cz, target, now);

    if (entries.length > 0) jobs.push(new RestoreJob(dim, cx, cy, cz, entries));

    if (isPlayer(entity)) {
        try {
            entity.playSound("xvoid.world_ed", { volume: 1.0, pitch: 1.5 });
        } catch (_) {
            try {
                entity.playSound("beacon.activate", { volume: 1.0, pitch: 1.6 });
            } catch (_) { }
        }
    }

    return true;
}


if (!system.beforeEvents?.startup) {
    console.warn("[mandom] system.beforeEvents.startup missing: manifest must target @minecraft/server 2.x");
}

on(system.beforeEvents?.startup, (init) => {
    const registry = init.customCommandRegistry;
    if (!registry || typeof registry.registerCommand !== "function") {
        console.warn("[mandom] customCommandRegistry unavailable: custom commands disabled");
        return;
    }

    const Success = mc.CustomCommandStatus?.Success ?? 0;
    const Failure = mc.CustomCommandStatus?.Failure ?? 1;
    const permAny = mc.CommandPermissionLevel?.Any ?? 0;

    const handler = (origin) => {
        const ent = origin?.sourceEntity;
        if (!ent) return { status: Failure, message: "This command must be run by an entity." };
        system.run(() => activateMandom(ent));
        return { status: Success };
    };

    for (const name of Commands) {
        try {
            registry.registerCommand(
                {
                    name,
                    description: "Rewind terrain and nearby entities in a 50-block radius by 6 seconds",
                    permissionLevel: permAny,
                    cheatsRequired: false,
                },
                handler
            );
            console.warn(`[mandom] registered /${name}`);
        } catch (e) {
            console.warn(`[mandom] failed to register /${name}: ${e}`);
        }
    }
}, "system.beforeEvents.startup");


on(world.beforeEvents?.chatSend, (event) => {
    if (!ChatTriggers.has(event.message.trim().toLowerCase())) return;
    event.cancel = true;
    const sender = event.sender;
    system.run(() => activateMandom(sender));
}, "beforeEvents.chatSend");

function resolveTargets(event) {
    if (event.sourceEntity) return [event.sourceEntity];

    const token = (event.message ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";


    if (token === "@a") {
        return Array.from(buffers.values(), (b) => b.entity).filter(isStandUser);
    }

    const players = world.getAllPlayers();

    if (token === "@p" && event.sourceBlock) {
        const sb = event.sourceBlock;
        let best = null;
        let bestD = Infinity;
        for (const p of players) {
            if (p.dimension.id !== sb.dimension.id) continue;
            const l = p.location;
            const d = (l.x - sb.x) ** 2 + (l.y - sb.y) ** 2 + (l.z - sb.z) ** 2;
            if (d < bestD) { bestD = d; best = p; }
        }
        return best ? [best] : [];
    }

    return players.filter((p) => p.name.toLowerCase() === token);
}

on(system.afterEvents.scriptEventReceive, (event) => {
    const id = (event.id ?? "").toLowerCase();
    if (id !== "mandom:activate" && !id.endsWith(":mandom")) return;
    for (const ent of resolveTargets(event)) activateMandom(ent);
}, "scriptEventReceive");


const CheckpointParticleInterval = 3;
const ClockModeProp = "mandom:clock_mode";
export const ClockModeOff = 0;
export const ClockModeHolding = 1;
export const ClockModeAlways = 2;

const clockModeCache = new Map();

export function getClockMode(player) {
    if (!player?.isValid) return ClockModeHolding;
    const cached = clockModeCache.get(player.id);
    if (cached !== undefined) return cached;
    let mode = ClockModeHolding;
    try {
        const stored = player.getDynamicProperty(ClockModeProp);
        if (stored === ClockModeOff || stored === ClockModeHolding || stored === ClockModeAlways) {
            mode = stored;
        }
    } catch (_) { }
    clockModeCache.set(player.id, mode);
    return mode;
}

export function toggleClockMode(player) {
    if (!player?.isValid) return ClockModeOff;
    const next = (getClockMode(player) + 1) % 3;
    clockModeCache.set(player.id, next);
    try { player.setDynamicProperty(ClockModeProp, next); } catch (_) { }
    return next;
}

function isHoldingStand2(player) {
    try {
        const eq = player.getComponent("equippable");
        if (!eq) return false;
        const main = eq.getEquipment("Mainhand");
        if (main?.typeId === "jjba:stand2") return true;
        const off = eq.getEquipment("Offhand");
        if (off?.typeId === "jjba:stand2") return true;
    } catch (_) { }
    return false;
}

function isHostileMob(ent) {
    try {
        if (ent.matches({ families: ["monster"] })) return true;
    } catch (_) { }
    try {
        if (ent.target !== undefined) return true;
    } catch (_) { }
    const id = ent.typeId;
    return id.includes("zombie") || id.includes("skeleton") || id.includes("creeper") ||
           id.includes("spider") || id.includes("enderman") || id.includes("witch") ||
           id.includes("pillager") || id.includes("vindicator") || id.includes("evoker") ||
           id.includes("ravager") || id.includes("warden") || id.includes("slime") ||
           id.includes("magma_cube") || id.includes("blaze") || id.includes("ghast") ||
           id.includes("phantom") || id.includes("drowned") || id.includes("husk") ||
           id.includes("stray") || id.includes("wither");
}

function updateCheckpointParticles(now) {
    const viewers = [];
    for (const player of world.getAllPlayers()) {
        if (!player.isValid || !isStandUser(player)) continue;
        const mode = getClockMode(player);
        if (mode === ClockModeAlways || (mode === ClockModeHolding && isHoldingStand2(player))) {
            viewers.push(player);
        }
    }
    if (viewers.length === 0) return;

    for (const viewer of viewers) {
        const target = getEffectiveTargetTick(viewer, now);
        const dimId = viewer.dimension.id;
        const { x: vx, y: vy, z: vz } = viewer.location;
        const dimIdx = Dims.indexOf(dimId);


        for (const b of buffers.values()) {
            const ent = b.entity;
            if (!ent.isValid || ent.dimension.id !== dimId) continue;
            if (isInanimateOrFiltered(ent)) continue;

            const i = b.findSnapshot(target);
            if (i < 0 || b.dim[i] !== dimIdx) continue;
            const h = b.health;
            if (h && h.isValid && h.currentValue <= 0) continue;

            const cx = b.x[i];
            const cy = b.y[i] + 1.1;
            const cz = b.z[i];

            if (distSq({ x: cx, y: cy, z: cz }, vx, vy, vz) > RadiusSq) continue;

            let particle = "mandom:clock_hostile";
            if (ent.id === viewer.id) {
                particle = "mandom:clock_self";
            } else if (isPlayer(ent)) {
                particle = "mandom:clock_player";
            } else if (isHostileMob(ent)) {
                particle = "mandom:clock_hostile";
            } else {
                particle = "mandom:clock_passive";
            }

            try {
                viewer.spawnParticle(particle, { x: cx, y: cy, z: cz });
            } catch (_) { }
        }


        const seenBlocks = new Set();
        let blockCount = 0;
        for (let r = blockLog.length - 1; r >= 0; r--) {
            if (blockCount >= 32) break;
            const e = blockLog[r];
            if (e.tick < target || e.dimensionId !== dimId) continue;
            const key = `${e.x},${e.y},${e.z}`;
            if (seenBlocks.has(key)) continue;
            seenBlocks.add(key);

            if (distSq({ x: e.x, y: e.y, z: e.z }, vx, vy, vz) > RadiusSq) continue;

            blockCount++;
            try {
                viewer.spawnParticle("mandom:clock_block", {
                    x: e.x + 0.5,
                    y: e.y + 0.5,
                    z: e.z + 0.5
                });
            } catch (_) { }
        }


        let dropCount = 0;
        for (const [id, rec] of dropSpawn) {
            if (dropCount >= 16) break;
            if (rec.tick < target) continue;
            const ent = world.getEntity(id);
            if (!ent || !ent.isValid || ent.dimension.id !== dimId) continue;
            if (isInanimateOrFiltered(ent)) continue;
            const loc = ent.location;
            if (distSq(loc, vx, vy, vz) > RadiusSq) continue;

            dropCount++;
            try {
                viewer.spawnParticle("mandom:clock_drop", {
                    x: loc.x,
                    y: loc.y + 0.4,
                    z: loc.z
                });
            } catch (_) { }
        }
    }
}


let sampleTick = 0;
let cachedCdObj = null;
let cachedStunObj = null;

function sampleOne(b) {
    if (b.entity.isValid) b.sample(sampleTick, cachedCdObj, cachedStunObj);
}

function pruneLeftCooldowns(now) {
    for (const [id, readyAt] of leftCooldowns) if (readyAt <= now) leftCooldowns.delete(id);
}

system.runInterval(() => {
    const t = system.currentTick;
    sampleTick = t;

    if (t % RefreshInterval === 0) refreshTracked();

    if (buffers.size > 0) {
        cachedCdObj = world.scoreboard.getObjective("cd");
        cachedStunObj = world.scoreboard.getObjective("stun");
        buffers.forEach(sampleOne);
    }
    pumpJobs();

    if (t % CheckpointParticleInterval === 0) {
        updateCheckpointParticles(t);
    }

    if (t % PruneInterval === 0) {
        pruneBlockLog(t);
        pruneDrops(t);
        pruneLeftCooldowns(t);
    }
}, 1);
