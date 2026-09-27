// The lane-card window's half of the bridge: TWO verbs, and neither can carry a message.
//
// THE WINDOW ASKS WHAT IS WAITING AND THEN SAYS WHICH BUTTON WAS PRESSED. `pending` reads the one card
// the door issued, as the VIEW the shell already built (`lane-card-view.mjs`), and `act` sends back WHICH
// ACT and WHICH NONCE. That is the whole surface.
//
// WHY THERE IS NOTHING ELSE HERE, AND WHY THAT IS THE DESIGN RATHER THAN AN OMISSION:
//
//   * NO VERB TAKES TEXT. The page cannot send a message, cannot edit one, and cannot name a lane. **The
//     door re-reads the text from where the request is held**, so a page that could pass text would be a
//     second way to say what gets sent — and the card exists so there is exactly one.
//   * NO CHANNEL NAME IS CONSTRUCTED HERE. A page that could reach an arbitrary main-process handler by
//     guessing a string would have the run of the shell; two fixed names is the whole vocabulary.
//   * `act` CARRIES THE NONCE, and the nonce is what makes a press attributable to ONE card. Without it a
//     press that arrived after its card was replaced could be applied to the new one.
//
// THE PAGE THIS SERVES IS LOCAL AND CARRIES NO SCRIPT IT DID NOT SHIP. It is loaded with `loadFile` from
// the shell's own directory, it navigates nowhere, and it needs no code from the backend — which is the
// point, because a press here ends in a message reaching a lane.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('laneCard', {
  available: true,
  /** The one pending card, as the render model, or null when nothing is waiting. */
  pending: () => ipcRenderer.invoke('aukora:lane-card:pending'),
  /**
   * WHICH BUTTON, AND WHICH CARD. `action` is `send` or `decline`; `nonce` names the card being acted on.
   * @param {{action: 'send'|'decline', nonce: string}} press - the act and the card it acts on.
   */
  act: press => ipcRenderer.invoke('aukora:lane-card:act', press),
})
