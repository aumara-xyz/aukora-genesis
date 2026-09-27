// The approval window's half of the bridge: TWO verbs, and neither can return a phrase.
//
// THE WINDOW ASKS WHAT IT IS ANSWERING AND THEN ANSWERS IT. `question` reads the public facts of the
// pending approvals — A QUEUE, because a second request now WAITS by name instead of being refused — and
// `answer` sends back ONE BIT plus the challenge it is answering, which is what keeps a click bound to ONE
// named operation now that more than one can be waiting. There
// is no channel name here, no submit, no word list and no way to name a ceremony: a page that could
// reach any of those by guessing a string would be a second way to authorize a signature, and this
// file exists so there is exactly one.
//
// THE PAGE THIS SERVES IS LOCAL AND CARRIES NO SCRIPT IT DID NOT SHIP. It is loaded with `loadFile`
// from the shell's own directory, it navigates nowhere (the window denies both navigation and new
// windows), and it needs no code from the backend — which is the point, because the answer this
// window gives ends in a signature.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aukoraApproval', {
  available: true,
  /** The public facts of the one pending question, or the shell's own refusal. */
  question: () => ipcRenderer.invoke('aumlok:approval:ask'),
  /**
   * THE ONE BIT. `challenge` is REQUIRED and is echoed back, so an answer that arrives after its
   * question was replaced cannot be applied to the new question.
   * @param {{challenge: string, approve: boolean}} answer - what the person decided.
   */
  answer: answer => ipcRenderer.invoke('aumlok:approval:answer', answer),
})
