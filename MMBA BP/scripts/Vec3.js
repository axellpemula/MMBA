import * as mc from '@minecraft/server';


export default class Vec3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.xyz = {
            x: x,
            y: y,
            z: z
        };
        this.xyzRound = {
            x: Math.round(x),
            y: Math.round(y),
            z: Math.round(z)
        };
        this.xyzFloor = {
            x: Math.floor(x),
            y: Math.floor(y),
            z: Math.floor(z)
        };
        this.value = (xyz, type) => {
            try {
                return new mc[type](...Object.values(xyz));
            } catch (e) {
                return xyz;
            }
        };
    }
    Vector() {
        let xyz = this.xyz;
        return this.value(xyz, "Vector");
    }
    Position() {
        let xyz = this.xyz;
        return this.value(xyz, "Location");
    }
    PositionRound() {
        let xyz = this.xyzRound;
        return this.value(xyz, "BlockLocation");
    }
    PositionFloor() {
        let xyz = this.xyzFloor;
        return this.value(xyz, "BlockLocation");
    }
    Distance(x, y, z) {
        let p = {
            x: Math.pow(this.x - x, 2),
            y: Math.pow(this.y - y, 2),
            z: Math.pow(this.z - z, 2)
        };
        let distance = Math.sqrt(p.x + p.y + p.z);
        return distance;
    }
}
