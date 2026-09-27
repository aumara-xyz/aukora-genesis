"""Defensive acceptance controls: source pins precede execution; empty tests fail."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("alpha_runner", ROOT / "scripts/verify-alpha-profile.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.profile = self.root / "alpha"
        shutil.copytree(ROOT / "profiles/alpha", self.profile,
                        ignore=shutil.ignore_patterns("__pycache__"))
        for name, value in (("PROFILE", self.profile), ("SRC", self.profile / "src"),
                            ("REPO", self.root), ("FAILURES", 0)):
            p = patch.object(runner, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_pinned_closure_passes(self):
        self.assertTrue(runner.check_pins())
        self.assertEqual(runner.FAILURES, 0)

    def test_pin_drift_refuses_before_any_suite(self):
        path = self.profile / "src/receipt_v3/canonical.py"
        path.write_bytes(path.read_bytes() + b"\n# benign drift\n")
        with patch.object(runner, "run_suite") as suite:
            self.assertEqual(runner.main(), 1)
            suite.assert_not_called()
        self.assertFalse(runner.NEUTRAL.exists())

    def test_rewritten_manifest_empty_list_does_not_validate_itself(self):
        p = self.profile / "PINS.json"
        doc = json.loads(p.read_text())
        doc["files"] = []
        p.write_text(json.dumps(doc))
        self.assertFalse(runner.check_pins())

    def test_additional_source_refuses(self):
        (self.profile / "src/extra.py").write_text("# no runtime behavior\n")
        self.assertFalse(runner.check_pins())

    def test_symlink_refuses_even_for_same_bytes(self):
        p = self.profile / "src/receipt_v3/canonical.py"
        outside = self.root / "canonical.py"
        p.rename(outside)
        p.symlink_to(outside)
        self.assertFalse(runner.check_pins())

    def test_suite_must_have_expected_count_exit_and_no_skips(self):
        runner.NEUTRAL = self.root / "neutral"
        runner.NEUTRAL.mkdir()
        for rc, result, good in (
            (0, "ALPHA_SUITE_RESULT tests=2 skipped=0 expected_failures=0 success=1", True),
            (1, "ALPHA_SUITE_RESULT tests=2 skipped=0 expected_failures=0 success=1", False),
            (0, "ALPHA_SUITE_RESULT tests=0 skipped=0 expected_failures=0 success=1", False),
            (0, "ALPHA_SUITE_RESULT tests=2 skipped=1 expected_failures=0 success=1", False),
            (0, "", False),
        ):
            with self.subTest(rc=rc, result=result):
                runner.FAILURES = 0
                output = "cwd asserted: fixture\n" + result
                proc = subprocess.CompletedProcess([], rc, output, "")
                with patch.object(runner.subprocess, "run", return_value=proc):
                    runner.run_suite("controlled result", ["fixture"], [self.root], 2)
                self.assertEqual(runner.FAILURES, 0 if good else 1)

    def test_real_empty_suite_exits_nonzero(self):
        runner.NEUTRAL = self.root / "neutral"
        runner.NEUTRAL.mkdir()
        (self.root / "empty_suite.py").write_text("# intentionally no tests\n")
        runner.run_suite("empty suite", ["empty_suite"], [self.root], 1)
        self.assertEqual(runner.FAILURES, 1)

    def test_real_honest_suite_passes(self):
        runner.NEUTRAL = self.root / "neutral"
        runner.NEUTRAL.mkdir()
        (self.root / "honest_suite.py").write_text(
            "import unittest\nclass Case(unittest.TestCase):\n"
            "    def test_real(self): self.assertEqual(2 + 2, 4)\n")
        runner.run_suite("honest suite", ["honest_suite"], [self.root], 1)
        self.assertEqual(runner.FAILURES, 0)

    def test_real_expected_failure_is_not_a_pass(self):
        runner.NEUTRAL = self.root / "neutral"
        runner.NEUTRAL.mkdir()
        (self.root / "expected_failure.py").write_text(
            "import unittest\nclass Case(unittest.TestCase):\n"
            "    @unittest.expectedFailure\n"
            "    def test_failure(self): self.fail('expected failure must not promote')\n")
        runner.run_suite("expected failure", ["expected_failure"], [self.root], 1)
        self.assertEqual(runner.FAILURES, 1)

    def test_neutral_directory_removed_when_suite_raises(self):
        with patch.object(runner, "run_suite", side_effect=RuntimeError("test interruption")):
            with self.assertRaises(RuntimeError):
                runner.main()
        self.assertFalse(runner.NEUTRAL.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
