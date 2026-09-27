// One file out of a zip archive, with nothing but Node: the central directory
// says where each member lies, and a member is either stored as is or
// deflated. Enough for a font that is only published inside a release zip,
// whose hash is checked before it gets here: this reads the plain kind of zip
// (no zip64, no encryption, names in ASCII or flagged UTF-8) and says so for
// any other.
import { inflateRawSync } from 'zlib';

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** General purpose flags: bit 0 encrypted, bit 11 the name is UTF-8. */
const ENCRYPTED = 0x1;
const UTF8 = 0x800;

/** The bytes of member `name` in the zip `archive`. Throws when it is missing or packed in a way this does not read. */
export function zipMember(archive: Buffer, name: string): Buffer {
    const need = (at: number, length: number, what: string) => {
        if (at < 0 || at + length > archive.length) {
            throw new Error(`broken zip: the ${what} runs past the end of the archive`);
        }
    };
    // The end of central directory record: 22 bytes, then its comment, which
    // must reach the end of the file exactly, with the central directory right
    // before it. A signature inside a comment fails one of these and is passed
    // over, and the search goes on back.
    const plausible = (i: number) => {
        if (archive.readUInt32LE(i) !== END) return false;
        if (i + 22 + archive.readUInt16LE(i + 20) !== archive.length) return false;
        const size = archive.readUInt32LE(i + 12);
        const offset = archive.readUInt32LE(i + 16);
        // zip64 marks its fields and is refused below, with a clear reason.
        if (size === 0xffffffff || offset === 0xffffffff) return true;
        if (offset + size === i) return true;
        misplaced ??=
            offset + size > archive.length
                ? 'broken zip: the central directory runs past the end of the archive'
                : 'broken zip: the central directory does not end where its end record starts';
        return false;
    };
    let misplaced: string | undefined;
    let end = -1;
    for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
        if (plausible(i)) {
            end = i;
            break;
        }
    }
    if (end < 0) throw new Error(misplaced ?? 'not a zip archive: no end of central directory');
    const count = archive.readUInt16LE(end + 10);
    const size = archive.readUInt32LE(end + 12);
    let at = archive.readUInt32LE(end + 16);
    if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) {
        throw new Error('zip64 archives are not read');
    }
    need(at, size, 'central directory');
    const wanted = Buffer.from(name, 'utf-8');
    let unreadNames = 0;
    for (let i = 0; i < count; i++) {
        need(at, 46, 'central directory');
        if (archive.readUInt32LE(at) !== CENTRAL) throw new Error('broken zip central directory');
        const flags = archive.readUInt16LE(at + 8);
        const method = archive.readUInt16LE(at + 10);
        const packed = archive.readUInt32LE(at + 20);
        const unpacked = archive.readUInt32LE(at + 24);
        const nameLength = archive.readUInt16LE(at + 28);
        const extraLength = archive.readUInt16LE(at + 30);
        const commentLength = archive.readUInt16LE(at + 32);
        const local = archive.readUInt32LE(at + 42);
        need(at + 46, nameLength + extraLength + commentLength, 'central directory');
        const entry = archive.subarray(at + 46, at + 46 + nameLength);
        at += 46 + nameLength + extraLength + commentLength;
        // A name with bytes past ASCII and no UTF-8 flag is in an old code page,
        // which this does not decode: it is counted and never matched.
        if (!(flags & UTF8) && entry.some((b) => b >= 0x80)) {
            unreadNames++;
            continue;
        }
        if (!entry.equals(wanted)) continue;
        if (packed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff) {
            throw new Error('zip64 archives are not read');
        }
        if (flags & ENCRYPTED) throw new Error(`zip entry ${name} is encrypted`);
        need(local, 30, `local header of ${name}`);
        if (archive.readUInt32LE(local) !== LOCAL) throw new Error(`broken zip entry ${name}`);
        const start =
            local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
        need(start, packed, `data of ${name}`);
        const data = archive.subarray(start, start + packed);
        let out: Buffer;
        if (method === 0) out = Buffer.from(data);
        else if (method === 8) out = inflateRawSync(data);
        else
            throw new Error(
                `zip entry ${name} is packed with method ${method}, not stored or deflated`,
            );
        if (out.length !== unpacked) {
            throw new Error(
                `zip entry ${name} unpacks to ${out.length} bytes, expected ${unpacked}`,
            );
        }
        return out;
    }
    throw new Error(
        unreadNames > 0
            ? `the zip has no ${name} (${unreadNames} names are in an old code page, not UTF-8, and were not read)`
            : `the zip has no ${name}`,
    );
}
