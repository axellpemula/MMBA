import { MolangVariableMap } from "@minecraft/server";
import { placeFace } from "./faceTransform.js";

export class FaceParticleSpawner {
    #molang;
    #normal = { x: 0, y: 0, z: 0 };
    #size = { x: 0, y: 0, z: 0 };
    #uv = { x: 0, y: 0, z: 0 };
    #uvSize = { x: 0, y: 0, z: 0 };

    #dimension;
    #origin;
    #rotation;
    #scale = 1;
    #color;
    #particlePrefix = "bedrockblockrender:block_face_";
    #isShard = false;

    constructor({ molang } = {}) {
        this.#molang = molang ?? null;
    }

    #getMolang() {
        if (!this.#molang) {
            this.#molang = new MolangVariableMap();
        }
        return this.#molang;
    }

    startBlock(dimension, origin, lifetimeSeconds, rotation, scale, jumpHeight = 0, velocity = null, spin = 0) {
        this.#dimension = dimension;
        this.#origin = origin;
        this.#rotation = rotation;
        this.#scale = scale;
        this.#color = void 0;
        const molang = this.#getMolang();
        molang.setFloat("lifetime", lifetimeSeconds);
        if (velocity) {
            this.#isShard = true;
            this.#particlePrefix = "bedrockblockrender:block_shard_";
            molang.setVector3("vel", velocity);
            molang.setFloat("spin", spin);
        } else {
            this.#isShard = false;
            this.#particlePrefix = "bedrockblockrender:block_face_";
            molang.setFloat("jump_height", jumpHeight);
        }
    }

    spawnFace(face, color, material) {
        const placed = placeFace(face, this.#origin, this.#rotation, this.#scale);
        this.#setColor(color);
        this.#setGeometry(placed);
        this.#setUv(face);
        const spawnLoc = this.#isShard ? placed.centerLocation : placed.location;
        if (this.#isShard) {
            this.#getMolang().setVector3("offset", placed.offset);
        }
        try {
            this.#dimension.spawnParticle(`${this.#particlePrefix}${material}`, spawnLoc, this.#getMolang());
        } catch {

        }
    }

    #setColor(color) {
        if (color === this.#color)
            return;
        this.#getMolang().setColorRGBA("face_color", color);
        this.#color = color;
    }

    #setGeometry(placed) {
        this.#normal.x = placed.normal.x;
        this.#normal.y = placed.normal.y;
        this.#normal.z = placed.normal.z;

        this.#size.x = placed.halfWidth;
        this.#size.y = placed.halfHeight;
        this.#size.z = placed.roll;

        this.#getMolang().setVector3("normal", this.#normal);
        this.#getMolang().setVector3("size", this.#size);
    }

    #setUv(face) {
        this.#uv.x = face.uv.x;
        this.#uv.y = face.uv.y;
        this.#uvSize.x = face.uv.w;
        this.#uvSize.y = face.uv.h;
        this.#getMolang().setVector3("uv", this.#uv);
        this.#getMolang().setVector3("uv_size", this.#uvSize);
    }
}
