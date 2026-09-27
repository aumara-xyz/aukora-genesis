// The application page's half of AUMLOK: TWO READS, ONE CROSSING, AND NOTHING THAT OPENS ANYTHING.
//
// WHAT CROSSES HERE, AND WHAT DOES NOT. `draw` brings the seven words from the shell to THIS PAGE for
// display; `submit` takes the typed words back. That is the whole of the phrase's journey, and both
// verbs are mounted on the application window only — the main process checks the sender on every
// channel, so another window that guessed these names reaches a refusal and not a word.
//
// THE WORDS ARE SHOWN FROM THE SHELL. They are drawn in the main process out of the word lists the
// release ships, not fetched from the backend and not rendered from a list this page holds: the plan
// says the words come from the shell, and a page that could draw its own phrase would be a second
// generator. This file therefore has no word list, no generator and no randomness of its own.
//
// NOTHING HERE KEEPS A PHRASE EITHER. Each verb hands its argument straight to `ipcRenderer.invoke`
// and returns the reply; there is no variable, no cache, no queue and no log line in this file that
// could hold a word. `submit` passes the typed array through AS TYPED and reads nothing out of it.
//
// IT IS DELIBERATELY NOT A `bind()` THAT DOES NOTHING. A stub returning success for a ceremony that
// never ran is worse than no verb at all: the screen would report a binding that does not exist. The
// face's own reader requires every verb it needs to be present, so a missing verb renders no control
// rather than a control that lies.
//
// AND THERE IS NO THIRD VERB. v2 exposed verbs that opened a separate native window and held signing
// open for a fixed period; that window does not exist any more, and neither does its verb. A shell
// that carried one would be offering a surface the spec removed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aukoraAumlok', {
  available: true,
  /** The shell's public state: the adapter's binding and the signing session's status. */
  state: () => ipcRenderer.invoke('aumlok:approval:state'),
  /**
   * Draw the seven words for one ceremony, once, for display on this page.
   * @param {string} intent - which ceremony is being started: `bind` or `refresh`.
   * @returns {Promise<{ok: boolean, words?: string[], reason?: string}>} the words, or the shell's
   *   own reason. The words are in order, anchor first, and are seven lower-case words or nothing.
   */
  draw: (intent) => ipcRenderer.invoke('aumlok:approval:draw', intent),
  /**
   * Hand the typed words back and resolve with the shell's verdict.
   *
   * THE HANDLE CROSSES WITH THE WORDS, AND IT IS NOT A SECRET. X8 derives the key from the handle and
   * the seven words together, so the second half of the key travels the same way the first does: typed
   * on this page, passed through as typed, kept nowhere here. It is public — it is recorded in the
   * public record and it is what a NIP-05 `name@domain` local part is read from — so nothing on this
   * path has to protect it; the words beside it are the half that must not be logged.
   * @param {string} intent - which ceremony the words belong to.
   * @param {readonly string[]} words - the seven typed words, in order, anchor first.
   * @param {string|undefined} handle - the person's public handle, as typed.
   * @returns {Promise<{ok: boolean, reason?: string}>} whether the words were the ones drawn, and the
   *   shell's own reason when they were not. NO REPLY ON THIS PATH CARRIES A PHRASE BYTE.
   */
  submit: (intent, words, handle) =>
    ipcRenderer.invoke('aumlok:approval:submit', { intent, words, handle }),
})
