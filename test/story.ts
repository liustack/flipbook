import * as fs from 'fs';
import * as path from 'path';

// A plain story for compositions that are not about the story: three beats
// (opening, turn, resolution) at the start, a third and two thirds of the
// film, each listing the text cues that fall inside it. Tests of the story
// checks themselves write their own story.json.

interface Scene {
    id: string;
    bars: number;
}
interface Cue {
    scene: string;
    beat: number;
    kind: string;
    text?: string;
}
interface Timeline {
    beatsPerBar: number;
    scenes: Scene[];
    cues?: Cue[];
}

/** The scene and the beat inside it where absolute beat `abs` falls. */
function place(timeline: Timeline, abs: number): { scene: string; beat: number } {
    let start = 0;
    for (const scene of timeline.scenes) {
        const beats = scene.bars * timeline.beatsPerBar;
        if (abs < start + beats) return { scene: scene.id, beat: abs - start };
        start += beats;
    }
    const last = timeline.scenes[timeline.scenes.length - 1];
    return { scene: last.id, beat: 0 };
}

export function storyFor(timeline: Timeline): Record<string, unknown> {
    const starts: Record<string, number> = {};
    let start = 0;
    for (const scene of timeline.scenes) {
        starts[scene.id] = start;
        start += scene.bars * timeline.beatsPerBar;
    }
    const total = start;
    // On quarter beats, so the file reads cleanly.
    const quarter = (x: number) => Math.round(x * 4) / 4;
    const at = [0, quarter(total / 3), quarter((2 * total) / 3)];
    const roles = ['opening', 'turn', 'resolution'];
    const beats = at.map((abs, i) => {
        const end = i + 1 < at.length ? at[i + 1] : total;
        const text = (timeline.cues ?? [])
            .filter((cue) => cue.kind === 'text')
            .map((cue) => ({ abs: starts[cue.scene] + cue.beat, text: cue.text ?? '' }))
            .filter((cue) => cue.abs >= abs && cue.abs < end)
            .sort((a, b) => a.abs - b.abs)
            .map((cue) => cue.text);
        const where = place(timeline, abs);
        return {
            id: `b${i + 1}`,
            role: roles[i],
            at: where.beat === 0 ? where.scene : where,
            change: { from: `state ${i + 1}`, to: `state ${i + 2}` },
            ...(text.length > 0 ? { text } : {}),
        };
    });
    return {
        version: 1,
        idea: 'A test composition',
        leave: 'Nothing: it only exercises the engine',
        subject: 'the picture',
        device: { what: 'none', why: 'a fixture, not a film' },
        beats,
    };
}

/** Write story.json for the timeline.json already in `dir`. */
export function writeStory(dir: string): void {
    const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, 'timeline.json'), 'utf-8'),
    ) as Timeline;
    fs.writeFileSync(
        path.join(dir, 'story.json'),
        `${JSON.stringify(storyFor(parsed), null, 4)}\n`,
    );
}

// `node test/story.ts <dir>...` writes a story.json next to each timeline.json.
if (import.meta.url === `file://${process.argv[1]}`) {
    for (const dir of process.argv.slice(2)) {
        writeStory(dir);
        console.log(path.join(dir, 'story.json'));
    }
}
