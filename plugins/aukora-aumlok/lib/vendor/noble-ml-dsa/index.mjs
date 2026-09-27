/**
 * The one entry this lane imports the vendored ML-DSA-65 implementation through.
 *
 * Genesis-authored. It is NOT upstream code and carries no upstream digest; the
 * eight modules it reaches are the vendored bytes and every one of them is
 * measured in `upstream-noble-ml-dsa.json`.
 *
 * WHY AN ENTRY RATHER THAN A DEEP IMPORT. `scripts/aumlok/**` and the courts
 * should name one path, so re-vendoring at a different upstream version is a
 * change to this file's manifest and not a change to every consumer. The
 * re-export is the whole module: nothing is added, wrapped, defaulted or
 * re-implemented here, because a wrapper between a caller and a signature check
 * is a place a verification can be weakened without moving a single vendored
 * byte.
 *
 * WHAT IS DELIBERATELY NOT RE-EXPORTED. `ml_dsa44` and `ml_dsa87` are present in
 * the vendored `ml-dsa.js` and are not named here. This lane's suite is
 * ML-DSA-65 only; a caller that wants another parameter set should have to widen
 * this file, where the change is visible in review, rather than reach past it.
 *
 * @module @aukora/dsh-plugin-aumlok/vendor/noble-ml-dsa
 */
export { ml_dsa65 } from './post-quantum/ml-dsa.js'
