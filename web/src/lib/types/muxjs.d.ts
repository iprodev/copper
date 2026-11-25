// the parts of mux.js that are used (it has no types of its own)

declare module "mux.js/lib/mp4/transmuxer" {
    export type TransmuxedSegment = {
        initSegment: Uint8Array,
        data: Uint8Array,
    };

    export class Transmuxer {
        constructor(options?: { remux?: boolean, keepOriginalTimestamps?: boolean });
        on(event: "data", listener: (segment: TransmuxedSegment) => void): void;
        push(bytes: Uint8Array): void;
        flush(): void;
    }
}

declare module "mux.js/lib/m2ts/probe" {
    const probe: {
        parseType(packet: Uint8Array, pmtPid?: number): "pat" | "pmt" | "pes" | null,
        parsePat(packet: Uint8Array): number,
        parsePmt(packet: Uint8Array): Record<number, number>,
    };
    export default probe;
}
