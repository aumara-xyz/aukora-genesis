/** The shared Room into tracked memory: every post, whichever program wrote it, chained with its claimed author, never approved.
 * The Room is ~/aukora-live/room.log (JSON lines, each appended whole under flock by room_core.py, the Room page or the app).
 * Each pass reads only the bytes after a cursor kept in the store (room/cursor.json), so no Room writer has to change. A store's first
 * pass starts at the end of the file, and so does the first pass after the file is replaced: history is not backfilled. A post
 * is keyed by its Room id, so a reread is never a copy.
 * NOT ENFORCED: every agent runs as Peter's macOS user and can append any line, so `from` is a claim. Every post is therefore
 * agent-attributed (no authority, never recalled as "Peter said"), and its claimed author leads the remembered text, marked
 * "(claimed)". */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { contentHash } from './memory-quality.mjs'
import { durableWrite, ensureDirectory, readJsonStrict } from './strict-read.mjs'

export const ROOM_PASS = Object.freeze({ bytes: 256 * 1024, lines: 128 })
const NAME = /^[A-Z][A-Z0-9_-]{0,31}$/u
// Every field that reaches the stored object is checked whole, never cut: a cut can leave half an emoji, which the strict
// reader refuses and which marks the whole store incomplete.
const POST_ID = /^[A-Za-z0-9_-]{1,96}$/u
const ORIGIN = /^[A-Za-z0-9_.-]{1,64}$/u
const flights = new Map()

export const defaultRoomLog = (env = process.env) => env.AUKORA_ROOM_LOG?.startsWith('/') ? env.AUKORA_ROOM_LOG : join(homedir(), 'aukora-live', 'room.log')
// Outside remembered/, which holds notes only.
const cursorFile = stateDir => `${stateDir}/room/cursor.json`

/** The header is the one memoryQuality strips, so a bare "ok" in the Room is chained but still kept out of the vector index. */
export const roomStatement = post => `From: ${post.from} (claimed) in the Room${post.to === 'ALL' ? '' : `, to ${post.to}`}\nWhen: ${post.at}\n\n${post.msg}`

function roomPost(line) {
  let post
  try { post = JSON.parse(line) } catch { return null }
  if (!post || typeof post !== 'object' || Array.isArray(post) || Object.hasOwn(post, 'ack')) return null
  const to = post.to ?? 'ALL'
  if (typeof post.id !== 'string' || !POST_ID.test(post.id) || typeof post.msg !== 'string' || !post.msg.trim() || !post.msg.isWellFormed()) return null
  if (typeof post.from !== 'string' || !NAME.test(post.from) || typeof to !== 'string' || !(to === 'ALL' || NAME.test(to))) return null
  if (typeof post.at !== 'string' || !/^[\x21-\x7e]{1,40}$/u.test(post.at) || !Number.isFinite(Date.parse(post.at))) return null
  return { id: post.id, at: post.at, from: post.from, to, msg: post.msg, origin: typeof post.origin === 'string' && ORIGIN.test(post.origin) ? post.origin : null }
}

function readCursor(stateDir, room) {
  try {
    const cursor = readJsonStrict(cursorFile(stateDir))
    return cursor?.room === room && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 ? cursor : null
  } catch { return null }
}
function writeCursor(stateDir, cursor) {
  ensureDirectory(`${stateDir}/room`)
  durableWrite(cursorFile(stateDir), `${JSON.stringify(cursor)}\n`)
}

/** The complete lines after the cursor, read without the Room's lock: a line is appended whole, so only a tail without its
 * newline can be unfinished, and it waits for the next pass. O_NONBLOCK keeps a FIFO planted at the path from stalling the host. */
function unread(stateDir, room) {
  const cursor = readCursor(stateDir, room)
  let fd
  try { fd = openSync(room, constants.O_RDONLY | constants.O_NONBLOCK) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    // Absent on the first pass: everything it holds later is new.
    if (!cursor) writeCursor(stateDir, { room, ino: null, offset: 0 })
    return { posts: [], reason: 'room-absent' }
  }
  try {
    const stat = fstatSync(fd, { bigint: true })
    if (!stat.isFile()) return { posts: [], reason: 'room-not-a-file' }
    const ino = String(stat.ino), size = Number(stat.size)
    if (!cursor) { writeCursor(stateDir, { room, ino, offset: size }); return { posts: [], reason: 'started-at-end' } }
    // Replaced (new inode) or truncated: start at its current end, like a first pass, so old history is never backfilled.
    // A cursor written while the file was absent (ino null) reads the new file from its start: all of it is new.
    if (cursor.ino !== null && (cursor.ino !== ino || cursor.offset > size)) {
      writeCursor(stateDir, { room, ino, offset: size })
      return { posts: [], reason: 'replaced-started-at-end' }
    }
    const offset = cursor.ino === ino ? cursor.offset : 0
    const bytes = Buffer.alloc(Math.min(size - offset, ROOM_PASS.bytes))
    let used = 0
    while (used < bytes.length) {
      const read = readSync(fd, bytes, used, bytes.length - used, offset + used)
      if (read === 0) break
      used += read
    }
    const posts = []
    let end = 0
    for (let lines = 0; lines < ROOM_PASS.lines; lines++) {
      const newline = bytes.indexOf(10, end)
      if (newline === -1 || newline >= used) break
      const line = bytes.subarray(end, newline).toString('utf8')
      end = newline + 1
      const post = roomPost(line)
      if (post) posts.push({ post, lineHash: contentHash(`${line}\n`) })
    }
    // A window with no newline at all is one line larger than any post: skip it rather than stall here forever.
    if (end === 0 && used === ROOM_PASS.bytes) end = used
    return { posts, next: { room, ino, offset: offset + end }, moved: offset + end !== cursor.offset || ino !== cursor.ino }
  } finally { closeSync(fd) }
}

/** One bounded pass. The cursor moves only after the posts it read are chained, paused or filtered; a failed store write
 * leaves it in place for the next pass. Paused capture and private content are dropped for good, as for any other turn. */
export function captureRoom(memory, { stateDir, room = defaultRoomLog() }) {
  if (flights.has(stateDir)) return flights.get(stateDir)
  const flight = Promise.resolve().then(async () => {
    const { posts, next, moved, reason } = unread(stateDir, room)
    if (!next) return { captured: 0, posts: 0, reason }
    let captured = 0
    if (posts.length > 0) {
      const { results } = await memory.rememberBatch(posts.map(({ post, lineHash }) => ({
        text: roomStatement(post), from: 'room', at: post.at, migrationKey: `room\0${room}\0${post.id}`,
        source: { state: 'UNLINKED', cited: false, because: 'Room post: the author is claimed by the line, not proven; no session receipt or authority',
          room, messageId: post.id, at: post.at, from: post.from, to: post.to, origin: post.origin, roomLineHash: lineHash },
      })), { attributedTo: 'agent', prioritize: false })
      captured = results.reduce((sum, result) => sum + result.remembered, 0)
    }
    if (moved) writeCursor(stateDir, next)
    return { captured, posts: posts.length, offset: next.offset }
  }).finally(() => { if (flights.get(stateDir) === flight) flights.delete(stateDir) })
  flights.set(stateDir, flight)
  return flight
}
