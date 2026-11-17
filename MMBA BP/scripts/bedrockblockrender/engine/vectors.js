const VerticalTolerance = 0.999999;

export function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function normalize(v) {
    const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (length === 0)
        throw new Error("cannot normalize a zero-length vector");
    return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function flattenIntoPlane(v, normal) {
    const along = dot(v, normal);
    return {
        x: v.x - along * normal.x,
        y: v.y - along * normal.y,
        z: v.z - along * normal.z
    };
}

export function isVertical(v) {
    return Math.abs(v.y) >= VerticalTolerance;
}
