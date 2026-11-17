import { FaceTable } from "./FaceTable.js";
import { CubeFaceLibrary } from "./CubeFaceLibrary.js";
import { BlockModelKeyResolver } from "./BlockModelKeyResolver.js";

class BlockModelResolver {
    #waterBlockIds = new Set(["minecraft:water", "minecraft:flowing_water"]);
    #waterloggedWaterState = "minecraft:water[0|0]";

    constructor({ keyResolver, faceReader, unknownFaces }) {
        this.keyResolver = keyResolver;
        this.faceReader = faceReader;
        this.unknownFaces = unknownFaces;
        this.resolvedByPermutation = new WeakMap();
        this.waterloggedFacesCache = void 0;
    }

    resolve(permutation) {
        const cached = this.resolvedByPermutation.get(permutation);
        if (cached !== void 0)
            return cached;

        const resolved = this.lookupFaces(permutation);
        this.resolvedByPermutation.set(permutation, resolved);
        return resolved;
    }

    lookupFaces(permutation) {
        const blockId = permutation.type.id;
        const states = permutation.getAllStates();
        const faceReferences = this.keyResolver.lookupFaceRefs(blockId, states);
        if (faceReferences === void 0)
            return { faces: this.unknownFaces, wasResolved: false };
        return { faces: faceReferences.map(this.faceReader), wasResolved: true };
    }

    waterloggedFaces() {
        if (this.waterloggedFacesCache === void 0) {
            const faceRefs = this.keyResolver.faceRefsForKey(this.#waterloggedWaterState) ?? [];
            this.waterloggedFacesCache = faceRefs.map(this.faceReader);
        }
        return this.waterloggedFacesCache;
    }

    isWater(permutation) {
        return this.#waterBlockIds.has(permutation.type.id);
    }
}

export const blockModelResolver = new BlockModelResolver({
    keyResolver: new BlockModelKeyResolver(),
    faceReader: FaceTable.faceAt,
    unknownFaces: CubeFaceLibrary.createPlainUnknownCubeFaces()
});
