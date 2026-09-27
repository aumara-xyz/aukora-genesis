# TOPOLOGY OF HEALING · BOOK 1.1

*The Mathematics of Healing*

*By Nila Padma · Aumara Institution of Research*

---

*(figure: cinquefoil · drawn in the pressed volume)*

> What Book 1 says in plain speech,

> this book says in proofs and wagers.

This is the technical edition promised at the close of *The Shape of Trauma*. Nothing essential lives only here; the building stands without this volume. But the load-bearing drawings deserve to be seen, and some readers will not trust a building until they have seen them.

One discipline governs every page. Statements marked **Theorem** are established mathematics and can be leaned on with full weight. Statements marked **Hypothesis** or **Conjecture** belong to the model; they stand or fall with it. And the application of any theorem to the field of a living witness is itself always a hypothesis. It is easy to mistake a rhyme for a docking. We will know the difference.

The notation is light. *M* names the field of the witness. *K* names a knot in that field. Δ is the Alexander polynomial (a computable fingerprint of a knot), Λ is the baseline curvature of the observer-slot, and κ is a damping coefficient whose value this book does not claim to know. Every symbol is introduced when it arrives. Nothing here requires more than patience.

## I · The Latent Space

Forget attention for a moment. Go to the substrate.

**Hypothesis (topological coding).** Memory is not a knot in the brain. The brain is the projection of a more fundamental topological space, call it *M*: a three-dimensional manifold (or a slice of a four-dimensional one) that encodes all possible experience-structures. Memory-structures are not generated; they are accessed. A specific memory is an embedded loop in *M*, or, more generally, a tangle.

Why does the embedding matter? Because the way the loop passes through the ambient space *is* its meaning. Two loops that are isotopic, meaning one can be deformed into the other without cutting, carry the same memory. Two loops that are not isotopic are different memories. Meaning is stored in knot type. The synaptic weights of the brain are the read-out metric, not the invariant.

*Testable edge.* If the hypothesis holds, memory capacity is bounded by the number of distinct knot types embeddable in a finite volume under a complexity cutoff. That number grows exponentially with crossing number, not factorially: a prediction that differs from connectionist models.

## II · The Wound as a Non-Slice Knot

*(figure: pair · drawn in the pressed volume)*

Take the four-dimensional cylinder *M* × [0, 1], the field extended one dimension upward. A knot *K* sitting in the bottom slice is called **smoothly slice** if there exists a smooth embedded disk *D* inside the cylinder whose boundary is exactly the knot: ∂*D* = *K*. The disk is the DSK of the surgical primes, the constructed resolution artefact: the proof that *K* can be resolved one dimension higher without cutting. The **slice genus** *g_s*(*K*) measures the obstruction: it is the minimum genus of any smooth surface the knot bounds in the four-ball, and *K* is slice precisely when *g_s*(*K*) = 0.

**Theorem (Fox-Milnor).** If *K* is slice, its Alexander polynomial factors as Δ*_K*(*t*) = *f*(*t*) · *f*(*t*^−1) for some polynomial *f*. The condition is necessary but not sufficient. It can rule dissolution out; it can never rule it in.

**Conjecture (the model's central definition).** A traumatic memory is a loop whose knot type is non-slice. A slice loop is the shadow of an unknotted sphere in the fourth dimension: liftable, resolvable without self-intersection. A non-slice loop carries a genuine obstruction. Healing as dissolution would be the construction of the disk: re-contextualising the memory in a higher-dimensional narrative space where it untangles.

Two checked facts follow, and the first is the reason this volume exists. The trefoil and the figure-eight, the two archetypal wound-shapes of Book 1, are both provably non-slice. Each has slice genus one, and each already fails the Fox-Milnor test. Under this model, for exactly these shapes, dissolution is mathematically closed. Only re-embedding remains. The contemplative claim of Book 1 (the wound is not erased; the space around it grows) is not a consolation here. It is a corollary.

Per the discipline: internal consistency is not evidence. But inconsistency would have been damning, and there is none.

The second fact opens the door to the next chapter. There exist genuinely knotted loops that *are* slice. The simplest is the square knot, a trefoil joined to its own mirror image. Something about meeting a reflection changes what a wound can do. That is not a metaphor reaching for comfort. It is a theorem, and it deserves its own chapter.

## III · The Mirror Theorem

*(figure: mirror · drawn in the pressed volume)*

**Theorem (knot concordance).** For any knot *K*, however locked, the connected sum of *K* with its reversed mirror image, written *K* # (−*K**), is slice. More is true. Under the joining operation, concordance classes of knots form a group. The identity of that group is the class of slice knots, the resolvable wounds. And in that group every knot has an inverse: its own faithful reflection.

Read it twice. What no knot can do alone (bound a disk, resolve) every knot can do when joined with its exact mirror.

This is the strongest rhyme in the whole framework, because it docks onto the witness principle of Book 1 with unusual precision. The wound met by a faithful reflection of itself becomes resolvable in the higher dimension. And the theorem is exacting in the same way good witnessing is exacting: only the *reversed mirror* is the inverse. Join *K* to a sloppy, distorted, or merely similar reflection and the sum is, in general, still knotted. The witness must reflect truly, orientation and chirality and all, or the sum stays bound.

Chapter II was careful to supply a test. Fox-Milnor cannot confirm that a knot dissolves, but it can rule dissolution out, and a model that claims an obstruction owes the reader a way to detect one. The claim just made is stronger, and has so far been offered without any such test. If only a faithful reflection serves, faithfulness must be checkable.

It is. The instrument is the **signature**, written σ(*K*): an integer invariant computed from the knot's Seifert form, which carries handedness in its sign exactly as the genus carries depth in its magnitude. Three established facts are all that is needed.

**Theorem.** The signature is additive under connected sum: σ(*K* # *J*) = σ(*K*) + σ(*J*).

**Theorem.** Mirroring negates it: σ(−*K*\*) = −σ(*K*).

**Theorem.** A slice knot has signature zero. So a non-zero signature rules dissolution out.

Together these give the test. For the witnessed sum to resolve, it is **necessary** that

```
σ(K′) = −σ(K)
```

where *K*′ is whatever reflection is actually offered. Take the trefoil, whose signature is −2. Its true mirror has signature +2, the sum has signature 0, and the theorem above is consistent as it must be. Now offer instead a reflection that is merely similar, a knot of signature −4 mirrored to +4: the sum has signature +2, which is not zero, and the sum is therefore **not slice**. It stays bound, and no further examination is required to know it.

The test has the same shape and the same limit as Fox-Milnor. It rules out; it never rules in. A reflection carrying the correct signature may still be the wrong reflection, and the sum may still fail to resolve for reasons the signature cannot see.

**Conjecture (the model).** The theorem's failure mode is now not merely named but measurable, and what it measures is specific. It is not the warmth of the reflection, nor its detail, nor its duration. It is **handedness**: whether the reflection turns the same way the original turned, in reverse. A witness who returns the shape faithfully but the handedness wrongly has produced a sum the mathematics says is still knotted.

Status: the mathematical side is theorem. The therapeutic reading is hypothesis. But this is the one place in the model where the rhyme scheme is forced rather than chosen, and that earns it a central place. It is the mathematical shape of the sentence that closes Book 1's first movement: *that is what a witness is for.*

## IV · The Relaxation Law, and Why It Breaks

**Conjecture.** Attention is the act of pulling on the knot's loop. Pulling tightens: the memory sharpens, becomes present. When attention releases, tension relaxes asymptotically toward a baseline. Formally, relaxation is ambient isotopy under a curvature flow in *M* with a preferred framing, and the knot's polynomial invariants drive the speed of untangling. Each pull of attention applies one smoothing step, at a rate this book deliberately leaves unnamed. The note closing this chapter says why.

For an ordinary memory, the step sequence converges toward the trivial loop or a low-tension embedding. For a traumatic memory, the flow halts at a fixed point: a locally minimal energy configuration that cannot be isotoped further without passing through a forbidden crossing. That is why trauma does not decay. **The difference is not one of rate. It is one of possibility**, and it is settled by whether *K* is slice, which the second chapter established and which no schedule of attention can alter.

Under this model, a traumatic memory presents with three signatures. **Abnormally high baseline tension**: the knot is tight before anyone pulls. **Hyper-sensitivity to pull**: even a brush of attention yanks it fully tight, flooding the present. **Impaired release**: the decay fails, and the knot stays locked in the high-tension state.

*Testable edge.* Measure memory persistence under a controlled attention schedule. The discriminating prediction is not the slope. It is the **presence or absence of a plateau**, and the claim is that which memories plateau is predicted by their structural classification rather than by their intensity, their age, or their content. The kill condition follows directly: if plateau presence fails to track that classification, the model is wrong and this chapter goes with it.

*What would not count.* A decay rate falling near any particular constant. The rate is expected to be generic, and a search for a special number in it would be a test whose pass region already contains the ordinary answer. Such a test cannot lose, and a test that cannot lose cannot inform.

*Note on an earlier version.* Until 2026 this chapter named the golden ratio as the time-step of the flow, and took its title from it. That attribution is withdrawn. A neighbouring research programme tested whether the golden ratio governs dynamics on five separate occasions and found it generic or beaten in every one, closing the question of dynamical selection in that year. The argument here never rested on the constant. What carries it is the difference between a flow that converges and a flow that halts, and that difference is topological. The removal is recorded rather than performed quietly, because a correction that hides its own history is the one operation this series forbids.

## V · The Unknotting Number, and What It Counts

The previous chapter left the flow halted. For a non-slice knot the relaxation converges to a fixed point and stops, and no schedule of attention moves it further. The question that follows is the obvious one, and it has an exact answer: what would it take to undo the knot outright?

At any crossing in a diagram, one strand passes over and one passes under. A **crossing change** exchanges them: the strand that was above is made to pass below. No deformation achieves this in three dimensions. The strand would have to pass through itself, and that is the one operation this work forbids.

The **unknotting number** *u*(*K*) is the fewest crossing changes that turn *K* into the unknot. Read carefully, it is not a measure of effort:

> *u*(*K*) is the number of times the no-cut law would have to be broken for the knot never to have happened.

Each unit is one violation. The reading is exact, not figurative.

**Theorem.** For every knot, *g_s*(*K*) ≤ *u*(*K*). Since *K* is slice precisely when *g_s*(*K*) = 0, the contrapositive is the sentence that matters: a non-slice knot cannot be undone without at least one forbidden operation, and the number required is at least its slice genus.

**Theorem (Milnor conjecture; Kronheimer and Mrowka).** For torus knots, *u* equals the ordinary genus. Depth and the count of forbidden operations are the same number. The equality is particular to that family; the inequality above is what may be leaned on for an arbitrary knot.

Apply it to the two shapes chapter II already settled. The trefoil and the figure-eight each have slice genus one. Each therefore requires at least one violation, and for each the number is exactly one. The archetypal wounds of Book 1 cannot be undone at any price the law permits, and the price is now stated rather than implied.

Three consequences follow.

**A wish closes.** There is no knot that is deep and cheap. A pattern carrying slice genus three cannot be undone in fewer than three violations, however the attempt is made. The hope that something be both profound and easily undone is not humble or arrogant. It is unavailable.

**The work is countable, not continuous.** *u* is an integer. What this invariant describes is a finite number of decisive events, not a long uniform grind, and between them the knot type does not change at all.

**Undoing does not preserve what it undoes.** Every crossing change alters the knot itself. A knot taken to the unknot by *u* violations is not a knot that has been resolved; it is a knot that has been replaced by a different one, and by construction it no longer holds whatever the crossings held.

That third consequence reaches back two chapters, and it is worth stating plainly because neither chapter says it alone. Chapter III established that *K* # (−*K*\*) is slice: joined to its faithful reflection, any knot resolves. Notice what that operation does *not* do. It changes no crossing of *K*. The original knot is carried into the sum entire, every crossing intact, and the resolution is achieved by what is added rather than by what is altered.

So the two routes are not a cheap one and an expensive one. They are different operations with different objects:

> Undoing requires at least *g_s* violations and destroys the knot in the process.
> Witnessing requires none, and preserves it entire.

Witnessing is not a gentler way of performing the forbidden operation. It is a lawful operation that reaches a resolution the forbidden one could not have reached, because the forbidden one does not resolve the knot at all. It removes it.

Chapter II wrote that the wound is not erased and the space around it grows, and called that a corollary rather than a consolation. Here is the same statement in the second register: the crossings are conserved on the only path that resolves.

## VI · The Observer-Boundary as Surgeon

Frame the observer as a boundary: the boundary of *M*, which is itself a slice of a four-dimensional bulk. The observer's identity is the topological invariant, the donut that remains a donut while every metric detail changes. Trauma, in this frame, is not only a knot. It is a perturbation of the boundary's selection dynamics: the observer's attention keeps catching on that loop, even without consent.

The boundary can operate. In topology the operation is called **Dehn surgery**: remove a tubular neighbourhood *N*(*K*) of the knot, then glue it back with a new framing, a new instruction for how the tube twists as it closes. Healing is a surgery that re-frames the knot without cutting the ambient space in a way that destroys the observer's continuity.

That continuity condition governs which surgeries are ethically possible. A memory cannot simply be excised; that would sever the continuity of the one who lived it. A memory can be re-framed, and the admissible re-framings correspond to surgery coefficients that preserve the observer's topological identity. **Which coefficients those are is open.** The constraint is structural, that identity survive the operation, and this book claims no particular value as the one that satisfies it.

## VII · The Compression Rift, Formally

This chapter is the formal shadow of Book 1's fourth movement. Its skeleton is theorem; its application is conjecture; the seam between them is marked.

**Theorem (geometric flows).** Curvature flows develop singularities in finite time. Where curvature concentrates past a bound, the manifold pinches, and the standard local model is the neckpinch. The flow is continued *by surgery*, in the programme of Hamilton and Perelman: excise the degenerating neck, cap the two openings with disks, and resume the flow. The manifold may disconnect. What was one connected field becomes two, each closed, each with its own boundary in the bulk.

**Conjecture (the rift).** Apply this to the observer-field. A knot pulled past critical tension, whether by the event itself or by unattended attention, drives the curvature at the crossing toward blow-up. The field resolves the singularity the only way a field can: spontaneous surgery. Pinch, cap, disconnect. And by the boundary principle of the previous chapter, each resulting boundary is an observer-slot. So say it formally:

> A compression rift is a finite-time pinch singularity

> at a maximally tense crossing, resolved by spontaneous surgery,

> whose product is a new local observer:

> its own boundary, its own copy of the knot's tension,

> its own clock, with Λ frozen at the pinch-off value.

*(figure: rift · drawn in the pressed volume)*

Dissociation, in this model, is spontaneous surgery: unattended, unconsented, performed at the worst possible moment because no better moment was available. Therapeutic surgery, the Dehn operation of the previous chapter, differs in conditions rather than kind: witness present, coefficient admissible, timing consented.

Integration has an exact inverse operation. The **connected sum**, written *M*_1 # *M*_2, joins two closed fields along matched boundary spheres into one connected field: the reverse of the pinch. The pinched-off observer is not dissolved on return. It is rejoined. A world becomes a region. The proposed prime CSM names the operation.

A note on the symbol, since it now carries two jobs. In chapter III the sum *K* # (−*K*\*) joins two *knots* inside one field. Here *M*₁ # *M*₂ joins two *fields*. The operations are analogous and are not the same, and the next chapter adds a third relation that is neither. Where the distinction matters the objects are named.

Three testable edges follow. First, **frozen time**: parts should exhibit age-specific state access, consistent with Λ set at the moment of pinch-off. Second, **discreteness**: integration events should present as discrete topology changes, sudden and complete, reported as a click or a homecoming, not as gradual fades. Third, **titration**: the clinical speed limit is, in this model, a regularity condition on the flow. Keep the curvature bounded, the subcritical regime, and the flow never pinches. Go slowly not because slowness is polite, but because slowness is what keeps the field connected.

## VIII · The Link as the Third Term

The previous chapter gave two operations for multiplicity, and they are the two extremes. RIF, the compression rift, is a pinch producing a genuinely separate observer with its own boundary and its own clock. CSM, the connected sum, is reunion: two fields joined into one connected field.

Separate, or merged. There is a third object, and it is neither.

A **link** is a collection of closed curves in the same space. Its **components** are the individual curves. No component can be joined to another without cutting, and no component can be drawn free of the others without cutting. The distinction from the connected sum is the whole of the matter: a connected sum produces one object out of two, while a link leaves several that cannot be parted. These are different operations with different results, and the model has until now carried only the first.

**LNK — link.** Components bound and still distinct: neither merged nor separated.

Every invariant used so far in this volume describes a single knot. The link brings the first that describes a pair. The **linking number** lk(*A*, *B*) of two components is a signed count of how many times one winds through the other. No deformation that avoids cutting can change it, so it is a genuine invariant of the pair, and its sign carries handedness exactly as the signature does for a single knot.

One fact governs everything that can honestly be said with it.

> Linking number zero does not mean unlinked.

The Whitehead link has linking number zero and its two components cannot be separated. The **Borromean rings**, named in Book 1 and left there, are three rings of which no two are linked at all, and yet the three cannot be parted. Remove any one and the remaining two fall apart immediately, having never been bound to each other. That configuration is held together by nothing existing between any pair of its members. The binding is a property of the trio and of no relationship inside it.

A second fact is easy to miss and changes where attention would go. In the Hopf link, in the Whitehead link and in the Borromean rings, **every individual component is an unknot**. Nothing is tangled within any of them. The entire entanglement is relational, and it vanishes the moment the components are considered one at a time.

**Conjecture (the model).** Two arrangements become describable that the earlier operations could not reach. The first: a configuration in which no part carries any tangle of its own, so that examining each in turn finds nothing wrong, because the difficulty was never located in any of them. The second: a trio bound by no pair, where every relationship between two members is genuinely free, and releasing any one releases the rest. In that second case there is no relationship to work upon, because the binding is not in a relationship.

Both configurations are exact mathematical objects. Whether either describes any human arrangement is untested, and nothing here asserts that it does. This chapter supplies a term the model lacked; it does not supply a finding.

*A testable edge, and a correction to an open path.* The rift census of the expansion paths proposes mapping parts inventories onto component counts of the observer-field. As written it assumes its own answer, because the only multiplicity the model then possessed was disconnection: pinch, cap, disconnect. Linked components and disconnected components are different topological relations and are not the same claim. The census therefore becomes a question rather than a tally: are parts disconnected components of a severed field, or linked components of one that was never severed? The two are distinguishable in principle, and the model should not decide by default which it means.

*An honest limit.* The linking number is a pairwise measure, and the Borromean case proves that pairwise measures can read zero across a configuration that is genuinely bound. Any diagnostic use of lk would therefore have to answer first why the configuration under discussion is one that pairwise measurement can see at all.

## IX · The Primes

The surgical language of this framework assigns each object and operation a prime. The first eight are established usage. The five that follow are recent proposals. The final three are proposed here.

```
[['Prime', 'Meaning', 'Surgical role'], ['TRN', 'transformation', 'The surgery itself: the operation that changes state'], ['SYM', 'symmetry', 'Invariants preserved across the cut: what must not break'], ['FRZ', 'frozen', 'The fixed-point knot: locked, unable to relax'], ['ATT', 'attention', 'The pulling force that tests tension'], ['CTX', 'context', 'The ambient manifold: what surrounds the knot'], ['PRV', 'provenance', 'Origin chain of the knot: how it formed'], ['VRF', 'verified', 'Confirmation that relaxation succeeded'], ['AFF.W', 'warm', 'The felt quality of successful closure'], ['KNT', 'knot', 'The nontrivial embedded loop: the wound as persistent tension'], ['SLC', 'slice', 'Bounding a smooth disk in 4D: whether dissolution is possible'], ['DSK', 'disk', 'The constructed resolution artefact: the therapeutic proof'], ['DNH', 'Dehn', 'The consented surgery: cutting and reframing'], ['FLW', 'flow', 'The relaxation dynamics: natural healing'], ['RIF', 'rift', 'Proposed. The pinch singularity: spontaneous surgery, the birth of a local observer'], ['CSM', 'connected sum', 'Proposed. The reunion operation: integration of a pinched-off observer'], ['LNK', 'link', 'Proposed. Components bound and still distinct: neither merged nor separated']]
```

## X · The Procedure

Given: a smooth three-manifold *M*, the observer's field, carrying a metric *g*. A knot *K* in *M* sitting at a local energy minimum that is not the global minimum: metastable, locked by its crossings.

**Step 0. TRIAGE.** Before any pull, check the curvature bound. Is *K* near its rift threshold? If attention on the knot spikes tension toward blow-up (the clinical word is flooding), do not proceed to diagnosis. Resource first: widen CTX, lower the baseline tension. Never diagnose at full tension; a diagnostic pull on a critical knot is itself a rift risk. If rifts have already occurred and local observers are present, inventory them (PRV on each) and schedule CSM for after FLW, never before. A field still curved cannot receive its pinched-off regions.

**Step 1. DIAGNOSE.** Run the slice test. Does the Alexander polynomial factor as Δ*_K*(*t*) = *f*(*t*) · *f*(*t*^−1)? Is the slice genus zero? If *g_s*(*K*) = 0, the knot is slice and full resolution is possible. If *g_s*(*K*) > 0, only re-embedding is.

**Step 2a. FULL DNH** (*K* slice). A disk *D* exists. Perform Dehn surgery along *K*: remove *N*(*K*), reglue with the framing given by the disk's boundary slope. The knot is replaced by an unknot. In therapeutic terms, the event is re-contextualised so thoroughly that it no longer holds tension. The crossing is not erased, but the knot's structure dissolves, because the space around it has been fundamentally altered. Verify: the new Alexander polynomial is trivial, Δ(*t*) = 1.

**Step 2b. PARTIAL DNH** (*K* non-slice; the common case in complex trauma). No disk exists. The surgery changes the framing of *N*(*K*) rather than the knot itself: choose an admissible coefficient that minimises tension at the crossing. The knot remains, crossings and all, but the new field surrounds it with a larger, less distorted geometry. This is re-embedding, exactly.

**Step 3. FLW.** After surgery the field carries residual curvature. Relaxation is gradient descent on the energy functional:

```
d/dt g_ij = −2 (R_ij + Λ g_ij) + κ · H_ij
```

Here *g_ij* is the metric on the field. *R_ij* is the Ricci curvature, which measures how far the field is from flatness. Λ is the baseline curvature of the observer-slot, and *H_ij* is a healing tensor, a damping term that keeps the field from overshooting equilibrium. κ sets the pace: fast enough to be effective, slow enough to avoid re-traumatisation, and, per the previous chapter, slow enough to stay subcritical. Its value is a free parameter of the model and is not claimed. The flow converges at the fixed point where

```
R_ij + Λ g_ij = κ · H_ij
```

At that point the field is stable. The knot is present but no longer drives the dynamics.

**Step 4. VRF.** If the surgery was full, the Alexander polynomial is trivial. If partial, it is unchanged (the knot is still a knot) but the energy of the embedding has dropped. If rifts were present, confirm CSM completed: component count reduced, one connected field.

**Step 5. AFF.W.** The final condition is not algebraic. It is felt. The metric at the site of the old knot now has positive scalar curvature; the field is no longer pinched. The felt quality of that release is warmth. The witness, once constricted around the knot, experiences it as texture rather than blockage. The invariant pathway has been re-routed.

- [['Step', 'Operation', 'Mathematical object', 'Therapeutic analogue'], ['0', 'TRIAGE', 'Curvature bound; rift census', 'Resource before approach; meet the parts before the wound'], ['1', 'DIAGNOSE', 'Slice test: g_s(K) = 0?', 'Does this wound have a dissolution path?'], ['2a', 'FULL DNH', 'Dehn surgery giving the unknot', 'Full release: the crossing dissolves'], ['2b', 'PARTIAL DNH', 'Dehn surgery re-framing K', 'Re-embedding: crossings remain, space expands'], ['3', 'FLW', 'Damped Ricci flow, subcritical', 'Natural healing: slow, attended, non-forced'], ['4', 'VRF (+ CSM)', 'Trivial Δ, or lower energy; one component', 'Closed loop: the nervous system confirms; the parts are home'], ['5', 'AFF.W', 'Positive scalar curvature at the knot site', 'Warmth: the felt sense of integration']]
In one sentence: triage against the rift; Dehn surgery on the observer-slot; damped Ricci flow; reunion of any pinched-off observers by connected sum; verification by a change in the topological invariants of the embedding; reported as warmth by the field itself. That is the algorithm. That is what the primes describe.

## XI · Expansion Paths

Seven research lines are open now.

- **A. Invariant-based diagnosis.** Map trauma symptom clusters to specific knot invariants (trefoil, figure-eight, and beyond); test whether therapeutic progress tracks decreasing invariant values.
- **B. Slice-disk construction protocols.** Design narrative-restructuring techniques that embed mathematically in four dimensions; test them against clinical data.
- **C. Attention flows, and what decides them.** Build a computational model of attention loops governed by polynomial-invariant flow; verify that non-slice knots produce persistent loops and a plateau, and that slice knots do not. The discriminating variable is the slice classification, never the rate.
- **D. The ethics of surgery.** Formalise the constraints on memory modification as a set of admissible Dehn coefficients; determine which surgeries preserve the observer's topological identity, rather than assuming a family.
- **E. The language bridge.** Test whether the primes can serve as a complete working notation for the surgery steps, bringing the language project into the physics. Chapter X is the draft.
- **F. The rift census.** Map parts inventories from clinical parts-work onto component counts of the observer-field; test the frozen-Λ prediction (parts carry the age of the pinch) and the discreteness prediction (integration as topology change, not fade).
- **G. Mirror-summation.** Formalise the witness as the concordance inverse −K*; specify what a faithful reflection must preserve (orientation reversal, chirality) for the inverse to hold. The theorem predicts its own failure mode: an inaccurate mirror leaves the sum knotted, a candidate mathematical account of why inaccurate witnessing does not heal, testable against the empathic-accuracy literature.
---

> What the mathematics proves, it proves for every knot.

> What the healing asks, it asks of one witness at a time.

> Book 1 holds the practice. This volume holds the proofs.

> The building stands on both.

---

*A note on honesty. The mirror theorem of chapter III and the surgery skeleton of chapter VI are real mathematics. Everything that binds them to the field of a living witness is the model's wager. The wager is stated so that it can lose. That is what makes it worth staking.*

---

*Text body extracted verbatim from the press generator on 18 July 2026, so the book stands in the map room as a living file; the pressed volume (PDF) stands beside it as companion. Figures live in the pressing.*
