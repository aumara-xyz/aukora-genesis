import { clientBundle } from '../tsdown.client.ts'

export default // THE FACE'S OWN NAME, AND ONLY THE ENTRIES IT HAS: this was copied from aumlok verbatim and still said
// `face-aumlok` while naming an `invariant` module this face does not carry. Both were found by reading the
// config against the filesystem BEFORE the build, which the heavy lock made the only way to find them.
clientBundle('@aukora/face-memory', ['lib/types/index.js'])
