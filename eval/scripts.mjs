// What a composition's page scripts do, read from their syntax rather than
// their text: which flipbook runtime functions they call, and which files
// the page names. Comments do not count, strings count only as file names,
// spacing does not matter, and a function imported under another name counts
// under its own. Parsed with the TypeScript compiler the repository already
// builds with.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { HOST_DIRS } from './cases.mjs';
import { listFiles } from './files.mjs';

/** The runtime's URL in the page, as the skill writes it. */
const RUNTIME = /(^|\/)__flipbook\/runtime\.js$/;

/** Script types a page runs as JavaScript. */
const JS_TYPES = ['', 'module', 'text/javascript', 'application/javascript'];

const isRuntimeSpecifier = (node) =>
    node !== undefined && ts.isStringLiteralLike(node) && RUNTIME.test(node.text);

/** `import('…/runtime.js')`, awaited or not. */
function runtimeImportCall(expression) {
    const call = ts.isAwaitExpression(expression) ? expression.expression : expression;
    return (
        ts.isCallExpression(call) &&
        call.expression.kind === ts.SyntaxKind.ImportKeyword &&
        isRuntimeSpecifier(call.arguments[0])
    );
}

/**
 * One script: whether it imports the runtime, the runtime functions it
 * calls, by the runtime's own names, its string literals (`strings`) and the
 * fixed start of each template literal with a placeholder in it (`prefixes`).
 */
export function analyzeScript(code, file = 'script.js') {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const named = new Map();
    const namespaces = new Set();
    const callees = [];
    const strings = [];
    const prefixes = [];
    let imports = false;
    const visit = (node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
            strings.push(node.text);
        else if (ts.isTemplateExpression(node) && node.head.text) prefixes.push(node.head.text);
        if (ts.isImportDeclaration(node) && isRuntimeSpecifier(node.moduleSpecifier)) {
            imports = true;
            const clause = node.importClause;
            const bindings = clause && !clause.isTypeOnly ? clause.namedBindings : undefined;
            if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
            if (bindings && ts.isNamedImports(bindings)) {
                for (const element of bindings.elements) {
                    named.set(element.name.text, (element.propertyName ?? element.name).text);
                }
            }
        } else if (
            ts.isVariableDeclaration(node) &&
            node.initializer &&
            runtimeImportCall(node.initializer)
        ) {
            imports = true;
            if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
            else if (ts.isObjectBindingPattern(node.name)) {
                for (const element of node.name.elements) {
                    if (!ts.isIdentifier(element.name)) continue;
                    const own =
                        element.propertyName && ts.isIdentifier(element.propertyName)
                            ? element.propertyName.text
                            : element.name.text;
                    named.set(element.name.text, own);
                }
            }
        } else if (ts.isCallExpression(node) && runtimeImportCall(node)) {
            imports = true;
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            let callee = node.expression;
            while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
            if (ts.isIdentifier(callee)) callees.push({ name: callee.text });
            else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression))
                callees.push({ object: callee.expression.text, name: callee.name.text });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    const calls = new Set();
    for (const callee of callees) {
        if (callee.object === undefined && named.has(callee.name))
            calls.add(named.get(callee.name));
        if (callee.object !== undefined && namespaces.has(callee.object)) calls.add(callee.name);
    }
    return { imports, calls, strings, prefixes };
}

/** The scripts written inline in an HTML page that run as JavaScript. HTML comments do not count. */
export function inlineScripts(html) {
    const scripts = [];
    const page = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const attributes = match[1];
        if (/\bsrc\s*=/i.test(attributes)) continue;
        const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ?? '';
        if (JS_TYPES.includes(type.toLowerCase())) scripts.push(match[2]);
    }
    return scripts;
}

/**
 * Every page script of a composition: inline scripts in its HTML pages and
 * its .js and .mjs files, outside the host's folders and what flipbook wrote.
 */
export function pageScripts(dir) {
    const scripts = [];
    for (const rel of listFiles(dir, [...HOST_DIRS, '.flipbook', 'out'])) {
        const text = () => readFileSync(join(dir, rel), 'utf-8');
        if (/\.html?$/i.test(rel)) {
            inlineScripts(text()).forEach((code, i) => {
                scripts.push({ file: `${rel}#script${i + 1}`, code });
            });
        } else if (/\.m?js$/i.test(rel)) {
            scripts.push({ file: rel, code: text() });
        }
    }
    return scripts;
}

/**
 * A file name as the page would request it, relative to the composition:
 * no query or fragment, no leading `./` or `/`, the page's own origin
 * dropped. Null for other origins, data, the runtime's own files and
 * anything that leaves the composition.
 */
export function normalizeRef(raw) {
    let ref = String(raw).trim();
    if (ref.startsWith('http://flipbook.local/')) ref = ref.slice('http://flipbook.local'.length);
    else if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
    ref = ref.split(/[?#]/)[0];
    try {
        ref = decodeURIComponent(ref);
    } catch {
        return null;
    }
    ref = ref.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
    if (!ref) return null;
    const plain = posix.normalize(ref);
    if (plain === '.' || plain === '..' || plain.startsWith('../')) return null;
    if (plain.startsWith('__flipbook/')) return null;
    return plain;
}

/** Attribute values and CSS `url()` in markup or a stylesheet. */
function markupRefs(text) {
    const refs = [];
    for (const m of text.matchAll(
        /\b(?:src|href|poster|srcset|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )) {
        const value = m[1] ?? m[2] ?? m[3] ?? '';
        for (const part of value.split(',')) refs.push(part.trim().split(/\s+/)[0]);
    }
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) refs.push(m[2]);
    return refs;
}

/**
 * The files a composition's pages, scripts and stylesheets name: `exact`
 * holds every string that reads as a file name, `prefixes` the fixed start
 * of names built from pieces (`assets/cut/${name}.png`). A comment names
 * nothing. Everything is relative to the composition, as the page requests
 * it.
 */
export function pageReferences(dir) {
    const exact = new Set();
    const prefixes = new Set();
    const addExact = (raw) => {
        const ref = normalizeRef(raw);
        if (ref) exact.add(ref);
    };
    for (const { file, code } of pageScripts(dir)) {
        const one = analyzeScript(code, file);
        one.strings.forEach(addExact);
        for (const raw of one.prefixes) {
            const ref = normalizeRef(raw);
            if (ref) prefixes.add(ref);
        }
    }
    for (const rel of listFiles(dir, [...HOST_DIRS, '.flipbook', 'out'])) {
        if (/\.html?$/i.test(rel)) {
            const page = readFileSync(join(dir, rel), 'utf-8')
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
            markupRefs(page).forEach(addExact);
        } else if (/\.css$/i.test(rel)) {
            markupRefs(
                readFileSync(join(dir, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ''),
            ).forEach(addExact);
        }
    }
    return { exact: [...exact].sort(), prefixes: [...prefixes].sort() };
}
