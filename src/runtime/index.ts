// flipbook browser runtime, served at /__flipbook/runtime.js.

export type { Rgb } from './color.ts';
export { hex, mix, rgb, rgba, shade } from './color.ts';
export type { CompositionOptions, FlipbookProtocol } from './core/composition.ts';
export { composition, decodeImages, loadFonts } from './core/composition.ts';
export type { Easing } from './core/ease.ts';
export {
    clamp,
    ease,
    lerp,
    onFrames,
    onTwos,
    progress,
    remap,
    smoothstep,
} from './core/ease.ts';
export type { StaticLayer } from './core/layers.ts';
export {
    CONTENT_ATTR,
    isContentLayerOn,
    LAYER_ATTR,
    setContentLayer,
    setupCanvas,
    staticLayer,
} from './core/layers.ts';
export { fbm2, noise1, noise2 } from './core/noise.ts';
export type { Rng } from './core/random.ts';
export { hash32, rand, rng } from './core/random.ts';
export type { ResolvedCue, ResolvedScene, ResolvedTimeline, SceneState } from './core/timeline.ts';
export {
    cue,
    cueProgress,
    isRendering,
    sceneAt,
    sceneProgress,
    timeline,
    transitionOut,
} from './core/timeline.ts';
export type {
    Box,
    CrossHatchOptions,
    Field,
    HalftoneOptions,
    HatchOptions,
    PencilOptions,
    Point,
    StippleOptions,
    TornOptions,
    TornPaperOptions,
} from './materials.ts';
export {
    arcPoints,
    boxPoints,
    crossHatch,
    ellipsePoints,
    halftone,
    hatch,
    hatchPaths,
    pencil,
    resample,
    stipple,
    tornPaper,
    tornPath,
} from './materials.ts';
export type { GrainOptions, GridOptions, PaperOptions } from './paper.ts';
export { drawGrain, drawPaper, grainLayer, PAPER, paperLayer } from './paper.ts';
export type {
    AssembleOptions,
    Assembly,
    GlyphMaskOptions,
    GridSlotOptions,
    Mask,
    PaceOptions,
    PackOptions,
    Piece,
    PieceDrawer,
    Placement,
    ShadowOptions,
    Slot,
    SlotOrder,
} from './templates/assemble.ts';
export {
    assemble,
    distanceField,
    glyphMask,
    gridSlots,
    markTimes,
    orderSlots,
    paceBeats,
    paceTimes,
    packSlots,
    shapeMask,
} from './templates/assemble.ts';
export { moveCamera } from './templates/camera.ts';
export type {
    PageDrawer,
    PageTurn,
    PageTurnOptions,
    TurningPage,
} from './templates/flipbook.ts';
export { pageTurn } from './templates/flipbook.ts';
export type {
    LensMontage,
    LensOptions,
    LensTicks,
    PlateDrawer,
    PlateInfo,
} from './templates/lens.ts';
export { lens } from './templates/lens.ts';
export type { AccelerateOptions, BeatTimesOptions } from './templates/timing.ts';
export { accelerate, beatTimes } from './templates/timing.ts';
export type {
    PathTextOptions,
    PlacedWord,
    TextBox,
    TextEntry,
    TextLayout,
    TypesetOptions,
    WriteOptions,
} from './text.ts';
export {
    fillText,
    graphemes,
    handText,
    registerText,
    textOnPath,
    typeset,
    wordReveal,
    words,
    writeText,
} from './text.ts';

/** Font families served from /__flipbook/fonts/. */
export const FONTS = {
    serif: 'Noto Serif SC',
    hand: 'LXGW WenKai',
} as const;
