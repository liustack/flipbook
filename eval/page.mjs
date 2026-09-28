// What a composition's page runs, read from its syntax: the scripts
// index.html loads (inline scripts and script src tags) and the local
// modules they import, statically or with import('a literal path'), and
// which flipbook runtime functions those modules call. A file the page does
// not load does not count. Calls are matched by binding with the TypeScript
// checker, so a parameter, a local or a namespace of the same name is not
// the runtime function. What the reading cannot settle is listed in `notes`.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { HOST_DIRS } from './cases.mjs';

/** Where the page imports the runtime from, relative to the composition. */
const RUNTIME_REL = '__flipbook/runtime.js';

/** A declaration file standing in for the runtime, one function per export. */
const RUNTIME_FILE = '/__flipbook_eval__/runtime.d.ts';

/** Script types a page runs as JavaScript. */
const JS_TYPES = ['', 'module', 'text/javascript', 'application/javascript'];

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

/** A local script the page can load at `rel`, as a full path, or null. */
function localScript(dir, rel) {
    if (!rel || rel.split('/').some((part) => LEFT_OUT.includes(part))) return null;
    if (!/\.m?js$/i.test(rel)) return null;
    const file = join(dir, rel);
    return existsSync(file) && statSync(file).isFile() ? file : null;
}

/**
 * The page of the composition in `dir`: `entries` and `modules` (the
 * scripts index.html loads and every local module they reach, relative to
 * `dir`, inline scripts as `index.html#1`), `imports` (whether any of them
 * imports the runtime), `calls` (the runtime functions they call, by the
 * runtime's own names), `passed` (runtime functions they use without
 * calling them where the runner can see, handed to other code), `notes`
 * (what the reading could not follow), and `program` and `files` for
 * further reading.
 */
export function pageModel(dir, runtimeNames = repoRuntimeNames()) {
    const notes = [];
    const index = join(dir, 'index.html');
    const empty = { entries: [], modules: [], imports: false, calls: [], passed: [], notes };
    if (!existsSync(index)) {
        notes.push('there is no index.html');
        return empty;
    }
    const html = readFileSync(index, 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
    const texts = new Map();
    const labels = new Map();
    const bases = new Map();
    const entries = [];
    let inline = 0;
    for (const tag of scriptTags(html)) {
        if (tag.src !== null) {
            const file = localScript(dir, resolveRef('', tag.src));
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
        if (!texts.has(file)) texts.set(file, readFileSync(file, 'utf-8'));
        else if (resolutions.has(file)) continue;
        resolutions.set(file, new Map());
        const base = bases.get(file) ?? posix.dirname(label(file)).replace(/^\.$/, '');
        for (const fileName of moduleSpecifiers(texts.get(file), file)) {
            const rel = resolveRef(base, fileName, { bare: false });
            if (rel === RUNTIME_REL) {
                resolutions.get(file).set(fileName, RUNTIME_FILE);
                continue;
            }
            const target = localScript(dir, rel);
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
    const all = new Map([...texts, [RUNTIME_FILE, runtimeText]]);
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
        getCurrentDirectory: () => dir,
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => all.has(name),
        readFile: (name) => all.get(name),
        resolveModuleNameLiterals: (literals, containing) =>
            literals.map((literal) => {
                const to = resolutions.get(containing)?.get(literal.text);
                if (!to) return { resolvedModule: undefined };
                const extension =
                    to === RUNTIME_FILE
                        ? ts.Extension.Dts
                        : to.endsWith('.mjs')
                          ? ts.Extension.Mjs
                          : ts.Extension.Js;
                return {
                    resolvedModule: {
                        resolvedFileName: to,
                        extension,
                        isExternalLibraryImport: false,
                    },
                };
            }),
    };
    const modules = [...texts.keys()];
    const program = ts.createProgram({ rootNames: [...modules, RUNTIME_FILE], options, host });
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
        const home = declaration.getSourceFile().fileName;
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
    for (const file of modules) {
        const source = program.getSourceFile(file);
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
        notes,
        program,
        files: new Map(modules.map((file) => [file, label(file)])),
        texts,
    };
}
