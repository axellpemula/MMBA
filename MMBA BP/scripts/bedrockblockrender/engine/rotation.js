import { normalize, dot } from "./vectors.js";

const DegToRad = Math.PI / 180;


export function rotateVector(v, axis, degrees) {
    const rad = degrees * DegToRad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const { x, y, z } = v;
    if (axis === "x")
        return { x, y: y * c - z * s, z: y * s + z * c };
    if (axis === "y")
        return { x: x * c + z * s, y, z: -x * s + z * c };
    if (axis === "z")
        return { x: x * c - y * s, y: x * s + y * c, z };
    throw new Error(`unknown rotation axis ${axis}`);
}

export function rotateEulerXYZ(v, rotation) {
    let result = rotateVector(v, "x", rotation.x);
    result = rotateVector(result, "y", rotation.y);
    result = rotateVector(result, "z", rotation.z);
    return result;
}


export function rotateAboutAxis(v, axis, degrees) {
    const k = normalize(axis);
    const rad = degrees * DegToRad;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const cross = {
        x: k.y * v.z - k.z * v.y,
        y: k.z * v.x - k.x * v.z,
        z: k.x * v.y - k.y * v.x
    };
    const kv = dot(k, v) * (1 - c);
    return {
        x: v.x * c + cross.x * s + k.x * kv,
        y: v.y * c + cross.y * s + k.y * kv,
        z: v.z * c + cross.z * s + k.z * kv
    };
}
