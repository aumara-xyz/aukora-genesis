# A CYPHERPUNK'S MANIFESTO

*Three years before the Declaration, and the more durable document. Where
one proclaimed a territory, this one specified a mechanism; where one
addressed the adversary, this one addressed the builders. It named the
captor the Declaration missed, and it named it three years earlier, by
reasoning from the mechanics of information rather than from the politics
of a decade. Kept whole and unaltered, with the room's reading set after it
rather than over it.*

## THE TEXT, AS PUBLISHED

*A Cypherpunk's Manifesto*, by Eric Hughes. 9 March 1993. Reproduced in full
and without alteration, including its own spellings.

Privacy is necessary for an open society in the electronic age. Privacy is not secrecy. A private matter is something one doesn't want the whole world to know, but a secret matter is something one doesn't want anybody to know. Privacy is the power to selectively reveal oneself to the world.

If two parties have some sort of dealings, then each has a memory of their interaction. Each party can speak about their own memory of this; how could anyone prevent it? One could pass laws against it, but the freedom of speech, even more than privacy, is fundamental to an open society; we seek not to restrict any speech at all. If many parties speak together in the same forum, each can speak to all the others and aggregate together knowledge about individuals and other parties. The power of electronic communications has enabled such group speech, and it will not go away merely because we might want it to.

Since we desire privacy, we must ensure that each party to a transaction have knowledge only of that which is directly necessary for that transaction. Since any information can be spoken of, we must ensure that we reveal as little as possible. In most cases personal identity is not salient. When I purchase a magazine at a store and hand cash to the clerk, there is no need to know who I am. When I ask my electronic mail provider to send and receive messages, my provider need not know to whom I am speaking or what I am saying or what others are saying to me; my provider only need know how to get the message there and how much I owe them in fees. When my identity is revealed by the underlying mechanism of the transaction, I have no privacy. I cannot here selectively reveal myself; I must always reveal myself.

Therefore, privacy in an open society requires anonymous transaction systems. Until now, cash has been the primary such system. An anonymous transaction system is not a secret transaction system. An anonymous system empowers individuals to reveal their identity when desired and only when desired; this is the essence of privacy.

Privacy in an open society also requires cryptography. If I say something, I want it heard only by those for whom I intend it. If the content of my speech is available to the world, I have no privacy. To encrypt is to indicate the desire for privacy, and to encrypt with weak cryptography is to indicate not too much desire for privacy. Furthermore, to reveal one's identity with assurance when the default is anonymity requires the cryptographic signature.

We cannot expect governments, corporations, or other large, faceless organizations to grant us privacy out of their beneficence. It is to their advantage to speak of us, and we should expect that they will speak. To try to prevent their speech is to fight against the realities of information. Information does not just want to be free, it longs to be free. Information expands to fill the available storage space. Information is Rumor's younger, stronger cousin; Information is fleeter of foot, has more eyes, knows more, and understands less than Rumor.

We must defend our own privacy if we expect to have any. We must come together and create systems which allow anonymous transactions to take place. People have been defending their own privacy for centuries with whispers, darkness, envelopes, closed doors, secret handshakes, and couriers. The technologies of the past did not allow for strong privacy, but electronic technologies do.

We the Cypherpunks are dedicated to building anonymous systems. We are defending our privacy with cryptography, with anonymous mail forwarding systems, with digital signatures, and with electronic money.

Cypherpunks write code. We know that someone has to write software to defend privacy, and since we can't get privacy unless we all do, we're going to write it. We publish our code so that our fellow Cypherpunks may practice and play with it. Our code is free for all to use, worldwide. We don't much care if you don't approve of the software we write. We know that software can't be destroyed and that a widely dispersed system can't be shut down.

Cypherpunks deplore regulations on cryptography, for encryption is fundamentally a private act. The act of encryption, in fact, removes information from the public realm. Even laws against cryptography reach only so far as a nation's border and the arm of its violence. Cryptography will ineluctably spread over the whole globe, and with it the anonymous transactions systems that it makes possible.

For privacy to be widespread it must be part of a social contract. People must come and together deploy these systems for the common good. Privacy only extends so far as the cooperation of one's fellows in society. We the Cypherpunks seek your questions and your concerns and hope we may engage you so that we do not deceive ourselves. We will not, however, be moved out of our course because some may disagree with our goals.

The Cypherpunks are actively engaged in making the networks safer for privacy. Let us proceed together apace.

Onward.

Eric Hughes ~

## I · THE SPECIFICATION AND THE PROCLAMATION

The two founding texts of this movement sit three years apart and differ in
method more than in belief. One declares, the other specifies. One addresses
the adversary, the other addresses the builders. One asserts a territory,
the other describes a mechanism. The Declaration contains no terms at all;
this document is almost entirely terms, and it closes on a list of things
to build: anonymous mail forwarding, digital signatures, electronic money.

The consequence shows in the one place it matters most. This manifesto names
its adversary as governments, corporations, or other large and faceless
organisations, on the plain ground that it is to their advantage to speak of
us and they should be expected to do so. It catches, in 1993, the captor
that [A Declaration of the Independence of
Cyberspace](#/declaration-of-the-independence-of-cyberspace) would miss
three years later, and it catches it without prophecy. The reasoning runs from the
mechanics of information rather than from the political frame of the decade,
and a physics does not care who is holding it.

That is the transferable lesson, and it is worth stating flatly: naming an
enemy dates a document the moment the enemy changes, while describing a
floor does not. This chart is the evidence that the method works, and its
neighbour is the evidence of what happens otherwise.

## II · SELECTIVE REVELATION

The load-bearing sentence is the definition, and it is more precise than
most of what has been written since: privacy is not secrecy, but "the power
to selectively reveal oneself to the world".

That definition describes the seed exactly. A cast made in this work is
private by construction, since nothing is stored and nothing is transmitted.
Should the caster choose to reveal it, twenty characters are published and
any other instrument reconstructs the reading perfectly: full fidelity, at
the holder's election, disclosing precisely the one thing chosen and nothing
adjacent to it. The convergence was not taken from the manifesto. It falls
out of the rule that a reading is derived and never stored, and it arrives
at the same place.

The transaction rule lands the same way. Each party should hold only what
the dealing requires; the instrument's server holds nothing whatever, which
is the limit case rather than a compromise. And the closing technical point,
that revealing identity with assurance when the default is anonymity
requires a cryptographic signature, describes the function of the key
ceremony this work is built around: an Ed25519 key held by the person it
names, never in the repository, and no write authorised without it.

The sharpest instruction, though, is the shortest one. Cypherpunks write
code, because a manifesto defends nobody. The discipline here is the same
instinct in a different material: laws enforced by test pins rather than
values recorded in a document, on the reasoning that a claim which cannot be
checked will drift, and a claim which can be checked will not.

## III · WHERE THE MODEL DOES NOT REACH

The world this manifesto describes is one of transactions between parties
who need not know one another. Its model is cash: no relationship, no
memory, no continuity. The unit is the exchange, and anonymity is the
resting state.

A community inverts every one of those. Its unit is the relationship, and a
relationship is made of exactly the persistent memory the anonymous system
exists to prevent. People who know each other over time, under names that
accumulate a history, are not conducting transactions.

The two pull against each other, and honestly. Anonymity defends against
surveillance and it also dissolves accountability, and accountability is
what makes a small room habitable rather than merely private. This document
has nothing at all to say about someone behaving cruelly in a forum; its
answer to bad conduct is untraceability and exit, which is a good answer for
a payment and a poor one for a neighbourhood.

The seam is structural rather than a difference of temperament, and it runs
through any coalition drawing on both the cryptographic and the communal
traditions at once. It is better surfaced early than discovered the first
time someone is harmed.

## IV · THE FIGHT WON, AND THE FIGHT LEFT OPEN

The technical campaign was won outright. Strong cryptography is ordinary,
the export wars are over, and digital signatures and anonymous electronic
cash both exist and work.

Surveillance arrived anyway, and the reason is that the threat model was
disclosure while the actual mechanism was volunteering. Nothing was broken.
People handed everything across cheerfully in exchange for convenience, and
encryption has no answer to a willing donor. Private messaging is free,
excellent, and a minority pursuit.

So the cypherpunks solved cryptography and left the economics and the
psychology untouched, and that untouched ground is where the present work
stands. The open question is not how to make privacy possible. It is why
anyone would choose it while the surveilled option remains smoother, which
is a question about design, pleasure and belonging rather than about
ciphers.

One line deserves its own note. Information is described here as rumour's
younger and stronger cousin: fleeter of foot, many-eyed, knowing more and
understanding less. It was written in 1993, and it remains the most exact
single sentence about the network that actually arrived.

## PROVENANCE

*Set down 25 July 2026 at the architect's word, as the companion entry to
[A Declaration of the Independence of
Cyberspace](#/declaration-of-the-independence-of-cyberspace) and the third of the
movement's founding statements held on this shelf, beside [The Pro-Human AI
Declaration](#/pro-human-ai-declaration). The manifesto is reproduced above
in full and without alteration, including its own spellings. Its licence is
recorded honestly rather than assumed: no explicit grant from the author was
located, unlike the Creative Commons Attribution licence carried by the
Declaration's canonical copy; what is verifiable is that the text was
published to a public mailing list on 9 March 1993 and has been openly
mirrored since, and that the document's own stated ethic is unrestricted
publication. Everything after the text is the room's own reading: the
contrast of method with the Declaration, the definition of privacy as
selective revelation and where it meets this work, the seam between the
transactional and the communal, and the fight that was won beside the one
left open. The deck enters nowhere. Nothing here predicts, and nothing here
prescribes.*
