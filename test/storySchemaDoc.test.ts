import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { validateStory } from '../src/engine/story.ts';
import { validateTimeline } from '../src/engine/timeline.ts';
import { resolveTimeline } from '../src/engine/timelineResolve.ts';
import { repoRoot } from './helpers.ts';

// Every story example in docs/story-schema.md and its Chinese twin checks
// whole: each gets a timeline with a two-bar scene per scene its beats name,
// the text and sfx cues its beats list, and an assets/SOURCES.json entry per
// file its record names.

interface Beat {
    at: string | { scene: string; beat: number };
    text?: string[];
    sound?: string;
}

function examples(file: string): Record<string, unknown>[] {
    const text = fs.readFileSync(path.join(repoRoot, 'docs', file), 'utf-8');
    return [...text.matchAll(/```json\n([\s\S]*?)\n```/g)]
        .map((m) => JSON.parse(m[1]) as Record<string, unknown>)
        .filter((json) => json.version === 2 && Array.isArray(json.beats));
}

function timelineFor(story: Record<string, unknown>) {
    const beats = story.beats as Beat[];
    const scenes: string[] = [];
    const cues: Record<string, unknown>[] = [];
    for (const beat of beats) {
        const scene = typeof beat.at === 'string' ? beat.at : beat.at.scene;
        const offset = typeof beat.at === 'string' ? 0 : beat.at.beat;
        if (!scenes.includes(scene)) scenes.push(scene);
        for (const [i, line] of (beat.text ?? []).entries()) {
            cues.push({
                id: `t${cues.length}`,
                scene,
                beat: offset + 0.5 + i * 0.25,
                kind: 'text',
                text: line,
            });
        }
        if (beat.sound)
            cues.push({ id: beat.sound, scene, beat: offset + 0.25, kind: 'sfx', sfx: 'drop' });
    }
    const { timeline, errors } = validateTimeline({
        version: 1,
        width: 320,
        height: 180,
        fps: 12,
        seed: 1,
        bpm: 120,
        beatsPerBar: 4,
        scenes: scenes.map((id) => ({ id, bars: 2 })),
        cues,
    });
    expect(errors).toEqual([]);
    return resolveTimeline(timeline as NonNullable<typeof timeline>);
}

describe('docs/story-schema examples', () => {
    const en = examples('story-schema.md');
    const zh = examples('story-schema.zh-CN.md');

    it('are the same in both languages', () => {
        expect(en.length).toBeGreaterThanOrEqual(2);
        expect(zh).toEqual(en);
    });

    it('each check whole, record and all', () => {
        for (const story of en) {
            const record = story.record as { materials: Record<string, string> } | undefined;
            const sources = Object.fromEntries(
                Object.keys(record?.materials ?? {}).map((file) => [
                    file.slice('assets/'.length),
                    { source: 'https://example.org', license: 'cc0' },
                ]),
            );
            const { problems } = validateStory(story, timelineFor(story), { sources: { sources } });
            expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
        }
    });
});
