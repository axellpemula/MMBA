export const TimHitboxType = "xvoid:tim_hitbox";


const timHitboxOwners = new Map();

export function registerTimHitbox(entity, owner, part) {
    if (!entity?.isValid || !owner?.isValid) return;
    timHitboxOwners.set(entity.id, {
        owner,
        ownerId: owner.id,
        part,
    });
}

export function unregisterTimHitbox(entityId) {
    if (!entityId) return;
    timHitboxOwners.delete(entityId);
}

export function hasRegisteredTimHitbox(entityId) {
    return timHitboxOwners.has(entityId);
}

export function getTimHitboxOwner(entity) {
    if (!entity?.isValid || entity.typeId !== TimHitboxType) return null;
    const rec = timHitboxOwners.get(entity.id);
    if (!rec?.owner?.isValid) return null;
    return rec.owner;
}

export function isOwnTimHitbox(casterOrId, entity) {
    if (!entity?.isValid || entity.typeId !== TimHitboxType) return false;
    const casterId = typeof casterOrId === "string" ? casterOrId : casterOrId?.id;
    if (!casterId) return false;
    const rec = timHitboxOwners.get(entity.id);
    if (!rec) return true;
    return rec.ownerId === casterId;
}

export function resolveTargetEntity(entity) {
    if (!entity?.isValid) return null;
    if (entity.typeId === TimHitboxType) {
        return getTimHitboxOwner(entity);
    }
    return entity;
}
