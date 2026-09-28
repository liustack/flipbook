// What a composition's page scripts do, read from their syntax rather than
// their text: which flipbook runtime functions they call. Comments, strings
// and spacing do not count, and a function imported under another name
// counts under its own. Parsed with the TypeScript compiler the repository
// already builds with.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { HOST_DIRS } from './cases.mjs';
import { listFiles } from './files.mjs';

/** The runtime's URL in the page, as the skill writes it. */
const RUNTIME = /(^|\/)__flipbook\/runtime\.js$/;

/** Script types a page runs as JavaScript. */
const JS_TYPES = ['', 'module', 'text/javascript', 'application/javascript'];

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
 * One script: whether it imports the runtime, and the runtime functions it
 * calls, by the runtime's own names.
 */
export function analyzeScript(code, file = 'script.js') {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const named = new Map();
    const namespaces = new Set();
    const callees = [];
    let imports = false;
    const visit = (node) => {
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
    return { imports, calls };
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
 * What the page scripts of a composition call from the runtime, all scripts
 * together: `imports` is false when none of them imports the runtime, and
 * then `calls` says nothing either way.
 */
export function runtimeUse(dir) {
    let imports = false;
    const calls = new Set();
    for (const { file, code } of pageScripts(dir)) {
        const one = analyzeScript(code, file);
        imports ||= one.imports;
        for (const name of one.calls) calls.add(name);
    }
    return { imports, calls: [...calls].sort() };
}
