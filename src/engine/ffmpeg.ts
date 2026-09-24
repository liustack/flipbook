import { EnvError } from '../cli/report.ts';
import { findOnPath, run } from './proc.ts';

export interface FfmpegFeatures {
    libx264: boolean;
    amixNormalize: boolean;
    loudnorm: boolean;
    ebur128: boolean;
    freezedetect: boolean;
    tile: boolean;
    gblur: boolean;
}

export interface FfmpegStatus {
    ffmpeg: string | null;
    ffprobe: string | null;
    version: string | null;
    features: FfmpegFeatures | null;
    missing: string[];
}

/** Features the video pipeline cannot run without. */
export const VIDEO_FEATURES: (keyof FfmpegFeatures)[] = [
    'libx264',
    'freezedetect',
    'tile',
    'gblur',
];
/** Every feature doctor requires, audio included. */
export const ALL_FEATURES: (keyof FfmpegFeatures)[] = [
    'libx264',
    'amixNormalize',
    'loudnorm',
    'ebur128',
    'freezedetect',
    'tile',
    'gblur',
];

export const FFMPEG_INSTALL = [
    'macOS: brew install ffmpeg',
    'Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y ffmpeg',
];

function hasFilter(list: string, name: string): boolean {
    return new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(list);
}

/** Locate ffmpeg and ffprobe and probe their features. Never installs anything. */
export async function probeFfmpeg(env: NodeJS.ProcessEnv = process.env): Promise<FfmpegStatus> {
    const ffmpeg = findOnPath('ffmpeg', env);
    const ffprobe = findOnPath('ffprobe', env);
    if (!ffmpeg) {
        return { ffmpeg, ffprobe, version: null, features: null, missing: ['ffmpeg'] };
    }
    const [version, encoders, filters, amix] = await Promise.all([
        run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 15000 }),
        run(ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 15000 }),
        run(ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 15000 }),
        run(ffmpeg, ['-hide_banner', '-h', 'filter=amix'], { timeoutMs: 15000 }),
    ]);
    const filterList = filters.stdout.toString('utf-8');
    const features: FfmpegFeatures = {
        libx264: /^\s*V\S*\s+libx264\s/m.test(encoders.stdout.toString('utf-8')),
        amixNormalize: /\bnormalize\b/.test(amix.stdout.toString('utf-8')),
        loudnorm: hasFilter(filterList, 'loudnorm'),
        ebur128: hasFilter(filterList, 'ebur128'),
        freezedetect: hasFilter(filterList, 'freezedetect'),
        tile: hasFilter(filterList, 'tile'),
        gblur: hasFilter(filterList, 'gblur'),
    };
    const missing: string[] = [];
    if (!ffprobe) missing.push('ffprobe');
    for (const [name, ok] of Object.entries(features)) {
        if (!ok) missing.push(name);
    }
    const versionLine = version.stdout.toString('utf-8').split('\n')[0] ?? '';
    return {
        ffmpeg,
        ffprobe,
        version: /ffmpeg version (\S+)/.exec(versionLine)?.[1] ?? null,
        features,
        missing,
    };
}

export interface Ffmpeg {
    ffmpeg: string;
    ffprobe: string;
    version: string | null;
}

/** ffmpeg and ffprobe with the video features, or an EnvError (exit 78). */
export async function requireFfmpeg(
    required: (keyof FfmpegFeatures)[] = VIDEO_FEATURES,
    env: NodeJS.ProcessEnv = process.env,
): Promise<Ffmpeg> {
    const status = await probeFfmpeg(env);
    if (!status.ffmpeg || !status.ffprobe) {
        throw new EnvError(
            'ffmpeg-missing',
            `${!status.ffmpeg ? 'ffmpeg' : 'ffprobe'} is not on PATH.`,
            FFMPEG_INSTALL,
            { path: env.PATH ?? '' },
        );
    }
    const lacking = required.filter((name) => !status.features?.[name]);
    if (lacking.length > 0) {
        throw new EnvError(
            'ffmpeg-feature-missing',
            `ffmpeg at ${status.ffmpeg} lacks: ${lacking.join(', ')}.`,
            FFMPEG_INSTALL,
            { ffmpeg: status.ffmpeg, version: status.version, lacking },
        );
    }
    return { ffmpeg: status.ffmpeg, ffprobe: status.ffprobe, version: status.version };
}
