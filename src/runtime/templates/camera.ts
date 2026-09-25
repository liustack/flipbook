// A camera move shared by the templates: from framing one rectangle to framing another.
import type { Box } from '../materials.ts';

/**
 * Multiply ctx's transform so the stage shows rectangle `from` at amount 0
 * and rectangle `to` at amount 1, each fitted and centered. In between the
 * camera zooms at a steady rate about one fixed point (or pans, when both
 * rectangles have the same size), so amount 1 back to 0 retraces the move.
 * Pass the stage itself as `from` to push in, or as `to` to pull out.
 */
export function moveCamera(
    ctx: CanvasRenderingContext2D,
    stage: { width: number; height: number },
    from: Box,
    to: Box,
    amount: number,
): void {
    const scaleFor = (r: Box) => Math.min(stage.width / r.width, stage.height / r.height);
    const ka = scaleFor(from);
    const kb = scaleFor(to);
    const ax = from.x + from.width / 2;
    const ay = from.y + from.height / 2;
    const bx = to.x + to.width / 2;
    const by = to.y + to.height / 2;
    const k = ka ** (1 - amount) * kb ** amount;
    let px: number;
    let py: number;
    const spread = 1 / ka - 1 / kb;
    if (Math.abs(spread) < 1e-9) {
        px = ax + (bx - ax) * amount;
        py = ay + (by - ay) * amount;
    } else {
        // The point that holds still on screen while the zoom runs.
        const dx = (bx - ax) / spread;
        const dy = (by - ay) / spread;
        px = ax + dx / ka - dx / k;
        py = ay + dy / ka - dy / k;
    }
    ctx.translate(stage.width / 2, stage.height / 2);
    ctx.scale(k, k);
    ctx.translate(-px, -py);
}
