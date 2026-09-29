// flipbook puppet: turn cut parts into a puppet rig ahead of render. Reads
// assets/puppets/<name>/puppet.json (which cut image is which part, where
// each joint is), finds the round joint tabs, shaves the printed outline off
// every part (the runtime inks one outline per group instead), and writes the
// parts, a rig.json for loadRig() and a sheet with every joint marked and the
// puppet posed standing, striding and waving, next to its reference picture.
import * as fs from 'fs';
import * as path from 'path';
import { cutEntry, parseSources, sourceProblem, updateSources } from '../engine/assetSources.ts';
import { Checker, describe, ID_PATTERN, isNum, isObject, type Json } from '../engine/schema.ts';
import { compositionDir, openSession, type Session } from '../engine/session.ts';
import { openToolPage } from '../engine/toolPage.ts';
import { Workspace } from '../engine/workspace.ts';
import { BIPED } from '../runtime/puppet.ts';
import { finding, progress, type Report, ReportBuilder } from './report.ts';

export interface PuppetOptions {
    dir: string;
    /** The puppet's folder under assets/puppets/. */
    name: string;
    env?: NodeJS.ProcessEnv;
    session?: Session;
}

const SOURCES = path.join('assets', 'SOURCES.json');
const SIDES = ['top', 'bottom', 'left', 'right'];
const IMAGE = /\.(png|jpe?g|webp)$/i;

type Joint = string | [number, number];
interface PartSpec {
    image: string;
    pivot: Joint;
    sockets?: Record<string, Joint>;
    angle?: number;
    fit?: [number, number];
}
interface PuppetSpec {
    version: 1;
    reference?: string;
    outline?: number;
    parts: Record<string, PartSpec>;
    bones: 'biped' | Record<string, unknown>[];
    map?: Record<string, string>;
}

interface PageResult {
    missing: { part: string; joint: string; side: string }[];
    error?: string;
    /** Parts the given outline would shave away entirely. */
    emptied?: string[];
    outline: number;
    parts: Record<
        string,
        {
            png: string;
            width: number;
            height: number;
            pivot: [number, number];
            sockets: Record<string, [number, number]>;
            /** Pixels shaved off this part: the outline, or 0 when it shows none. */
            shaved: number;
        }
    >;
    bones: unknown[];
    sheet: string | null;
}

function validate(
    input: Json,
    dir: string,
    sources: Record<string, unknown>,
): { errors: { path: string; message: string }[]; spec?: PuppetSpec } {
    const c = new Checker('puppet v1');
    if (!isObject(input)) {
        c.fail('$', 'must be a JSON object');
        return { errors: c.errors };
    }
    c.keys(input, '$', ['$schema', 'version', 'reference', 'outline', 'parts', 'bones', 'map']);
    if (input.version !== 1) c.fail('$.version', `must be 1 (got ${describe(input.version)})`);
    const asset = (value: Json, at: string, needsSource: boolean) => {
        if (!c.localFile(value, at)) return;
        const rel = (value as string).split(/[\\/]/).join('/');
        if (!rel.startsWith('assets/')) return c.fail(at, 'must be a file under assets/');
        const full = path.join(dir, rel);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return c.fail(at, 'names no file');
        if (!IMAGE.test(rel)) return c.fail(at, 'must be a .png, .jpg or .webp image');
        if (!needsSource) return;
        const problem = sourceProblem(sources, rel.slice('assets/'.length));
        if (problem) c.fail(at, `${rel} ${problem} in assets/SOURCES.json`);
    };
    if (input.reference !== undefined) asset(input.reference, '$.reference', false);
    if (input.outline !== undefined) c.int(input.outline, '$.outline', 0, 40);
    const joint = (value: Json, at: string) => {
        if (typeof value === 'string') {
            if (!SIDES.includes(value)) {
                c.fail(
                    at,
                    `must be "top", "bottom", "left", "right" or [x, y] (got ${describe(value)})`,
                );
            }
        } else if (!Array.isArray(value) || value.length !== 2 || !value.every(isNum)) {
            c.fail(
                at,
                `must be "top", "bottom", "left", "right" or [x, y] (got ${describe(value)})`,
            );
        }
    };
    if (!isObject(input.parts) || Object.keys(input.parts).length === 0) {
        c.fail('$.parts', `must be an object of parts (got ${describe(input.parts)})`);
    } else {
        for (const [name, p] of Object.entries(input.parts)) {
            const at = ID_PATTERN.test(name)
                ? `$.parts.${name}`
                : `$.parts[${JSON.stringify(name)}]`;
            if (!ID_PATTERN.test(name)) c.fail(at, 'must be named with letters, digits, - or _');
            if (!isObject(p)) {
                c.fail(at, 'must be an object with image and pivot');
                continue;
            }
            c.keys(p, at, ['image', 'pivot', 'sockets', 'angle', 'fit']);
            asset(p.image, `${at}.image`, true);
            joint(p.pivot, `${at}.pivot`);
            if (p.sockets !== undefined) {
                if (!isObject(p.sockets)) c.fail(`${at}.sockets`, 'must be an object of joints');
                else for (const [s, v] of Object.entries(p.sockets)) joint(v, `${at}.sockets.${s}`);
            }
            if (p.angle !== undefined) c.num(p.angle, `${at}.angle`, -360, 360);
            if (
                p.fit !== undefined &&
                (!Array.isArray(p.fit) ||
                    p.fit.length !== 2 ||
                    !p.fit.every((f: Json) => isNum(f) && f > 0 && f <= 4))
            ) {
                c.fail(
                    `${at}.fit`,
                    `must be [sx, sy], each above 0 and at most 4 (got ${describe(p.fit)})`,
                );
            }
        }
    }
    if (input.bones !== 'biped' && !Array.isArray(input.bones)) {
        c.fail('$.bones', `must be "biped" or an array of bones (got ${describe(input.bones)})`);
    }
    if (Array.isArray(input.bones)) bonesProblems(c, input.bones, input.parts);
    if (input.map !== undefined) {
        if (input.bones !== 'biped')
            c.fail('$.map', 'maps biped bones to parts: use it with "bones": "biped"');
        else if (!isObject(input.map)) c.fail('$.map', 'must be an object of bone to part');
        else
            for (const [bone, part] of Object.entries(input.map)) {
                if (!(BIPED as readonly string[]).includes(bone)) {
                    c.fail(`$.map.${bone}`, `is not a biped bone (bones: ${BIPED.join(', ')})`);
                } else if (
                    typeof part !== 'string' ||
                    !isObject(input.parts) ||
                    !(part in input.parts)
                ) {
                    c.fail(`$.map.${bone}`, `names no part (got ${describe(part)})`);
                }
            }
    }
    return c.errors.length > 0
        ? { errors: c.errors }
        : { errors: [], spec: input as unknown as PuppetSpec };
}

/**
 * Each bone of a hand-written skeleton: its fields, a part that exists, a
 * parent that exists and whose part has the socket, one root, no loops.
 */
function bonesProblems(c: Checker, bones: Json[], parts: Json): void {
    const partSpec = (name: string) =>
        isObject(parts) && isObject(parts[name]) ? parts[name] : null;
    const names = new Map<string, number>();
    const ok: { name: string; parent?: string; at: string }[] = [];
    bones.forEach((b, i) => {
        const at = `$.bones[${i}]`;
        if (!isObject(b)) {
            c.fail(at, 'must be a bone: { "name", "part", "z", "parent", "socket", "group" }');
            return;
        }
        c.keys(b, at, ['name', 'part', 'z', 'parent', 'socket', 'group']);
        if (!c.str(b.name, `${at}.name`, ID_PATTERN, 'a name of letters, digits, - or _')) return;
        if (names.has(b.name)) {
            c.fail(
                `${at}.name`,
                `repeats the bone name "${b.name}" of $.bones[${names.get(b.name)}]`,
            );
            return;
        }
        names.set(b.name, i);
        if (typeof b.part !== 'string' || !partSpec(b.part)) {
            c.fail(`${at}.part`, `names no part in $.parts (got ${describe(b.part)})`);
        }
        if (!isNum(b.z)) c.fail(`${at}.z`, `must be a number (got ${describe(b.z)})`);
        if (b.group !== undefined) c.str(b.group, `${at}.group`);
        if (b.parent === undefined) {
            if (b.socket !== undefined) c.fail(`${at}.socket`, 'needs a parent to hang from');
            ok.push({ name: b.name, at });
            return;
        }
        if (typeof b.parent !== 'string') {
            c.fail(`${at}.parent`, `must be a bone name (got ${describe(b.parent)})`);
            return;
        }
        if (typeof b.socket !== 'string') {
            c.fail(
                `${at}.socket`,
                `must name a socket on the parent's part (got ${describe(b.socket)})`,
            );
            return;
        }
        ok.push({ name: b.name, parent: b.parent, at });
    });
    const byName = new Map(
        bones.flatMap((b) => (isObject(b) && typeof b.name === 'string' ? [[b.name, b]] : [])),
    );
    for (const b of ok) {
        if (b.parent === undefined) continue;
        const parent = byName.get(b.parent);
        if (!parent) {
            c.fail(`${b.at}.parent`, `names no bone (got "${b.parent}")`);
            continue;
        }
        const bone = byName.get(b.name) as Record<string, Json>;
        const spec = typeof parent.part === 'string' ? partSpec(parent.part) : null;
        const sockets = spec && isObject(spec.sockets) ? spec.sockets : {};
        if (spec && !(String(bone.socket) in sockets)) {
            c.fail(
                `${b.at}.socket`,
                `names no socket of part "${parent.part}" (sockets: ${Object.keys(sockets).join(', ') || 'none'})`,
            );
        }
    }
    const roots = ok.filter((b) => b.parent === undefined);
    if (ok.length === bones.length && roots.length !== 1) {
        c.fail(
            '$.bones',
            `must have exactly one bone without a parent, the root (found ${roots.length})`,
        );
    }
    // Every bone must reach the root through its parents.
    for (const b of ok) {
        const seen = new Set<string>();
        let at: string | undefined = b.name;
        while (at !== undefined && !seen.has(at)) {
            seen.add(at);
            const next = byName.get(at);
            at = next && typeof next.parent === 'string' ? next.parent : undefined;
        }
        if (at !== undefined) {
            c.fail(`${b.at}.parent`, 'goes round in a loop instead of reaching the root');
            break;
        }
    }
}

export async function runPuppet(options: PuppetOptions): Promise<Report> {
    const dir = compositionDir(options.dir);
    const rb = new ReportBuilder('puppet', dir);
    const ws = Workspace.open(dir);
    const name = options.name;
    const folder = path.join('assets', 'puppets', name);
    const specFile = path.join(folder, 'puppet.json').split(path.sep).join('/');
    const invalid = (message: string, at = '$') => {
        rb.add(finding('puppet-invalid', message, { element: specFile, detail: { path: at } }));
        return rb.finish();
    };
    if (!ID_PATTERN.test(name))
        return invalid(`"${name}" is not a puppet name: use letters, digits, - or _.`);
    const text = ws.readText(ws.path(specFile));
    if (text === null)
        return invalid(`No ${specFile}. Write it first, as references/characters.md describes.`);
    let parsed: unknown;
    let sources: Record<string, unknown>;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return invalid(`${specFile} is not valid JSON: ${(error as Error).message}`);
    }
    const read = parseSources(ws.readText(ws.path(SOURCES)));
    if ('problem' in read) {
        rb.add(
            finding('puppet-invalid', read.problem, {
                element: 'assets/SOURCES.json',
                detail: { path: '$' },
            }),
        );
        return rb.finish();
    }
    sources = read.sources;
    const { errors, spec } = validate(parsed, dir, sources);
    if (!spec) {
        for (const e of errors) {
            rb.add(
                finding('puppet-invalid', `${e.path} ${e.message}`, {
                    element: specFile,
                    detail: { path: e.path },
                }),
            );
        }
        return rb.finish();
    }

    const session = options.session ?? (await openSession(options.env));
    const tool = await openToolPage(session, dir);
    let result: PageResult;
    try {
        rb.report.environment.chromium = session.chromium;
        progress(`puppet: rigging ${name}`);
        result = await tool.page.evaluate(
            async (o) => {
                const rt = (window as unknown as { rt: typeof import('../runtime/index.ts') }).rt;
                const load = async (src: string) => {
                    const img = new Image();
                    img.src = src;
                    await img.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d', {
                        willReadFrequently: true,
                    }) as CanvasRenderingContext2D;
                    ctx.drawImage(img, 0, 0);
                    return {
                        canvas,
                        ctx,
                        data: ctx.getImageData(0, 0, canvas.width, canvas.height),
                    };
                };
                const names = Object.keys(o.parts);
                const loaded = new Map<string, Awaited<ReturnType<typeof load>>>();
                for (const n of names) loaded.set(n, await load(`/${o.parts[n].image}`));
                // The printed outline. Given, it comes off every part. Left out, each
                // part loses the outline it shows itself: parts printed with lines
                // of different widths all keep their fill, and a part that shows
                // none (dark all through, no ink at its edge, too small to measure)
                // keeps its pixels. The median over the parts that show one is
                // reported as the typical width.
                const own = new Map(
                    names.map((n) => {
                        const l = loaded.get(n) as Awaited<ReturnType<typeof load>>;
                        return [n, rt.outlineWidth(l.data.data, l.canvas.width, l.canvas.height)];
                    }),
                );
                let outline = o.outline;
                if (outline === undefined) {
                    const widths = [...own.values()].filter((w) => w > 0).sort((a, b) => a - b);
                    outline = widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 0;
                }
                const shaveOf = (n: string) =>
                    o.outline !== undefined ? (outline as number) : (own.get(n) as number);
                const emptied: string[] = [];
                const missing: PageResult['missing'] = [];
                const parts: PageResult['parts'] = {};
                const rigParts: Record<string, import('../runtime/puppet.ts').PuppetPart> = {};
                for (const n of names) {
                    const spec = o.parts[n];
                    const l = loaded.get(n) as Awaited<ReturnType<typeof load>>;
                    const w = l.canvas.width;
                    const h = l.canvas.height;
                    const alpha = new Uint8ClampedArray(w * h);
                    for (let i = 0; i < w * h; i++) alpha[i] = l.data.data[i * 4 + 3];
                    const place = (
                        j: string | [number, number],
                        label: string,
                    ): [number, number] => {
                        if (typeof j !== 'string') return j;
                        const tab = rt.findTab(alpha, w, h, j as import('../runtime/rig.ts').Side);
                        if (!tab) {
                            missing.push({ part: n, joint: label, side: j });
                            return [0, 0];
                        }
                        return [Math.round(tab.x * 2) / 2, Math.round(tab.y * 2) / 2];
                    };
                    const pivot = place(spec.pivot, 'pivot');
                    const sockets: Record<string, [number, number]> = {};
                    for (const [s, j] of Object.entries(spec.sockets ?? {}))
                        sockets[s] = place(j, `socket ${s}`);
                    const shaved = rt.shave(alpha, w, h, shaveOf(n));
                    if (!shaved.some((a) => a > 128)) emptied.push(n);
                    const data = new ImageData(new Uint8ClampedArray(l.data.data), w, h);
                    for (let i = 0; i < w * h; i++) data.data[i * 4 + 3] = shaved[i];
                    const out = document.createElement('canvas');
                    out.width = w;
                    out.height = h;
                    (out.getContext('2d') as CanvasRenderingContext2D).putImageData(data, 0, 0);
                    parts[n] = {
                        png: out.toDataURL('image/png'),
                        width: w,
                        height: h,
                        pivot,
                        sockets,
                        shaved: shaveOf(n),
                    };
                    rigParts[n] = {
                        canvas: out,
                        width: w,
                        height: h,
                        pivot,
                        sockets,
                        angle: spec.angle,
                        fit: spec.fit,
                    };
                }
                if (missing.length > 0)
                    return { missing, outline, parts: {}, bones: [], sheet: null };
                if (emptied.length > 0) {
                    return {
                        missing,
                        outline,
                        parts: {},
                        bones: [],
                        sheet: null,
                        emptied,
                    };
                }
                const bones = (
                    o.bones === 'biped' ? rt.biped(o.map ?? {}) : o.bones
                ) as import('../runtime/puppet.ts').PuppetBone[];
                let man: import('../runtime/puppet.ts').Puppet;
                try {
                    man = rt.puppet({
                        parts: rigParts,
                        bones: bones as import('../runtime/puppet.ts').PuppetBone[],
                    });
                } catch (error) {
                    return {
                        missing,
                        outline,
                        parts: {},
                        bones: [],
                        error: (error as Error).message,
                        sheet: null,
                    };
                }

                // The sheet. Row one: every part with its pivot (red) and sockets (blue).
                // Row two: the reference, then the puppet standing, striding both ways and waving.
                const tile = 200;
                const cols = Math.max(4, Math.min(8, names.length));
                const partRows = Math.ceil(names.length / cols);
                const poseH = 460;
                const sheet = document.createElement('canvas');
                sheet.width = cols * tile;
                sheet.height = partRows * tile + poseH;
                const g = sheet.getContext('2d') as CanvasRenderingContext2D;
                g.fillStyle = '#efe9dc';
                g.fillRect(0, 0, sheet.width, sheet.height);
                names.forEach((n, i) => {
                    const p = rigParts[n];
                    const x0 = (i % cols) * tile;
                    const y0 = Math.floor(i / cols) * tile;
                    for (let y = 0; y < tile; y += 10)
                        for (let x = 0; x < tile; x += 10) {
                            g.fillStyle = (x + y) % 20 === 0 ? '#ffffff' : '#dcdcdc';
                            g.fillRect(x0 + x, y0 + y, 10, 10);
                        }
                    const k = Math.min((tile - 40) / p.width, (tile - 44) / p.height, 2);
                    const ox = x0 + (tile - p.width * k) / 2;
                    const oy = y0 + 30 + (tile - 40 - p.height * k) / 2;
                    g.drawImage(p.canvas, ox, oy, p.width * k, p.height * k);
                    const dot = (pt: [number, number], color: string) => {
                        g.fillStyle = color;
                        g.beginPath();
                        g.arc(ox + pt[0] * k, oy + pt[1] * k, 5, 0, Math.PI * 2);
                        g.fill();
                    };
                    dot(p.pivot, '#d62d20');
                    for (const s of Object.values(p.sockets ?? {})) dot(s, '#1f5fbf');
                    g.fillStyle = '#222222';
                    g.font = 'bold 15px sans-serif';
                    g.fillText(n, x0 + 8, y0 + 20);
                });
                const top = partRows * tile;
                const isBiped = (rt.BIPED as readonly string[]).every((b) =>
                    bones.some((bone) => bone.name === b),
                );
                const poses: {
                    label: string;
                    pose: Record<string, number>;
                    swap?: Record<string, string>;
                }[] = isBiped
                    ? [
                          { label: 'stand', pose: rt.idle(0) },
                          // Each foot planted forward at the start of its step, and the
                          // legs passing in between, where knees and feet overlap most.
                          { label: 'stride', pose: rt.walk(0, man.legs()).pose },
                          { label: 'passing', pose: rt.walk(0.5 / 1.8, man.legs()).pose },
                          { label: 'stride back', pose: rt.walk(1 / 1.8, man.legs()).pose },
                          {
                              label: 'wave',
                              pose: {
                                  ...rt.idle(0),
                                  ...rt.wave(1, 0, 2, { reach: -85, elbow: -40 }).pose,
                              },
                          },
                      ]
                    : [{ label: 'rest', pose: {} }];
                // Measure the standing puppet once to scale every pose to the row.
                const probe = document.createElement('canvas');
                probe.width = 3000;
                probe.height = 3000;
                const pc = probe.getContext('2d', {
                    willReadFrequently: true,
                }) as CanvasRenderingContext2D;
                man.draw(pc, 1500, 1500, { pose: poses[0].pose });
                const pix = pc.getImageData(0, 0, 3000, 3000).data;
                let minY = 3000;
                let maxY = 0;
                for (let y = 0; y < 3000; y += 2)
                    for (let x = 0; x < 3000; x += 2)
                        if (pix[(y * 3000 + x) * 4 + 3] > 128) {
                            minY = Math.min(minY, y);
                            maxY = Math.max(maxY, y);
                        }
                const tall = Math.max(1, maxY - minY);
                const scale = (poseH - 70) / tall;
                const slots = poses.length + (o.reference ? 1 : 0);
                const slotW = sheet.width / slots;
                let slot = 0;
                if (o.reference) {
                    const ref = await load(`/${o.reference}`);
                    const k = Math.min(
                        (slotW - 20) / ref.canvas.width,
                        (poseH - 50) / ref.canvas.height,
                    );
                    g.drawImage(
                        ref.canvas,
                        (slotW - ref.canvas.width * k) / 2,
                        top + 36,
                        ref.canvas.width * k,
                        ref.canvas.height * k,
                    );
                    g.fillStyle = '#222222';
                    g.font = 'bold 15px sans-serif';
                    g.fillText('reference', 10, top + 22);
                    slot = 1;
                }
                const floor = top + poseH - 20;
                for (const p of poses) {
                    const x = slotW * slot + slotW / 2;
                    const scaled = rt.puppet({
                        parts: rigParts,
                        bones: bones as import('../runtime/puppet.ts').PuppetBone[],
                        scale,
                    });
                    scaled.draw(g, x, floor - (maxY - 1500) * scale, {
                        pose: p.pose,
                        swap: p.swap,
                    });
                    g.fillStyle = '#222222';
                    g.font = 'bold 15px sans-serif';
                    g.fillText(p.label, slotW * slot + 10, top + 22);
                    slot += 1;
                }
                return { missing, outline, parts, bones, sheet: sheet.toDataURL('image/png') };
            },
            {
                parts: spec.parts,
                outline: spec.outline,
                bones: spec.bones,
                map: spec.map,
                reference: spec.reference,
            },
        );
    } finally {
        await tool.close();
        if (!options.session) await session.close();
    }

    for (const m of result.missing) {
        rb.add(
            finding(
                'puppet-joint-missing',
                `Part "${m.part}": no round joint tab at its ${m.side} for the ${m.joint}. Give the point as [x, y] in the part's pixels.`,
                { element: specFile, detail: { part: m.part, joint: m.joint, side: m.side } },
            ),
        );
    }
    if (result.error) {
        rb.add(
            finding('puppet-invalid', result.error, {
                element: specFile,
                detail: { path: '$.bones' },
            }),
        );
    }
    for (const part of result.emptied ?? []) {
        rb.add(
            finding(
                'puppet-invalid',
                `Shaving ${result.outline} px off part "${part}" leaves nothing of it: give a smaller outline, or leave it out to measure each part.`,
                { element: specFile, detail: { path: '$.outline', part } },
            ),
        );
    }
    if (result.missing.length > 0 || result.error || result.emptied) return rb.finish();

    ws.fresh(ws.path(folder, 'parts'));
    // The old parts' entries go when SOURCES.json is written.
    const added: Record<string, unknown> = {};
    const rig: Record<string, unknown> = { version: 1, parts: {}, bones: result.bones };
    for (const [part, p] of Object.entries(result.parts)) {
        const file = path.join(folder, 'parts', `${part}.png`).split(path.sep).join('/');
        ws.writeFile(ws.path(file), Buffer.from(p.png.split(',')[1], 'base64'));
        const from = spec.parts[part].image.split(/[\\/]/).join('/').slice('assets/'.length);
        added[file.slice('assets/'.length)] = cutEntry(sources, from);
        (rig.parts as Record<string, unknown>)[part] = {
            file,
            width: p.width,
            height: p.height,
            pivot: p.pivot,
            ...(Object.keys(p.sockets).length > 0 ? { sockets: p.sockets } : {}),
            ...(spec.parts[part].angle !== undefined ? { angle: spec.parts[part].angle } : {}),
            ...(spec.parts[part].fit !== undefined ? { fit: spec.parts[part].fit } : {}),
        };
    }
    const rigFile = path.join(folder, 'rig.json').split(path.sep).join('/');
    ws.writeFile(ws.path(rigFile), `${JSON.stringify(rig, null, 2)}\n`);
    const written = await updateSources(ws, (current) => {
        for (const key of Object.keys(current)) {
            if (key.startsWith(`puppets/${name}/parts/`)) delete current[key];
        }
        Object.assign(current, added);
    });
    if ('problem' in written) {
        rb.add(
            finding('puppet-invalid', written.problem, {
                element: 'assets/SOURCES.json',
                detail: { path: '$' },
            }),
        );
        return rb.finish();
    }
    const sheet = path.join('out', 'puppet', `${name}.png`).split(path.sep).join('/');
    ws.writeFile(ws.path(sheet), Buffer.from((result.sheet as string).split(',')[1], 'base64'));
    rb.report.puppet = {
        name,
        outline: result.outline,
        rig: rigFile,
        parts: Object.fromEntries(
            Object.entries(result.parts).map(([part, p]) => [
                part,
                { pivot: p.pivot, sockets: p.sockets, shaved: p.shaved },
            ]),
        ),
        sheet,
    };
    rb.report.artifacts.sheet = path.join(dir, sheet);
    return rb.finish();
}
