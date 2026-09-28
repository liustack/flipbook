// What a composition's page runs, read from its syntax: the scripts
// index.html loads (inline scripts and script src tags) and the local
// modules they import, statically or with import('a literal path'), and
// which flipbook runtime functions those modules call. A file the page does
// not load does not count. Calls are matched by binding with the TypeScript
// checker, so a parameter, a local or a namespace of the same name is not
// the runtime function. It also lists where the page names files, as
// evidence for a person: reading markup and code cannot tell whether the
// page really loads a file, so nothing here says it does. Every file is read through
// the workspace reader (files.mjs): nothing outside the workspace or in the
// folders left out, links included. What the reading cannot settle is
// listed in `notes`, and the files it would not read in `refused`.
import { readFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { HOST_DIRS } from './cases.mjs';
import { workspaceReader } from './files.mjs';

/** Where the page imports the runtime from, relative to the composition. */
const RUNTIME_REL = '__flipbook/runtime.js';

/** A declaration file standing in for the runtime, one function per export. */
const RUNTIME_FILE = '/__flipbook_eval__/runtime.d.ts';

/** Script types a page runs as JavaScript. */
const JS_TYPES = ['', 'module', 'text/javascript', 'application/javascript'];

/** Runtime functions whose first argument is a file for the page to load. */
export const LOADERS = ['photo', 'specimens', 'loadRig', 'loadSprite'];

/**
 * The attributes through which an element usually loads the file it names,
 * by element: a reference there is listed as `element`, any other attribute
 * as `attribute`. Whether the element exists in the page is not checked.
 */
const LOADING_ATTRIBUTES = {
    img: ['src', 'srcset'],
    source: ['src', 'srcset'],
    video: ['src', 'poster'],
    audio: ['src'],
    link: ['href'],
    image: ['href', 'xlink:href'],
    use: ['href', 'xlink:href'],
};

/** Folders whose files a page never loads for the eval's purposes. */
const LEFT_OUT = [...HOST_DIRS, '.flipbook', 'out'];

/** The names src/runtime/index.ts exports as values, the ones a page can call. */
export function runtimeExports(repoRoot) {
    const file = join(repoRoot, 'src', 'runtime', 'index.ts');
    const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const names = new Set();
    for (const node of source.statements) {
        if (!ts.isExportDeclaration(node) || node.isTypeOnly) continue;
        const clause = node.exportClause;
        if (!clause || !ts.isNamedExports(clause)) continue;
        for (const element of clause.elements) {
            if (!element.isTypeOnly) names.add(element.name.text);
        }
    }
    return names;
}

let defaultNames = null;
/** The runtime exports of the repository this file belongs to. */
function repoRuntimeNames() {
    defaultNames ??= runtimeExports(join(dirname(fileURLToPath(import.meta.url)), '..'));
    return defaultNames;
}

/**
 * A path as the page would request it, relative to the composition: `raw`
 * resolved against `base` (the folder of the file that names it, '' for the
 * page), with no query or fragment and the page's own origin dropped. Null
 * for other origins, data, bare names and anything outside the composition.
 */
export function resolveRef(base, raw, { bare = true } = {}) {
    let ref = String(raw).trim();
    if (ref.startsWith('http://flipbook.local/')) ref = ref.slice('http://flipbook.local'.length);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
    ref = ref.split(/[?#]/)[0];
    try {
        ref = decodeURIComponent(ref);
    } catch {
        return null;
    }
    if (!ref) return null;
    if (!bare && !/^(\/|\.\/|\.\.\/)/.test(ref)) return null;
    const joined = ref.startsWith('/') ? ref.replace(/^\/+/, '') : posix.join(base, ref);
    const plain = posix.normalize(joined);
    if (plain === '.' || plain === '..' || plain.startsWith('../')) return null;
    return plain;
}

/** An HTML attribute's value, or null. */
function attribute(attributes, name) {
    const m = attributes.match(
        new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
    );
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** The page's script tags that run as JavaScript, HTML comments left out. */
function scriptTags(html) {
    const tags = [];
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const type = (attribute(m[1], 'type') ?? '').toLowerCase();
        if (JS_TYPES.includes(type)) tags.push({ src: attribute(m[1], 'src'), body: m[2] });
    }
    return tags;
}

/**
 * The module paths a script names as plain strings: static imports and
 * re-exports, and import() of a literal. An import() of a computed path is
 * noted by the caller when it walks the program.
 */
function moduleSpecifiers(text, file) {
    const found = [];
    const visit = (node) => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        )
            found.push(node.moduleSpecifier.text);
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] !== undefined &&
            ts.isStringLiteralLike(node.arguments[0])
        )
            found.push(node.arguments[0].text);
        ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS));
    return found;
}

/**
 * Where index.html and the stylesheets it links name files: `element` for
 * the attributes LOADING_ATTRIBUTES names, `attribute` for any other
 * attribute, `css` for a CSS `url()` in a style block, a style attribute or
 * a linked stylesheet (with its `@import`s), read through the workspace
 * reader. `add(path, kind)` records each. Evidence only: a tag inside a
 * `<template>` or a `<textarea>`, or a CSS rule no element matches, loads
 * nothing, and the runner does not try to tell.
 */
function markupReferences(dir, html, reader, add) {
    const stylesheets = [];
    const record = (base, raw, kind) => {
        const ref = resolveRef(base, raw);
        if (ref) add(ref, kind);
    };
    const clean = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
    const css = (text, base) => {
        for (const m of clean(text).matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi))
            record(base, m[2], 'css');
        for (const m of clean(text).matchAll(/@import\s+(['"])([^'"]+)\1/gi))
            stylesheets.push([base, m[2]]);
    };
    const attributes = (text) =>
        [...text.matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
            (a) => [a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? ''],
        );
    const page = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
    for (const m of page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) css(m[1], '');
    const markup = page.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
    for (const tag of markup.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
        const name = tag[1].toLowerCase();
        const rel = (attribute(tag[2], 'rel') ?? '').toLowerCase().split(/\s+/);
        for (const [key, value] of attributes(tag[2])) {
            if (key === 'style') {
                css(value, '');
                continue;
            }
            const kind = (LOADING_ATTRIBUTES[name] ?? []).includes(key) ? 'element' : 'attribute';
            for (const part of key === 'srcset' ? value.split(',') : [value]) {
                const raw = part.trim().split(/\s+/)[0] ?? '';
                if (kind === 'element' || /[./]/.test(raw)) record('', raw, kind);
            }
            if (name === 'link' && key === 'href' && rel.includes('stylesheet'))
                stylesheets.push(['', value]);
        }
    }
    const seen = new Set();
    while (stylesheets.length > 0) {
        const [base, raw] = stylesheets.shift();
        const rel = resolveRef(base, raw);
        if (!rel || seen.has(rel) || rel.split('/').some((part) => LEFT_OUT.includes(part)))
            continue;
        seen.add(rel);
        const text = reader.text(join(dir, rel));
        if (text !== null) css(text, posix.dirname(rel).replace(/^\.$/, ''));
    }
}

/** A local script the page can load at `rel`, as a full path, when the reader may read it, or null. */
function localScript(dir, rel, reader) {
    if (!rel || rel.split('/').some((part) => LEFT_OUT.includes(part))) return null;
    if (!/\.m?js$/i.test(rel)) return null;
    const file = join(dir, rel);
    return reader.real(file) ? file : null;
}

/**
 * The page of the composition in `dir`: `entries` and `modules` (the
 * scripts index.html loads and every local module they reach, relative to
 * `dir`, inline scripts as `index.html#1`), `imports` (whether any of them
 * imports the runtime), `calls` (the runtime functions they call, by the
 * runtime's own names), `passed` (runtime functions they use without
 * calling them where the runner can see, handed to other code),
 * `references` (every file the page names, each with where: `element`,
 * `attribute` and `css` as markupReferences says, `loader` for the literal
 * path given to a runtime loader bound to the runtime, LOADERS, and
 * `script` for any other string in the scripts), `builtPaths` (the fixed
 * start of a template path given to a runtime loader), `computedPaths` (how
 * many runtime loader calls get a path the runner cannot read). These are
 * evidence for a person, not proof that the page loads anything. `notes` (what the reading could not follow), `refused` (files
 * it would not read: links out of the workspace `wsRoot`, broken links,
 * files in the folders left out), and `program`, `files` and `texts` for
 * further reading.
 */
export function pageModel(dir, { wsRoot = dir, runtimeNames = repoRuntimeNames() } = {}) {
    const notes = [];
    const reader = workspaceReader(wsRoot, { leftOut: LEFT_OUT });
    const index = join(dir, 'index.html');
    const empty = {
        entries: [],
        modules: [],
        imports: false,
        calls: [],
        passed: [],
        references: {},
        builtPaths: [],
        computedPaths: 0,
        notes,
        refused: reader.refused,
    };
    const page = reader.text(index);
    if (page === null) {
        notes.push('index.html cannot be read');
        return empty;
    }
    const html = page.replace(/<!--[\s\S]*?-->/g, '');
    const texts = new Map();
    const labels = new Map();
    const bases = new Map();
    const entries = [];
    let inline = 0;
    for (const tag of scriptTags(html)) {
        if (tag.src !== null) {
            const file = localScript(dir, resolveRef('', tag.src), reader);
            if (file) entries.push(file);
            else notes.push(`index.html loads the script ${tag.src}, which the runner cannot find`);
            continue;
        }
        inline++;
        const file = join(dir, `__index_inline_${inline}__.js`);
        texts.set(file, tag.body);
        labels.set(file, `index.html#${inline}`);
        bases.set(file, '');
        entries.push(file);
    }
    const label = (file) => labels.get(file) ?? relative(dir, file).split(sep).join('/');
    const resolutions = new Map();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.shift();
        if (!texts.has(file)) texts.set(file, reader.text(file) ?? '');
        else if (resolutions.has(file)) continue;
        resolutions.set(file, new Map());
        const base = bases.get(file) ?? posix.dirname(label(file)).replace(/^\.$/, '');
        for (const fileName of moduleSpecifiers(texts.get(file), file)) {
            const rel = resolveRef(base, fileName, { bare: false });
            if (rel === RUNTIME_REL) {
                resolutions.get(file).set(fileName, RUNTIME_FILE);
                continue;
            }
            const target = localScript(dir, rel, reader);
            if (!target) {
                notes.push(`${label(file)} imports ${fileName}, which the runner cannot follow`);
                continue;
            }
            resolutions.get(file).set(fileName, target);
            if (!resolutions.has(target)) queue.push(target);
        }
    }
    const runtimeText = [...runtimeNames]
        .map((name) => `export declare function ${name}(...args: any[]): any;`)
        .join('\n');
    // TypeScript sees each module under a name of its own with forward slashes:
    // it rewrites Windows paths that way, and a lookup by the real path would miss.
    const virtualOf = new Map();
    const realOf = new Map();
    [...texts.keys()].forEach((file, k) => {
        const name = `/__flipbook_eval__/m${k}${extname(file) === '.mjs' ? '.mjs' : '.js'}`;
        virtualOf.set(file, name);
        realOf.set(name, file);
    });
    const virtual = (file) => (file === RUNTIME_FILE ? RUNTIME_FILE : virtualOf.get(file));
    const real = (name) => realOf.get(name) ?? name;
    const all = new Map([
        ...[...texts].map(([file, text]) => [virtual(file), text]),
        [RUNTIME_FILE, runtimeText],
    ]);
    const options = {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        noLib: true,
        types: [],
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleDetection: ts.ModuleDetectionKind.Force,
    };
    const host = {
        getSourceFile: (name) =>
            all.has(name)
                ? ts.createSourceFile(
                      name,
                      all.get(name),
                      ts.ScriptTarget.ESNext,
                      true,
                      name === RUNTIME_FILE ? ts.ScriptKind.TS : ts.ScriptKind.JS,
                  )
                : undefined,
        getDefaultLibFileName: () => '/__flipbook_eval__/lib.d.ts',
        writeFile: () => {},
        getCurrentDirectory: () => '/__flipbook_eval__',
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => all.has(name),
        readFile: (name) => all.get(name),
        resolveModuleNameLiterals: (literals, containing) =>
            literals.map((literal) => {
                const to = resolutions.get(real(containing))?.get(literal.text);
                if (!to) return { resolvedModule: undefined };
                const extension =
                    to === RUNTIME_FILE
                        ? ts.Extension.Dts
                        : to.endsWith('.mjs')
                          ? ts.Extension.Mjs
                          : ts.Extension.Js;
                return {
                    resolvedModule: {
                        resolvedFileName: virtual(to),
                        extension,
                        isExternalLibraryImport: false,
                    },
                };
            }),
    };
    const modules = [...texts.keys()];
    const program = ts.createProgram({
        rootNames: [...modules.map(virtual), RUNTIME_FILE],
        options,
        host,
    });
    const checker = program.getTypeChecker();
    const runtimeImport = (node, file) => {
        const call = ts.isAwaitExpression(node) ? node.expression : node;
        return (
            ts.isCallExpression(call) &&
            call.expression.kind === ts.SyntaxKind.ImportKeyword &&
            call.arguments[0] !== undefined &&
            ts.isStringLiteralLike(call.arguments[0]) &&
            resolutions.get(file)?.get(call.arguments[0].text) === RUNTIME_FILE
        );
    };
    const inRuntime = (symbol) =>
        symbol?.declarations?.some((d) => d.getSourceFile().fileName === RUNTIME_FILE) ?? false;
    /** What `node` is by binding: a runtime function `{ fn }`, the runtime namespace `{ ns }`, or null. */
    const target = (node, file, depth = 0) => {
        if (depth > 8) return null;
        while (ts.isParenthesizedExpression(node)) node = node.expression;
        if (ts.isPropertyAccessExpression(node)) {
            const object = target(node.expression, file, depth + 1);
            if (object?.ns) return runtimeNames.has(node.name.text) ? { fn: node.name.text } : null;
            let member = checker.getSymbolAtLocation(node.name);
            if (member && member.flags & ts.SymbolFlags.Alias)
                member = checker.getAliasedSymbol(member);
            return inRuntime(member) && member.flags & ts.SymbolFlags.Function
                ? { fn: member.name }
                : null;
        }
        if (!ts.isIdentifier(node)) return null;
        const symbol = checker.getSymbolAtLocation(node);
        if (!symbol) return null;
        if (symbol.flags & ts.SymbolFlags.Alias) {
            const aliased = checker.getAliasedSymbol(symbol);
            if (!inRuntime(aliased)) return null;
            if (aliased.flags & ts.SymbolFlags.Function) return { fn: aliased.name };
            return aliased.flags & ts.SymbolFlags.ValueModule ? { ns: true } : null;
        }
        const declaration = symbol.valueDeclaration;
        if (!declaration) return null;
        const home = real(declaration.getSourceFile().fileName);
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
            if (!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)) return null;
            if (ts.isIdentifier(declaration.name) && runtimeImport(declaration.initializer, home))
                return { ns: true };
            return target(declaration.initializer, home, depth + 1);
        }
        if (ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
            const holder = declaration.parent.parent;
            if (!ts.isVariableDeclaration(holder) || !holder.initializer) return null;
            if (!(ts.getCombinedNodeFlags(holder) & ts.NodeFlags.Const)) return null;
            const from = runtimeImport(holder.initializer, home)
                ? { ns: true }
                : target(holder.initializer, home, depth + 1);
            const key = declaration.propertyName ?? declaration.name;
            if (!from?.ns || !ts.isIdentifier(key)) return null;
            return runtimeNames.has(key.text) ? { fn: key.text } : null;
        }
        return null;
    };
    const isNameOfDeclaration = (node) => {
        const parent = node.parent;
        if (!parent) return false;
        if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
        if (
            ts.isImportSpecifier(parent) ||
            ts.isExportSpecifier(parent) ||
            ts.isBindingElement(parent)
        )
            return true;
        return 'name' in parent && parent.name === node && !ts.isCallExpression(parent);
    };
    let imports = false;
    const calls = new Set();
    const passed = new Set();
    let namespaceLoose = false;
    const references = new Map();
    const reference = (path, kind) => {
        if (!references.has(path)) references.set(path, new Set());
        references.get(path).add(kind);
    };
    markupReferences(dir, html, reader, reference);
    const builtPaths = new Set();
    let computedPaths = 0;
    const consumed = new Set();
    /** The path given to a runtime loader: a literal, a template's fixed start, or neither. */
    const load = (node) => {
        if (!node) return;
        if (ts.isStringLiteralLike(node)) {
            consumed.add(node);
            const ref = resolveRef('', node.text);
            if (ref) reference(ref, 'loader');
        } else if (ts.isTemplateExpression(node) && node.head.text) {
            const ref = resolveRef('', node.head.text);
            if (ref) builtPaths.add(ref);
            else computedPaths++;
        } else {
            computedPaths++;
        }
    };
    const isModuleSpecifier = (node) => {
        const parent = node.parent;
        return (
            ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
                parent.moduleSpecifier === node) ||
            (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)
        );
    };
    for (const file of modules) {
        const source = program.getSourceFile(virtual(file));
        const visit = (node) => {
            if (
                (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                node.moduleSpecifier &&
                ts.isStringLiteralLike(node.moduleSpecifier) &&
                resolutions.get(file)?.get(node.moduleSpecifier.text) === RUNTIME_FILE
            )
                imports = true;
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                if (runtimeImport(node, file)) imports = true;
                const arg = node.arguments[0];
                if (arg === undefined || !ts.isStringLiteralLike(arg))
                    notes.push(
                        `${label(file)} imports a module by a path it computes, not followed`,
                    );
            }
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
                const called = target(node.expression, file);
                if (called?.fn) calls.add(called.fn);
                const args = node.arguments ?? [];
                if (called?.fn && LOADERS.includes(called.fn)) load(args[0]);
            }
            if (
                (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) &&
                !(ts.isIdentifier(node) && isNameOfDeclaration(node))
            ) {
                const used = target(node, file);
                const parent = node.parent;
                const callee =
                    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
                    parent.expression === node;
                if (used?.fn && !callee) passed.add(used.fn);
                if (
                    used?.ns &&
                    !(ts.isPropertyAccessExpression(parent) && parent.expression === node)
                )
                    namespaceLoose = true;
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        const mention = (node) => {
            if (ts.isStringLiteralLike(node) && !consumed.has(node) && !isModuleSpecifier(node)) {
                const ref = /[./]/.test(node.text) ? resolveRef('', node.text) : null;
                if (ref) reference(ref, 'script');
            }
            ts.forEachChild(node, mention);
        };
        mention(source);
    }
    if (namespaceLoose)
        notes.push(
            'the runtime namespace is handed to other code, so its calls are not all visible',
        );
    return {
        entries: entries.map(label),
        modules: modules.map(label),
        imports,
        calls: [...calls].sort(),
        passed: [...passed].filter((name) => !calls.has(name)).sort(),
        references: Object.fromEntries(
            [...references]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([path, kinds]) => [path, [...kinds].sort()]),
        ),
        builtPaths: [...builtPaths].sort(),
        computedPaths,
        notes: [...notes, ...reader.refused],
        refused: reader.refused,
        program,
        files: new Map(modules.map((file) => [file, label(file)])),
        texts,
    };
}
