/*
 * ============================================================
 * DYNAMIC CAMERA ANIMATION (DCA) — Minecraft Bedrock
 * ============================================================
 *
 * ENGLISH
 *
 * OVERVIEW
 * DCA is a camera animation system that converts standard
 * Minecraft Bedrock bone animations into compact data that can
 * be played through the Script API. It allows a camera to follow
 * an animated path relative to an entity, making it suitable for
 * cutscenes, cinematic shots, transitions, and scripted sequences.
 *
 * HOW IT WORKS
 * 1. Create or select a bone animation in the standard Bedrock
 *    animation JSON format.
 * 2. Open the standalone HTML converter, import the JSON, and
 *    select the animation and bone to use.
 * 3. Export the converted DCA animation data.
 * 4. Pass the data to playCameraAnimation(), along with an origin
 *    entity and the players whose cameras should be controlled.
 * 5. The runtime evaluates the keyframes over time, interpolates
 *    position and rotation, and transforms the local camera
 *    coordinates relative to the origin entity.
 * 6. Each tick, the resulting camera position and viewing
 *    direction are applied to the target players.
 * 7. When playback finishes, the runtime waits for clearDelay
 *    and then restores the camera using the configured behavior.
 *
 * API
 * playCameraAnimation(
 *     originEntity,
 *     players,
 *     cameraAnimation,
 *     clearDelay = 5,
 *     clearAnimationTime = 0,
 *     checkCollision = false
 * )
 *
 * - originEntity: Reference entity; its transform is evaluated
 *   during playback.
 * - players: A Player or an array of Player instances.
 * - cameraAnimation: Animation data exported by the converter.
 * - clearDelay: Delay in ticks after playback before cleanup.
 * - clearAnimationTime: If greater than zero, transitions to
 *   third-person camera over this duration in seconds;
 *   otherwise, clears the custom camera.
 * - checkCollision: Optional. When true, the camera path is checked
 *   against solid blocks, the world limits and unloaded chunks
 *   (see COLLISION AND WORLD SAFETY). When false (default), the
 *   behavior is the same as before.
 *
 * stopCameraAnimation(players, options = {})
 *
 * - players: A Player or an array of Player instances.
 * - options.clearCamera: true by default. When false, the animation
 *   is cancelled without touching the current camera.
 * - options.clearAnimationTime: 0 by default. When clearCamera is
 *   true and this is greater than zero, transitions to third-person
 *   camera over this duration in seconds; otherwise clears the camera.
 * - Cancels only the selected players' sessions (also while waiting
 *   for clearDelay) and invalidates any pending automatic restore.
 *   It does nothing for players that have no active animation.
 *
 * SCRIPT EVENTS
 * /scriptevent dca:play <id>[, clearDelay[, clearAnimationTime[, checkCollision]]]
 * /scriptevent dca:stop [clearCamera[, clearAnimationTime]]
 *   dca:stop             -> cancels and clears the camera immediately
 *   dca:stop true, 0.75  -> cancels and restores with a 0.75 s transition
 *   dca:stop false       -> cancels without changing the camera
 *
 * COLLISION AND WORLD SAFETY (checkCollision = true)
 * - The local path is sampled once per animation (about every 0.5
 *   block, including keyframes and Catmull-Rom curves) and cached.
 *   The samples stay relative to the origin entity.
 * - World-dependent checks are done against the current origin
 *   position and yaw: a lookahead analysis lets the runtime skip
 *   per-tick checks while the origin is still and the path is clear;
 *   otherwise each tick sweeps from the last safe camera position to
 *   the wanted one.
 * - A block is an obstacle when it is neither air nor liquid.
 * - If the path is blocked, the camera advances up to the last safe
 *   point and holds there; the animation data is never modified.
 * - Positions are clamped to the dimension height range and to a
 *   conservative horizontal limit; positions in unloaded chunks are
 *   treated as unsafe. Chunk and block queries are cached briefly.
 *
 * DCA v1 DATA FORMAT
 * {
 *     dca: 1,
 *     length: seconds,
 *     pos: Track | null,
 *     rot: Track | null
 * }
 *
 * - pos: Position track, measured in blocks.
 * - rot: Rotation track, measured in degrees [x, y, z].
 * - Track: Ordered keyframes in the format:
 *   [time, preX, preY, preZ, postX, postY, postZ, lerp, easing]
 * - time: Keyframe timestamp in seconds; fractional values allowed.
 * - pre: Value when arriving at the keyframe.
 * - post: Value when leaving the keyframe.
 * - lerp: 0 = linear; 1 = Catmull-Rom. If either endpoint
 *   specifies 1, the segment uses Catmull-Rom interpolation.
 * - easing: 0 or an easing name, such as "step" or "easeInSine".
 *   It applies to the segment starting at that keyframe.
 * - A track containing one keyframe represents a constant value.
 * - Either track may be null if that component is not animated.
 *
 * COORDINATES AND ROTATION
 * Position values are converted from Bedrock bone units to blocks
 * (position units divided by 16). The local position axes map to
 * (left, up, forward), with the forward axis converted from bone
 * Z to world-relative -Z.
 *
 * Rotation values use degrees and are interpolated component by
 * component, without shortest-path angle wrapping. The origin's
 * yaw is used to orient the local animation in the world; its
 * pitch is ignored. Camera roll is not supported.
 *
 * LIMITATIONS
 * - Molang expressions and animation looping are not supported.
 * - Bounce, elastic, back, and Bézier easing functions are not
 *   supported by this format/runtime version.
 * - Only position and rotation are used; scale is ignored.
 * - Camera behavior depends on the available Minecraft Script API.
 *
 * FILES
 * - DCA-HTML.html: Standalone converter for importing, selecting,
 *   converting, and exporting animation data.
 * - cameraAnimation.js: Runtime responsible for interpolation,
 *   coordinate transforms, camera updates, and cleanup.
 *
 * ============================================================
 *
 * PORTUGUÊS
 *
 * VISÃO GERAL
 * O DCA é um sistema de animação de câmera que converte animações
 * de ossos do formato JSON padrão do Minecraft Bedrock em dados
 * compactos reproduzidos pela Script API. Ele permite que a câmera
 * siga uma trajetória animada relativa a uma entidade, sendo útil
 * para cutscenes, cenas cinematográficas, transições e sequências
 * roteirizadas.
 *
 * COMO FUNCIONA
 * 1. Crie ou selecione uma animação de osso no formato JSON padrão
 *    de animações do Bedrock.
 * 2. Abra o conversor HTML independente, importe o JSON e selecione
 *    a animação e o osso desejados.
 * 3. Exporte os dados convertidos para o formato DCA.
 * 4. Passe esses dados para playCameraAnimation(), junto com uma
 *    entidade de origem e os jogadores cujas câmeras serão controladas.
 * 5. O runtime avalia os keyframes ao longo do tempo, interpola
 *    posição e rotação e transforma as coordenadas locais da câmera
 *    em relação à entidade de origem.
 * 6. A cada tick, a posição e a direção resultantes são aplicadas
 *    às câmeras dos jogadores selecionados.
 * 7. Ao terminar a reprodução, o runtime aguarda clearDelay e
 *    restaura a câmera conforme o comportamento configurado.
 *
 * API
 * playCameraAnimation(
 *     originEntity,
 *     players,
 *     cameraAnimation,
 *     clearDelay = 5,
 *     clearAnimationTime = 0,
 *     checkCollision = false
 * )
 *
 * - originEntity: Entidade de referência; sua transformação é
 *   consultada durante a reprodução.
 * - players: Um Player ou um array de instâncias Player.
 * - cameraAnimation: Dados de animação exportados pelo conversor.
 * - clearDelay: Atraso em ticks após a reprodução antes da limpeza.
 * - clearAnimationTime: Se maior que zero, faz a transição para a
 *   câmera em terceira pessoa durante esse tempo, em segundos;
 *   caso contrário, limpa a câmera personalizada.
 * - checkCollision: Opcional. Se true, a trajetória da câmera é
 *   verificada contra blocos sólidos, limites do mundo e chunks
 *   descarregadas (veja COLISÃO E SEGURANÇA DO MUNDO). Se false
 *   (padrão), o comportamento é o mesmo de antes.
 *
 * stopCameraAnimation(players, options = {})
 *
 * - players: Um Player ou um array de instâncias Player.
 * - options.clearCamera: true por padrão. Se false, a animação é
 *   cancelada sem alterar a câmera atual.
 * - options.clearAnimationTime: 0 por padrão. Com clearCamera true
 *   e valor maior que zero, faz a transição para a câmera em
 *   terceira pessoa durante esse tempo, em segundos; caso contrário
 *   limpa a câmera.
 * - Cancela somente as sessões dos jogadores selecionados (inclusive
 *   durante o clearDelay) e invalida qualquer restauração automática
 *   pendente. Não faz nada para jogadores sem animação ativa.
 *
 * SCRIPT EVENTS
 * /scriptevent dca:play <id>[, clearDelay[, clearAnimationTime[, checkCollision]]]
 * /scriptevent dca:stop [clearCamera[, clearAnimationTime]]
 *   dca:stop             -> cancela e limpa a câmera imediatamente
 *   dca:stop true, 0.75  -> cancela e restaura com transição de 0,75 s
 *   dca:stop false       -> cancela sem alterar a câmera
 *
 * COLISÃO E SEGURANÇA DO MUNDO (checkCollision = true)
 * - A trajetória local é amostrada uma vez por animação (cerca de
 *   0,5 bloco, incluindo keyframes e curvas Catmull-Rom) e guardada
 *   em cache. As amostras continuam relativas à entidade de origem.
 * - As verificações dependentes do mundo usam a posição e o yaw
 *   atuais da origem: uma análise antecipada permite dispensar
 *   verificações a cada tick enquanto a origem está parada e o
 *   caminho livre; caso contrário, cada tick percorre o trecho entre
 *   a última posição segura e a desejada.
 * - Um bloco é obstáculo quando não é ar nem líquido.
 * - Se o caminho estiver bloqueado, a câmera avança até o último
 *   ponto seguro e permanece ali; os dados da animação nunca são
 *   modificados.
 * - As posições são limitadas à altura da dimensão e a um limite
 *   horizontal conservador; posições em chunks descarregadas são
 *   tratadas como inseguras. Consultas de chunk e bloco usam cache
 *   de curta duração.
 *
 * FORMATO DE DADOS DCA v1
 * {
 *     dca: 1,
 *     length: segundos,
 *     pos: Track | null,
 *     rot: Track | null
 * }
 *
 * - pos: Trilha de posição, medida em blocos.
 * - rot: Trilha de rotação, medida em graus [x, y, z].
 * - Track: Keyframes ordenados no formato:
 *   [tempo, preX, preY, preZ, postX, postY, postZ, lerp, easing]
 * - tempo: Instante do keyframe em segundos; aceita valores fracionários.
 * - pre: Valor ao chegar ao keyframe.
 * - post: Valor ao sair do keyframe.
 * - lerp: 0 = linear; 1 = Catmull-Rom. Se qualquer uma das
 *   extremidades indicar 1, o segmento usa interpolação Catmull-Rom.
 * - easing: 0 ou o nome de uma curva, como "step" ou "easeInSine".
 *   É aplicado ao segmento que começa naquele keyframe.
 * - Uma trilha com apenas um keyframe representa um valor constante.
 * - Qualquer trilha pode ser null caso aquele componente não seja animado.
 *
 * COORDENADAS E ROTAÇÃO
 * Os valores de posição são convertidos das unidades dos ossos do
 * Bedrock para blocos (valor dividido por 16). Os eixos locais da
 * posição representam (esquerda, cima, frente), com o eixo Z do osso
 * convertido para -Z em relação ao mundo.
 *
 * As rotações usam graus e são interpoladas componente por componente,
 * sem ajustar os ângulos para seguir o caminho mais curto. O yaw da
 * entidade de origem orienta a animação no mundo; o pitch é ignorado.
 * A rotação de roll da câmera não é suportada.
 *
 * LIMITAÇÕES
 * - Expressões Molang e repetição em loop não são suportadas.
 * - As curvas bounce, elastic, back e Bézier não são suportadas
 *   nesta versão do formato/runtime.
 * - Apenas posição e rotação são utilizadas; escala é ignorada.
 * - O comportamento da câmera depende dos métodos disponíveis
 *   na Script API da versão do Minecraft utilizada.
 *
 * ARQUIVOS
 * - DCA-HTML.html: Conversor independente para importar, selecionar,
 *   converter e exportar os dados das animações.
 * - cameraAnimation.js: Runtime responsável pela interpolação,
 *   transformação de coordenadas, atualização da câmera e limpeza.
 *
 * ============================================================
 */


export const dca_example = {
  dca: 1,
  length: 4.4444,
  pos: [
    [0,0,0.625,0,0,0.625,0,1,0],
    [0.5556,0,1.5625,-1.8125,0,1.5625,-1.8125,1,0],
    [1.1111,0,2.8125,-3.5625,0,2.8125,-3.5625,1,0],
    [1.6667,3.3125,2.8125,-1.1875,3.3125,2.8125,-1.1875,1,0],
    [2.2222,2.4375,2.3125,1.625,2.4375,2.3125,1.625,1,0],
    [2.7778,-0.25,1.5625,1.625,-0.25,1.5625,1.625,1,0],
    [3.1481,-1.875,0.375,0.375,-1.875,0.375,0.375,1,0],
    [3.6111,-0.375,0.5625,-1.9375,-0.375,0.5625,-1.9375,1,0],
    [4.4444,0,1.4375,-2.5,0,1.4375,-2.5,1,0]
  ],
  rot: [
    [0,-167.5,0,-180,-167.5,0,-180,1,0],
    [0.5556,-150,0,-180,-150,0,-180,1,0],
    [1.1111,-150,12.5,-180,-150,12.5,-180,1,0],
    [1.6667,-150,77.5,-180,-150,77.5,-180,1,0],
    [2.2222,-150,130,-180,-150,130,-180,1,0],
    [2.7778,-150,200,-180,-150,200,-180,1,0],
    [3.1481,-175,265,-180,-175,265,-180,1,0],
    [3.6111,-185,352.5,-180,-185,352.5,-180,1,0],
    [4.4444,-160,360,-180,-160,360,-180,1,0]
  ]
};

export const dca_example2 = {
  dca: 1,
  length: 4,
  pos: [
    [0,0,0.625,0,0,0.625,0,1,0],
    [0.5,2.875,4.5,-11.125,2.875,4.5,-11.125,1,0],
    [1.25,12.0625,15.0625,1.75,12.0625,15.0625,1.75,1,0],
    [2.25,-17.6875,-22.4375,9.875,-17.6875,-22.4375,9.875,1,0],
    [3,-17.6875,3.125,-52.875,-17.6875,3.125,-52.875,1,0],
    [3.75,7.5625,3.125,-8,7.5625,3.125,-8,1,0],
    [4,3.9375,3.125,-1.375,3.9375,3.125,-1.375,1,0]
  ],
  rot: [
    [0,0,-180,0,0,-180,0,1,0],
    [0.5,20,-195,0,20,-195,0,1,0],
    [1.25,30,-280,0,30,-280,0,1,0],
    [2.25,-50,-390,0,-50,-390,0,1,0],
    [3,2.5,-530,0,2.5,-530,0,1,0],
    [3.75,2.5,-572.5,0,2.5,-572.5,0,1,0],
    [4,37.5,-595,0,37.5,-595,0,1,0]
  ]
};


const DCAs = {
  dca_example,
  dca_example2,
};

import * as mc from "@minecraft/server";
import { isPassableBlock } from "./blocks.js";

const { system } = mc;

const TicksPerSecond = mc.TicksPerSecond;
const DegreesToRadians = Math.PI / 180;
const CameraEase = { easeTime: 0.05, easeType: mc.EasingType.Linear };
const PoleEpsilon = 0.01;

// Collision / world-safety tuning (only used when checkCollision is true).
const SampleSpacing = 0.5; // max distance in blocks between path samples and sweep steps
const MaxLocalSamples = 4096; // hard cap of cached samples per animation
const MinSampleDt = 0.0125; // seconds; never subdivide the path finer than this
const ArrivalEpsilon = 1e-4; // seconds; sample just before a keyframe to catch its "pre" value
const AnalysisWindow = 96; // samples analysed ahead of the current time
const AnalysisTTL = 20; // ticks before a lookahead analysis is considered stale
const ReanalysisInterval = 5; // minimum ticks between two lookahead analyses of a session
const ChunkTTL = 20; // ticks a "chunk loaded" answer is reused
const UnloadedChunkTTL = 5; // ticks an "unloaded" answer is reused (retry sooner)
const BlockTTL = 20; // ticks a block classification is reused
const CacheMaxEntries = 20000; // per-dimension block cache size before it is flushed
const MaxSweepDistance = 64; // larger jumps (e.g. origin teleport) are not swept
const WorldLimitXZ = 30000000; // conservative horizontal limit; the API exposes none
const VerticalEpsilon = 0.001;
const PointState = { Safe: 0, Solid: 1, Unsafe: 2 };

const EaseInCurves = {
  Sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  Quad: (t) => t * t,
  Cubic: (t) => t ** 3,
  Quart: (t) => t ** 4,
  Quint: (t) => t ** 5,
  Expo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  Circ: (t) => 1 - Math.sqrt(1 - t * t),
};

const Easings = Object.fromEntries([
  ["linear", (t) => t],
  ...Object.entries(EaseInCurves).flatMap(([name, easeIn]) => [
    [`easeIn${name}`, easeIn],
    [`easeOut${name}`, (t) => 1 - easeIn(1 - t)],
    [`easeInOut${name}`, (t) => (t < 0.5 ? easeIn(2 * t) / 2 : 1 - easeIn(2 - 2 * t) / 2)],
  ]),
]);

const WarnedEasings = new Set();
const Sessions = new Map();
const PendingRestores = new Map(); // player id -> session whose automatic restore is scheduled
const LocalSamples = new WeakMap(); // animation -> cached local path samples
const WorldCaches = new Map(); // dimension id -> { chunks, blocks, minY, maxY }
let LoopId;

const pre = (keyframe) => keyframe.slice(1, 4);
const post = (keyframe) => keyframe.slice(4, 7);
const mapAxes = (fn) => [fn(0), fn(1), fn(2)];
const lerp3 = (a, b, u) => mapAxes((i) => a[i] + (b[i] - a[i]) * u);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function catmull3(p0, p1, p2, p3, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  return mapAxes(
    (i) =>
      0.5 *
      (2 * p1[i] +
        (-p0[i] + p2[i]) * u +
        (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
        (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3)
  );
}

function applyEasing(name, u) {
  const easing = Easings[name];
  if (easing) return easing(u);
  if (!WarnedEasings.has(name)) {
    WarnedEasings.add(name);
    console.warn(`[DCA] unknown easing "${name}", using linear.`);
  }
  return u;
}

function findSegmentIndex(track, time) {
  let low = 0;
  let high = track.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (track[mid][0] <= time) low = mid;
    else high = mid - 1;
  }
  return low;
}

function sampleTrack(track, time) {
  if (!track) return [0, 0, 0];
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first[0]) return post(first);
  if (time >= last[0]) return post(last);

  const index = findSegmentIndex(track, time);
  const from = track[index];
  const to = track[index + 1];
  const easing = from[8];
  if (easing === "step") return post(from);

  let u = (time - from[0]) / (to[0] - from[0]);
  if (easing) u = applyEasing(easing, u);

  if (from[7] === 1 || to[7] === 1) {
    const before = post(track[index - 1] ?? from);
    const after = pre(track[index + 2] ?? to);
    return catmull3(before, post(from), pre(to), after, u);
  }
  return lerp3(post(from), pre(to), u);
}

function rotatePair(a, b, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [a * cos - b * sin, a * sin + b * cos];
}

function localDirection([rotX, rotY, rotZ]) {
  const [up, forwardAfterX] = rotatePair(0, 1, rotX);
  const [leftAfterY, forward] = rotatePair(0, forwardAfterX, rotY);
  const [left, upAfterZ] = rotatePair(leftAfterY, up, rotZ);
  return [left, upAfterZ, forward];
}

function createLocalToWorld(yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return (left, up, forward) => ({
    x: cos * left - sin * forward,
    y: up,
    z: sin * left + cos * forward,
  });
}


const isFiniteLocation = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const sameSignature = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

function getWorldCache(dimension) {
  const id = dimension.id;
  let cache = WorldCaches.get(id);
  if (cache) return cache;
  cache = { chunks: new Map(), blocks: new Map(), minY: null, maxY: null };
  try {
    const range = dimension.heightRange;
    if (Number.isFinite(range?.min) && Number.isFinite(range?.max)) {
      cache.minY = range.min;
      cache.maxY = range.max;
    }
  } catch (error) {
    console.warn("[DCA] heightRange unavailable:", error);
  }
  WorldCaches.set(id, cache);
  return cache;
}

function clampToWorld(cache, point) {
  if (!isFiniteLocation(point)) return null;
  const limit = WorldLimitXZ - 1;
  const y = cache.minY === null ? point.y : clamp(point.y, cache.minY, cache.maxY - VerticalEpsilon);
  return { x: clamp(point.x, -limit, limit), y, z: clamp(point.z, -limit, limit) };
}

function isChunkLoaded(dimension, cache, point, now) {
  const key = `${Math.floor(point.x / 16)},${Math.floor(point.z / 16)}`;
  const entry = cache.chunks.get(key);
  if (entry && now - entry.tick < (entry.loaded ? ChunkTTL : UnloadedChunkTTL)) return entry.loaded;

  let loaded = true;
  if (typeof dimension.isChunkLoaded === "function") {
    try {
      loaded = dimension.isChunkLoaded(point) === true;
    } catch {
      loaded = false;
    }
  }
  cache.chunks.set(key, { loaded, tick: now });
  return loaded;
}

function classifyPoint(dimension, cache, point, now) {
  if (!isChunkLoaded(dimension, cache, point, now)) return PointState.Unsafe;

  const key = `${Math.floor(point.x)},${Math.floor(point.y)},${Math.floor(point.z)}`;
  const cached = cache.blocks.get(key);
  if (cached && now - cached.tick < BlockTTL) return cached.state;

  let state;
  try {
    const block = dimension.getBlock(point);
    if (!block) return PointState.Unsafe;
    state = isPassableBlock(block) ? PointState.Safe : PointState.Solid;
  } catch {
    return PointState.Unsafe;
  }
  if (cache.blocks.size >= CacheMaxEntries) cache.blocks.clear();
  cache.blocks.set(key, { state, tick: now });
  return state;
}

function upperBound(values, value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function getLocalSamples(anim) {
  const cached = LocalSamples.get(anim);
  if (cached) return cached;

  const { length } = anim;
  const seed = new Set([0, length]);
  if (anim.pos) {
    for (const keyframe of anim.pos) {
      const time = keyframe[0];
      if (time < 0 || time > length) continue;
      seed.add(time);
      if (time - ArrivalEpsilon > 0) seed.add(time - ArrivalEpsilon);
    }
  }

  const localAt = (time) => {
    const [left, up, forward] = sampleTrack(anim.pos, time);
    return [left, up, -forward];
  };

  let times = [...seed].sort((a, b) => a - b);
  let points = times.map(localAt);

  while (times.length < MaxLocalSamples) {
    const nextTimes = [times[0]];
    const nextPoints = [points[0]];
    let added = false;
    for (let i = 1; i < times.length; i++) {
      const dt = times[i] - times[i - 1];
      const a = points[i - 1];
      const b = points[i];
      if (dt > MinSampleDt && nextTimes.length < MaxLocalSamples && Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > SampleSpacing) {
        const mid = times[i - 1] + dt / 2;
        nextTimes.push(mid);
        nextPoints.push(localAt(mid));
        added = true;
      }
      nextTimes.push(times[i]);
      nextPoints.push(points[i]);
    }
    times = nextTimes;
    points = nextPoints;
    if (!added) break;
  }

  const samples = { times, points };
  LocalSamples.set(anim, samples);
  return samples;
}

function analyzeLookahead(session, time, dimension, cache, now, signature) {
  const { times, points } = getLocalSamples(session.anim);
  const [originX, originY, originZ, yawDegrees] = signature;
  const localToWorld = createLocalToWorld(yawDegrees * DegreesToRadians);

  const start = Math.max(0, upperBound(times, time) - 1);
  const end = Math.min(times.length, start + AnalysisWindow);
  const partial = end < times.length;
  let safeUntil = partial ? times[end - 1] : Infinity;

  for (let i = start; i < end; i++) {
    const [left, up, forward] = points[i];
    const offset = localToWorld(left, up, forward);
    const point = clampToWorld(cache, { x: originX + offset.x, y: originY + offset.y, z: originZ + offset.z });
    if (!point || classifyPoint(dimension, cache, point, now) !== PointState.Safe) {
      safeUntil = i > start ? times[i - 1] : -Infinity;
      session.lookaheadBlocked = true;
      break;
    }
    session.lookaheadBlocked = false;
  }

  session.lastAnalysisTick = now;
  session.analysis = { tick: now, signature, safeUntil, partial };
  return session.analysis;
}

function advanceSafely(session, dimension, cache, now, target) {
  let from = session.lastSafe;
  if (from && classifyPoint(dimension, cache, from, now) !== PointState.Safe) {
    session.lastSafe = null;
    from = null;
  }

  if (!from) {
    if (classifyPoint(dimension, cache, target, now) === PointState.Safe) {
      session.onPath = true;
      return target;
    }
    session.onPath = false;
    return null;
  }

  const distance = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
  if (distance > MaxSweepDistance) {
    if (classifyPoint(dimension, cache, target, now) === PointState.Safe) {
      session.onPath = true;
      return target;
    }
    session.onPath = false;
    return from;
  }

  const steps = Math.max(1, Math.ceil(distance / SampleSpacing));
  let lastGood = from;
  for (let k = 1; k <= steps; k++) {
    const point =
      k === steps
        ? target
        : {
            x: from.x + ((target.x - from.x) * k) / steps,
            y: from.y + ((target.y - from.y) * k) / steps,
            z: from.z + ((target.z - from.z) * k) / steps,
          };
    if (classifyPoint(dimension, cache, point, now) !== PointState.Safe) {
      session.onPath = false;
      return lastGood;
    }
    lastGood = point;
  }
  session.onPath = true;
  return target;
}

function originFallback(session, dimension, cache, now) {
  let point;
  try {
    point = session.origin.getHeadLocation();
  } catch {
    point = session.origin.location;
  }
  point = clampToWorld(cache, point);
  return point && classifyPoint(dimension, cache, point, now) === PointState.Safe ? point : null;
}

function resolveCollision(session, time, desired, originX, originY, originZ, yawDegrees) {
  const now = system.currentTick;
  const dimension = session.origin.dimension;
  const cache = getWorldCache(dimension);

  if (session.dimensionId !== dimension.id) {
    session.dimensionId = dimension.id;
    session.lastSafe = null;
    session.onPath = false;
    session.analysis = null;
  }

  const signature = [originX, originY, originZ, yawDegrees];
  const originMoved = !session.lastSignature || !sameSignature(session.lastSignature, signature);
  session.lastSignature = signature;

  const target = clampToWorld(cache, desired);
  if (!target) return session.lastSafe ? { ...session.lastSafe } : null;

  if (!originMoved && session.onPath) {
    let analysis = session.analysis;
    const stale =
      !analysis ||
      !sameSignature(analysis.signature, signature) ||
      now - analysis.tick > AnalysisTTL ||
      (analysis.partial && time > analysis.safeUntil);
    if (stale && now - session.lastAnalysisTick >= ReanalysisInterval) {
      analysis = analyzeLookahead(session, time, dimension, cache, now, signature);
    }
    if (
      analysis &&
      sameSignature(analysis.signature, signature) &&
      now - analysis.tick <= AnalysisTTL &&
      time <= analysis.safeUntil
    ) {
      session.lastSafe = target;
      return { ...target };
    }
  }

  let result = advanceSafely(session, dimension, cache, now, target);
  if (!result) result = originFallback(session, dimension, cache, now);
  session.lastSafe = result;
  return result ? { ...result } : null;
}

function applyPose(session, time) {
  const { origin, anim, player } = session;
  const { x, y, z } = origin.location;
  const yawDegrees = origin.getRotation().y;
  const localToWorld = createLocalToWorld(yawDegrees * DegreesToRadians);

  const [left, up, forward] = sampleTrack(anim.pos, time);
  const offset = localToWorld(left, up, -forward);
  let location = { x: x + offset.x, y: y + offset.y, z: z + offset.z };

  if (session.checkCollision) {
    location = resolveCollision(session, time, location, x, y, z, yawDegrees);
  } else if (!isFiniteLocation(location)) {
    location = null;
  }
  if (!location) return false;

  const [dirLeft, dirUp, rawForward] = localDirection(
    sampleTrack(anim.rot, time).map((degrees) => degrees * DegreesToRadians)
  );
  const dirForward = Math.hypot(dirLeft, rawForward) < PoleEpsilon ? PoleEpsilon : rawForward;
  const length = Math.hypot(dirLeft, dirUp, dirForward);
  const direction = localToWorld(dirLeft / length, dirUp / length, dirForward / length);

  const pitch = -Math.asin(Math.max(-1, Math.min(1, direction.y))) / DegreesToRadians;
  let yaw = Math.atan2(-direction.x, direction.z) / DegreesToRadians;
  if (session.lastYaw !== undefined) yaw += 360 * Math.round((session.lastYaw - yaw) / 360);
  session.lastYaw = yaw;

  player.camera.setCamera("minecraft:free", {
    location,
    rotation: { x: pitch, y: yaw },
    easeOptions: CameraEase,
  });
  return true;
}

function stopLoop() {
  if (LoopId === undefined) return;
  system.clearRun(LoopId);
  LoopId = undefined;
  WorldCaches.clear();
}

function restoreCamera(player, seconds) {
  if (!player.isValid) return;
  if (seconds > 0) {
    player.camera.setDefaultCamera("minecraft:third_person", { easeTime: seconds, easeType: "InOutCirc" });
    system.runTimeout(() => player.camera.clear(), seconds * 20);
  } else {
    player.camera.clear();
  }
}

function finish(id, session) {
  if (Sessions.get(id) !== session) return;
  Sessions.delete(id);
  PendingRestores.set(id, session);
  system.run(() => {
    if (PendingRestores.get(id) !== session) return;
    PendingRestores.delete(id);
    if (!Sessions.has(id)) restoreCamera(session.player, session.clearAnimationTime);
  });
}

function tick() {
  for (const [id, session] of Sessions) {
    try {
      if (!session.player.isValid) {
        Sessions.delete(id);
        continue;
      }
      if (!session.origin.isValid) {
        finish(id, session);
        continue;
      }
      const elapsed = (system.currentTick - session.startTick) / TicksPerSecond;
      const { length } = session.anim;
      if (elapsed < length) {
        applyPose(session, elapsed);
        continue;
      }
      session.doneTick ??= system.currentTick;
      applyPose(session, length);
      if (system.currentTick - session.doneTick >= session.clearDelay) finish(id, session);
    } catch (error) {
      console.warn("[DCA] erro na animação:", error);
      finish(id, session);
    }
  }
  if (Sessions.size === 0) stopLoop();
}

function validateTrack(track, name) {
  if (track === null) return;
  if (!Array.isArray(track) || track.length === 0) throw new TypeError(`DCA: "${name}" invalid.`);
  let previousTime = -Infinity;
  for (const keyframe of track) {
    const isWellFormed =
      Array.isArray(keyframe) &&
      keyframe.length === 9 &&
      keyframe.slice(0, 7).every(Number.isFinite) &&
      (keyframe[7] === 0 || keyframe[7] === 1);
    if (!isWellFormed) throw new TypeError(`DCA: keyframe invalid at "${name}".`);
    if (keyframe[0] < previousTime) throw new TypeError(`DCA: times are messed up at "${name}".`);
    previousTime = keyframe[0];
  }
}

function validateAnimation(animation) {
  if (!animation || animation.dca !== 1 || !Number.isFinite(animation.length) || animation.length < 0)
    throw new TypeError("DCA: cameraAnimation is invalid (expected format: dca:1).");
  animation.pos ??= null;
  animation.rot ??= null;
  validateTrack(animation.pos, "pos");
  validateTrack(animation.rot, "rot");
  if (!animation.pos && !animation.rot) throw new TypeError("DCA: animation without pos and rot");
}

export function playCameraAnimation(originEntity, players, cameraAnimation, clearDelay = 5, clearAnimationTime = 0, checkCollision = false) {
  validateAnimation(cameraAnimation);
  if (!originEntity?.isValid) throw new Error("DCA: originEntity invalid.");
  const delay = Math.max(0, Math.floor(Number(clearDelay) || 0));
  const seconds = Math.max(0, Number(clearAnimationTime) || 0);
  const collision = checkCollision === true;
  if (collision) getLocalSamples(cameraAnimation);

  for (const player of Array.isArray(players) ? players : [players]) {
    let session;
    try {
      if (!player?.isValid || !player.camera) throw new Error("invalid player");
      session = {
        player,
        origin: originEntity,
        anim: cameraAnimation,
        startTick: system.currentTick,
        doneTick: null,
        lastYaw: undefined,
        clearDelay: delay,
        clearAnimationTime: seconds,
        checkCollision: collision,
        lastSafe: null,
        onPath: false,
        lastSignature: null,
        analysis: null,
        lastAnalysisTick: -Infinity,
        lookaheadBlocked: false,
        dimensionId: undefined,
      };
      Sessions.set(player.id, session);
      if (!applyPose(session, 0)) throw new Error("no safe camera position at the start");
      LoopId ??= system.runInterval(tick, 1);
    } catch (error) {
      if (session && Sessions.get(player.id) === session) Sessions.delete(player.id);
      console.warn("[DCA] failed to start for player:", error);
    }
  }
}

export function stopCameraAnimation(players, options = {}) {
  const { clearCamera = true, clearAnimationTime = 0 } = options ?? {};
  const shouldClear = typeof clearCamera === "boolean" ? clearCamera : true;
  const seconds = Math.max(0, Number(clearAnimationTime) || 0);
  let stopped = 0;

  for (const player of Array.isArray(players) ? players : [players]) {
    try {
      const id = player?.id;
      if (id === undefined) continue;
      const hadSession = Sessions.delete(id);
      const hadPending = PendingRestores.delete(id);
      if (!hadSession && !hadPending) continue;
      stopped++;
      if (shouldClear) restoreCamera(player, seconds);
    } catch (error) {
      console.warn("[DCA] failed to stop for player:", error);
    }
  }

  if (Sessions.size === 0) stopLoop();
  return stopped;
}

function splitDcaArgs(message) {
  let text = message.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  if (!text) return [];

  const unwrap = (value) => {
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
    let escaped = false;
    for (let i = 1; i < value.length - 1; i++) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (value[i] === "\\") {
        escaped = true;
        continue;
      }
      if (value[i] === quote) return value;
    }
    return value.slice(1, -1).trim();
  };

  text = unwrap(text);
  const args = [];
  let value = "";
  let quote = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else value += char;
    } else if ((char === '"' || char === "'") && !value.trim()) {
      quote = char;
    } else if (char === ",") {
      args.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }

  if (quote) return null;
  args.push(value.trim());
  return args;
}

const parseNumberArg = (text, fallback) => {
  if (text === undefined || !text.trim()) return fallback;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const parseBooleanArg = (text, fallback) => {
  if (text === undefined || !text.trim()) return fallback;
  const value = text.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

function parseDcaParams(message) {
  const args = splitDcaArgs(message);
  if (!args || args.length === 0) return null;

  const [dcaId, delay, time, collision] = args;
  if (args.length > 4 || !dcaId || !Object.prototype.hasOwnProperty.call(DCAs, dcaId) || DCAs[dcaId] == null) return null;

  const clearDelay = parseNumberArg(delay, 0);
  const clearAnimationTime = parseNumberArg(time, 0.75);
  const checkCollision = parseBooleanArg(collision, false);
  if (clearDelay === null || clearAnimationTime === null || checkCollision === null) return null;
  return { dcaId, cameraAnimation: DCAs[dcaId], clearDelay, clearAnimationTime, checkCollision };
}

function parseDcaStopParams(message) {
  const args = splitDcaArgs(message);
  if (!args || args.length > 2) return null;

  const [clear, time] = args;
  const clearCamera = parseBooleanArg(clear, true);
  const clearAnimationTime = parseNumberArg(time, 0);
  if (clearCamera === null || clearAnimationTime === null) return null;
  return { clearCamera, clearAnimationTime };
}

system.afterEvents.scriptEventReceive.subscribe(({ sourceEntity: player, id, message }) => {
  const eventId = id.toLowerCase();
  if ((eventId !== "dca:play" && eventId !== "dca:stop") || !player) return;

  if (eventId === "dca:stop") {
    const stopParams = parseDcaStopParams(message);
    if (!stopParams) return;

    stopCameraAnimation(player, stopParams);
    return;
  }

  const params = parseDcaParams(message);
  if (!params) return;

  playCameraAnimation(player, player, params.cameraAnimation, params.clearDelay, params.clearAnimationTime, params.checkCollision);
}, { namespaces: ["dca", "DCA", "Dca"] });