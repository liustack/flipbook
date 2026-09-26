import * as path from 'path';

// Small helpers shared by the JSON files a composition carries (timeline.json,
// story.json): type guards, a readable description of a bad value, and a
// checker that collects errors with their JSON path.

export interface SchemaError {
    /** JSON path, e.g. $.scenes[1].bars */
    path: string;
    message: string;
}

export type Json = unknown;

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isObject(value: Json): value is Record<string, Json> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInt(value: Json): value is number {
    return typeof value === 'number' && Number.isInteger(value);
}

export function isNum(value: Json): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function describe(value: Json): string {
    if (value === undefined) return 'missing';
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'an array';
    if (typeof value === 'string')
        return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
    return String(value);
}

export class Checker {
    readonly errors: SchemaError[] = [];

    /** `kind` names the file in messages about unknown fields, e.g. "timeline v1". */
    constructor(private readonly kind: string) {}

    fail(at: string, message: string): void {
        this.errors.push({ path: at, message });
    }

    keys(obj: Record<string, Json>, at: string, allowed: readonly string[]): void {
        for (const key of Object.keys(obj)) {
            if (!allowed.includes(key)) {
                this.fail(
                    `${at}.${key}`,
                    `is not a ${this.kind} field (allowed here: ${allowed.join(', ')})`,
                );
            }
        }
    }

    int(value: Json, at: string, min: number, max: number, extra?: string): boolean {
        if (!isInt(value) || value < min || value > max) {
            this.fail(
                at,
                `must be an integer from ${min} to ${max}${extra ? `, ${extra}` : ''} (got ${describe(value)})`,
            );
            return false;
        }
        return true;
    }

    num(value: Json, at: string, min: number, max: number, exclusiveMin = false): boolean {
        const tooLow = isNum(value) && (exclusiveMin ? value <= min : value < min);
        if (!isNum(value) || tooLow || value > max) {
            const floor = exclusiveMin ? `greater than ${min}` : `at least ${min}`;
            this.fail(at, `must be a number ${floor} and at most ${max} (got ${describe(value)})`);
            return false;
        }
        return true;
    }

    str(value: Json, at: string, pattern?: RegExp, what = 'a string'): value is string {
        if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
            this.fail(at, `must be ${what} (got ${describe(value)})`);
            return false;
        }
        return true;
    }

    /** A relative path that stays inside the composition directory. */
    localFile(value: Json, at: string): boolean {
        if (!this.str(value, at, undefined, 'a path inside the composition')) return false;
        if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
            this.fail(at, 'must be a relative path inside the composition');
            return false;
        }
        return true;
    }
}
