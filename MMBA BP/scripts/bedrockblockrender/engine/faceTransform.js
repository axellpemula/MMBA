import { rotateEulerXYZ } from "./rotation.js";
import { reconstructUp, deriveRoll } from "./billboard.js";
import { isVertical } from "./vectors.js";

const PixelsPerBlock = 16;
const BlockCenter = 0.5;

export function placeFace(face, origin, rotation, scale) {
    let offset = {
        x: face.center[0] / PixelsPerBlock - BlockCenter,
        y: face.center[1] / PixelsPerBlock - BlockCenter,
        z: face.center[2] / PixelsPerBlock - BlockCenter
    };
    let facing = { x: face.facing[0], y: face.facing[1], z: face.facing[2] };
    let roll = face.roll;

    if (rotation !== void 0) {
        const origVertical = isVertical(facing);
        const up = reconstructUp(facing, roll);
        offset = rotateEulerXYZ(offset, rotation);
        facing = rotateEulerXYZ(facing, rotation);
        if (origVertical && !isVertical(facing)) {
            facing = { x: -facing.x, y: -facing.y, z: -facing.z };
        }
        roll = deriveRoll(facing, rotateEulerXYZ(up, rotation));
    }

    const scaledOffset = {
        x: offset.x * scale,
        y: offset.y * scale,
        z: offset.z * scale
    };

    return {
        location: {
            x: origin.x + BlockCenter + scaledOffset.x,
            y: origin.y + BlockCenter + scaledOffset.y,
            z: origin.z + BlockCenter + scaledOffset.z
        },
        centerLocation: {
            x: origin.x + BlockCenter,
            y: origin.y + BlockCenter,
            z: origin.z + BlockCenter
        },
        offset: scaledOffset,
        normal: facing,
        halfWidth: (face.width / PixelsPerBlock) * 0.5 * scale,
        halfHeight: (face.height / PixelsPerBlock) * 0.5 * scale,
        roll
    };
}
