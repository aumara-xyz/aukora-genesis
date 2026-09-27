/**
 * Record or verify the installed dependency digests of a release.
 *
 *   node scripts/dependency-digests-cli.mjs --source <release>            print the list as JSON
 *   node scripts/dependency-digests-cli.mjs --source <release> --verify <record.json>
 *
 * IT PRINTS AND THE CALLER DECIDES. The materializer writes what this prints into the release record; the
 * keyless check passes the recorded list back with `--verify` and REFUSES BY NAME on any difference. Keeping
 * the decision out here means one implementation of "what the store is" serves both, and a court can call
 * this directly instead of reimplementing the walk.
 *
 * EXIT CODES: 0 no differences (or a list was printed); 1 differences found, named on stdout as JSON;
 * 2 usage or input error. A DIFFERENT CODE FOR "FOUND SOMETHING" IS WHAT LETS A CALLER REFUSE RATHER THAN
 * PARSE PROSE.
 */
import { readFileSync } from 'node:fs'

import { dependencyDifferences, dependencyDigests } from './lib/dependency-digests.mjs'

const argv = process.argv.slice(2)
const valueOf = flag => {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const source = valueOf('--source')
if (source === undefined) {
  console.error('dependency-digests-usage: --source <release-root> is required')
  process.exit(2)
}

if (argv.includes('--verify')) {
  const recordPath = valueOf('--verify')
  let recorded
  try {
    recorded = JSON.parse(readFileSync(recordPath, 'utf8'))
  } catch (error) {
    console.error(`dependency-digests-record-unreadable: ${recordPath}: ${error.message}`)
    process.exit(2)
  }
  // THE LIST MAY ARRIVE AS THE WHOLE RECORD OR AS THE LIST ITSELF, because the check reads the release
  // record and a court may hand over just the section. Accepting both is one line and saves a caller from
  // having to know which shape this expects.
  const list = Array.isArray(recorded) ? recorded : recorded?.dependencies
  if (!Array.isArray(list)) {
    console.error('dependency-digests-record-missing: the record carries no dependencies list, so there is '
      + 'nothing to verify against. A release whose record predates this check is UNVERIFIED, not intact.')
    process.exit(2)
  }
  const differences = dependencyDifferences(source, list)
  if (differences.length > 0) {
    process.stdout.write(`${JSON.stringify(differences, null, 2)}\n`)
    process.exit(1)
  }
  process.exit(0)
}

process.stdout.write(`${JSON.stringify(dependencyDigests(source))}\n`)
