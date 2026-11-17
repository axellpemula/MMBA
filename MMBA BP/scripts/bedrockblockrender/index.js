import { blockModelResolver } from "./engine/BlockModelResolver.js";
import { FaceParticleSpawner } from "./engine/FaceParticleSpawner.js";
import { FaceLayer } from "./engine/FaceLayer.js";

export class BlockRenderer {
    #layer;

    constructor() {
        this.#layer = new FaceLayer(blockModelResolver, new FaceParticleSpawner());
    }

    drawBlock(input, options) {
        const { permutation, isWaterlogged = false } = input;
        const {
            dimension,
            location,
            lifetimeSeconds = 5,
            scale = 1,
            rotation,
            tint,
            onUnresolved = "placeholder",
            jumpHeight = 0,
            velocity = null,
            spin = 0
        } = options;

        return this.#layer.draw(
            { permutation, isWaterlogged },
            { dimension, origin: location, lifetimeSeconds, scale, rotation, tint, onUnresolved, jumpHeight, velocity, spin }
        );
    }
}
