"""Bounded shell/workflow contracts; no Diamond court or demo scenarios run here."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "scripts/stranger-demo.sh"
WORKFLOW = ROOT / ".github/workflows/diamond.yml"


class CiCompositionTests(unittest.TestCase):
    def test_unknown_arguments_refuse_before_output_deletion(self):
        with tempfile.TemporaryDirectory(prefix="stranger-args-") as temporary:
            root = Path(temporary)
            outputs = [root / "a", root / "b"]
            for output in outputs:
                output.mkdir()
                (output / "retained.txt").write_text("preserve me")
            env = dict(os.environ, STRANGER_OUT=str(outputs[0]), STRANGER_OUT_B=str(outputs[1]))
            for args in (("--unknown",), ("--scenarios-only", "--unknown"), ("",)):
                with self.subTest(args=args):
                    run = subprocess.run(["bash", str(DEMO), *args], env=env,
                                         capture_output=True, text=True, timeout=5)
                    self.assertEqual(run.returncode, 2, run.stdout + run.stderr)
                    self.assertIn("Usage:", run.stderr)
                    self.assertNotIn("GREEN", run.stdout)
                    for output in outputs:
                        self.assertEqual((output / "retained.txt").read_text(), "preserve me")

    def seal_fragment(self, scenarios_only):
        source = DEMO.read_text()
        # Execute the actual final shell branch with an inert seal command.
        tail = source[source.index("# ── 8. Diamond seal"):]
        with tempfile.TemporaryDirectory(prefix="stranger-seal-") as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            seal = root / "scripts/diamond.sh"
            seal.write_text('#!/usr/bin/env bash\n[[ "$AUKORA_COURT_SKIP_MUTANTS" == 1 ]] || exit 3\necho SEAL_STUB_CALLED\n')
            seal.chmod(0o700)
            setup = ('set -euo pipefail\nROOT="$PWD"\n'
                     'banner() { printf "%s\\n" "$*"; }\n'
                     'step() { printf "%s\\n" "$*"; }\n'
                     f'SCENARIOS_ONLY={scenarios_only}\n')
            return subprocess.run(["bash", "-c", setup + tail], cwd=root,
                                  capture_output=True, text=True, timeout=5)

    def test_default_demo_keeps_its_existing_seal(self):
        self.assertIn("SCENARIOS_ONLY=0", DEMO.read_text())
        run = self.seal_fragment(0)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("SEAL_STUB_CALLED", run.stdout)
        self.assertIn("STRANGER-DEMO: GREEN", run.stdout)
        self.assertNotIn("STRANGER-SCENARIOS:GREEN", run.stdout)

    def test_partial_demo_never_claims_full_seal(self):
        run = self.seal_fragment(1)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertNotIn("SEAL_STUB_CALLED", run.stdout)
        self.assertNotIn("STRANGER-DEMO: GREEN", run.stdout)
        self.assertIn("DIAMOND SEAL: NOT RUN", run.stdout)
        self.assertIn("STRANGER-SCENARIOS:GREEN", run.stdout)

    def test_ci_keeps_full_court_and_scopes_cancellation_to_new_pr_heads(self):
        text = WORKFLOW.read_text()
        commands = [line.strip() for line in text.splitlines()]
        self.assertEqual(commands.count("./scripts/diamond.sh"), 1)
        self.assertEqual(commands.count("./scripts/stranger-demo.sh --scenarios-only"), 1)
        self.assertLess(commands.index("./scripts/diamond.sh"),
                        commands.index("./scripts/stranger-demo.sh --scenarios-only"))
        self.assertNotIn("AUKORA_COURT_SKIP_MUTANTS", text)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' && github.run_attempt == 1 }}", text)
        self.assertIn("format('run-{0}-{1}', github.run_id, github.run_attempt)", text)
        self.assertIn("format('pr-{0}', github.event.pull_request.number)", text)
        self.assertIn("timeout-minutes: 45", text)
        for command in (
            "python3 scripts/verify-v3-genesis-acceptance.py",
            "python3 -B tests/aumlok-approval/test_aumlok_approval.py",
            "python3 scripts/verify-genesis-minted-acceptance.py",
            "python3 -B scripts/verify-cold-distillation.py",
            "python3 scripts/verify-composition-base.py",
            "python3 -m diamond.simulated_device --out out-b3c",
            "python3 tests/pinned-contract/test-pinned-contract.py",
            'tests/kira-evidence/run-empty-dir-arms.sh "$RUNNER_TEMP/kira-empty-dir"',
            "python3 -B tests/kira-artifact/test_kira_artifact.py",
            'tests/kira-artifact/run-empty-dir-arms.sh "$RUNNER_TEMP/kira-artifact"',
        ):
            self.assertEqual(commands.count(command), 1, command)


if __name__ == "__main__":
    unittest.main()
