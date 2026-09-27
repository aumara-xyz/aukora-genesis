/** Wrap an append-only source (exposing a read supplier) as a read-only stream. No write surface is exposed. */
export function readOnlyView(supply) {
    return {
        get length() { return supply().length; },
        at(index) { return supply()[index]; },
        snapshot() { return supply().slice(); },
        since(fromIndex) { return supply().slice(Math.max(0, fromIndex)); },
    };
}
/** Build the read-only Spatial stream from a geometry log. The shell renders evolution; it never writes back. */
export function spatialStream(geometryLog) {
    return {
        schema: 'aukora-spatial-stream-v1',
        geometry: readOnlyView(() => geometryLog.all()),
        grantsAuthority: false,
        feedsApply: false,
    };
}
export function spatialStreamGrantsAuthority() {
    return false;
}
