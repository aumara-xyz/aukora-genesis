export class TurnWindow {
    maxPairs;
    pairs = [];
    constructor(maxPairs = 5) {
        this.maxPairs = maxPairs;
    }
    push(userText, assistantText) {
        this.pairs.push({ user: userText, assistant: assistantText });
        while (this.pairs.length > this.maxPairs)
            this.pairs.shift();
    }
    /** Messages for the NEXT call: prior pairs then the new user turn. */
    messages(newUserText) {
        const out = [];
        for (const p of this.pairs) {
            out.push({ role: 'user', content: p.user });
            out.push({ role: 'assistant', content: p.assistant });
        }
        out.push({ role: 'user', content: newUserText });
        return out;
    }
}
