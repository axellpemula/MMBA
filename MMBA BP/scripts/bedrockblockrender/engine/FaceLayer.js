const Opaque = "opaque";
const Blend = "blend";
const White = { red: 1, green: 1, blue: 1 };

export class FaceLayer {
    #resolver;
    #spawner;

    constructor(resolver, spawner) {
        this.#resolver = resolver;
        this.#spawner = spawner;
    }

    draw({ permutation, isWaterlogged }, options) {
        const { dimension, origin, lifetimeSeconds, scale, rotation, tint, onUnresolved, jumpHeight = 0, velocity = null, spin = 0 } = options;
        const { faces, wasResolved } = this.#resolver.resolve(permutation);

        if (!wasResolved && onUnresolved === "skip")
            return { wasResolved: false, facesDrawn: 0 };

        const color = this.#faceColor(tint);
        this.#spawner.startBlock(dimension, origin, lifetimeSeconds, rotation, scale, jumpHeight, velocity, spin);

        const blockMaterial = this.#resolver.isWater(permutation) ? Blend : Opaque;
        let facesDrawn = this.#drawFaces(faces, color, blockMaterial);

        if (isWaterlogged)
            facesDrawn += this.#drawFaces(this.#resolver.waterloggedFaces(), color, Blend);

        return { wasResolved, facesDrawn };
    }

    #drawFaces(faces, color, material) {
        for (const face of faces)
            this.#spawner.spawnFace(face, color, material);
        return faces.length;
    }

    #faceColor(tint) {
        const rgb = tint ?? White;
        return { red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1 };
    }
}
