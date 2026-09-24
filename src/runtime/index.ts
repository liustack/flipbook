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
export type { GrainOptions, GridOptions, PaperOptions } from './paper.ts';
export { drawGrain, drawPaper, grainLayer, PAPER, paperLayer } from './paper.ts';
export type { TextBox, TextEntry } from './text.ts';
export { fillText, registerText } from './text.ts';

/** Font families served from /__flipbook/fonts/. */
export const FONTS = {
    serif: 'Noto Serif SC',
    hand: 'LXGW WenKai',
} as const;
