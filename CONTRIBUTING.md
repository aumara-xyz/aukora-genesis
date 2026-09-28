# Contributing

Open an issue to discuss a change, or fork this repository and send a patch as a proposal.
Include the problem, the proposed behavior and the checks you ran.

The project's rule is that `main` moves only through the owner's approval: `scripts/aukora/self-change.mjs`
or MOVE MAIN (`scripts/aukora/advance.mjs`), signed by a key held in the Airlock. The owner applies outside
patches through that route. GitHub does not enforce this rule: the macOS user holds push credentials and
a direct push is not stopped. A signature identifies the approving key; attendance is reported, not proven.

This is a known founder bottleneck. The project intends to generalize the approval process beyond the founder;
there is no promised date.

Run `sh scripts/check.sh` from the repository root on macOS with Python 3, Node.js 22, Perl and a command-line
C compiler. CI runs the same checks on every push. Read each result: a passing total checks repository fixtures,
not the installed app, and the box check can report SKIPPED or NOT RUN.

For security reports, open a GitHub security advisory.
