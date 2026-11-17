import { normalize, flattenIntoPlane, isVertical, dot } from "./vectors.js";
import { rotateAboutAxis } from "./rotation.js";

const EngineUpTilted = { x: 0, y: 1, z: 0 };
const EngineUpVertical = { x: 0, y: 0, z: 1 };

export function signedAngle(from, to, axis) {
    const a = normalize(from);
    const b = normalize(to);
    const n = normalize(axis);
    const cos = dot(a, b);
    const cross = {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    };
    const sin = dot(cross, n);
    return Math.atan2(sin, cos) * (180 / Math.PI);
}

export function engineUp(facing) {
    if (isVertical(facing))
        return { up: { ...EngineUpVertical }, handedness: -1 };
    return { up: flattenIntoPlane(EngineUpTilted, normalize(facing)), handedness: 1 };
}

function foldIntoHalfTurns(degrees) {
    let d = degrees;
    while (d > 180)
        d -= 360;
    while (d <= -180)
        d += 360;
    return d;
}

export function reconstructUp(facing, roll) {
    const { up, handedness } = engineUp(facing);
    return rotateAboutAxis(up, facing, roll * handedness);
}

export function deriveRoll(facing, up) {
    const { up: base, handedness } = engineUp(facing);
    return foldIntoHalfTurns(handedness * signedAngle(base, up, facing));
}
