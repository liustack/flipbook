// The subject of a photo, found by the Vision framework that ships with macOS
// 14 and later. flipbook brings no model of its own: it asks the system,
// through JavaScript for Automation (osascript), so nothing is compiled and no
// binary ships in the package. Only cutout uses it, ahead of render: the cut
// PNGs go into the composition, and render and check never call Vision.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnvError } from '../cli/report.ts';
import { run, tail } from './proc.ts';

/** The first Darwin kernel of macOS 14, where VNGenerateForegroundInstanceMaskRequest came in. */
const FIRST_DARWIN = 23;

/** Why this machine cannot ask Vision, or null when it can. */
export function visionUnsupported(
    platform: NodeJS.Platform = process.platform,
    release: string = os.release(),
): string | null {
    if (platform !== 'darwin') {
        return `Cutting out a photo's subject uses the Vision framework of macOS 14 or newer, and this is ${platform}.`;
    }
    const darwin = Number.parseInt(release, 10);
    if (!Number.isFinite(darwin) || darwin < FIRST_DARWIN) {
        return `Cutting out a photo's subject uses the Vision framework of macOS 14 or newer, and this Mac runs an older macOS (Darwin ${release}).`;
    }
    return null;
}

export const VISION_FIX = [
    'On a Mac with macOS 14 or newer, run the same cutout there and keep the PNGs it writes.',
    'Elsewhere: a photo on a plain light ground cuts without --subject. Otherwise use the photo whole as a framed sticker with cutout: none.',
];

/**
 * The JXA script: one mask per subject Vision finds, at the photo's own size,
 * white where the subject is. It reads the photo from its path (reading it
 * another way changes the masks) and reports the macOS version and the
 * request's revision, which go into the cutouts' sources.
 */
const SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
ObjC.import('CoreImage');
ObjC.import('CoreGraphics');
function run(argv) {
    const input = argv[0];
    const outdir = argv[1];
    const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(input), $({}));
    const request = $.VNGenerateForegroundInstanceMaskRequest.alloc.init;
    const info = {
        os: ObjC.unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString),
        revision: Number(request.revision),
        masks: [],
    };
    if (!handler.performRequestsError($([request]), null)) {
        info.error = 'Vision could not read ' + input;
        return JSON.stringify(info);
    }
    if (request.results.count === 0) return JSON.stringify(info);
    const observation = request.results.objectAtIndex(0);
    const all = observation.allInstances;
    const n = Number(all.count);
    const context = $.CIContext.context;
    let id = all.firstIndex;
    for (let k = 0; k < n; k++) {
        const one = $.NSIndexSet.indexSetWithIndex(id);
        const buffer = observation.generateScaledMaskForImageForInstancesFromRequestHandlerError(one, handler, null);
        const file = outdir + '/mask-' + String(k + 1).padStart(2, '0') + '.png';
        const ok = context.writePNGRepresentationOfImageToURLFormatColorSpaceOptionsError(
            $.CIImage.imageWithCVPixelBuffer(buffer),
            $.NSURL.fileURLWithPath(file),
            $.kCIFormatRGBA8,
            $.CGColorSpaceCreateDeviceRGB(),
            $({}),
            null,
        );
        if (!ok) {
            info.error = 'Vision could not write ' + file;
            return JSON.stringify(info);
        }
        info.masks.push(file);
        id = all.indexGreaterThanIndex(id);
    }
    return JSON.stringify(info);
}
`;

export interface VisionMasks {
    /** macOS as the system names it, such as "Version 15.3 (Build 24D60)". */
    os: string;
    revision: number;
    /** One PNG per subject, the photo's size, white where the subject is. */
    masks: string[];
}

/** Ask Vision for the subjects of `image`, writing their masks into `outDir`. */
export async function visionMasks(
    image: string,
    outDir: string,
    platform: NodeJS.Platform = process.platform,
    release: string = os.release(),
): Promise<VisionMasks> {
    const unsupported = visionUnsupported(platform, release);
    if (unsupported) throw new EnvError('vision-unavailable', unsupported, VISION_FIX);
    fs.mkdirSync(outDir, { recursive: true });
    let result: Awaited<ReturnType<typeof run>>;
    try {
        result = await run(
            'osascript',
            ['-l', 'JavaScript', '-e', SCRIPT, path.resolve(image), path.resolve(outDir)],
            { timeoutMs: 120_000 },
        );
    } catch (error) {
        // osascript missing or not allowed to start: this machine cannot ask Vision.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EACCES') {
            throw new EnvError(
                'vision-unavailable',
                `osascript could not start (${code}), so Vision cannot be asked here.`,
                VISION_FIX,
            );
        }
        throw error;
    }
    if (result.code !== 0) {
        throw new EnvError(
            'vision-unavailable',
            `osascript could not run Vision: ${tail(result.stderr) || `exit ${result.code}`}`,
            VISION_FIX,
            { stderr: tail(result.stderr, 40) },
        );
    }
    const out = result.stdout.toString().trim();
    let info: VisionMasks & { error?: string };
    try {
        info = JSON.parse(out);
    } catch {
        throw new EnvError(
            'vision-unavailable',
            `Vision gave no answer flipbook understands: ${out.slice(0, 200)}`,
            VISION_FIX,
        );
    }
    if (info.error) throw new EnvError('vision-unavailable', info.error, VISION_FIX);
    return info;
}
