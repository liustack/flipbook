// Format of a sound file from its first bytes, without decoding it.

export type AudioFormat = 'mp3' | 'ogg' | 'flac' | 'wav';

/** File extension flipbook saves each format under. */
export const AUDIO_EXTENSION: Record<AudioFormat, string> = {
    mp3: '.mp3',
    ogg: '.ogg',
    flac: '.flac',
    wav: '.wav',
};

/** The ffmpeg demuxer that reads each format, and nothing else. */
export const AUDIO_DEMUXER: Record<AudioFormat, string> = {
    mp3: 'mp3',
    ogg: 'ogg',
    flac: 'flac',
    wav: 'wav',
};

/** An MPEG audio frame header of layer III (mp3), not ADTS AAC, which shares the sync word. */
function mpegLayer3(b: Buffer, at: number): boolean {
    if (at + 4 > b.length) return false;
    if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return false;
    const version = (b[at + 1] >> 3) & 0x03;
    const layer = (b[at + 1] >> 1) & 0x03;
    const bitrate = b[at + 2] >> 4;
    const rate = (b[at + 2] >> 2) & 0x03;
    return version !== 1 && layer === 1 && bitrate !== 0x0f && rate !== 0x03;
}

/** The sound's format, or null when the bytes are not an mp3, Ogg, FLAC or WAV file. */
export function audioFormat(b: Buffer): AudioFormat | null {
    if (b.length < 12) return null;
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') {
        return 'wav';
    }
    if (b.toString('latin1', 0, 4) === 'OggS') return 'ogg';
    if (b.toString('latin1', 0, 4) === 'fLaC') return 'flac';
    if (b.toString('latin1', 0, 3) === 'ID3') return 'mp3';
    if (mpegLayer3(b, 0)) return 'mp3';
    return null;
}
