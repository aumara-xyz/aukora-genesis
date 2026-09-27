"""A missing, empty or failed court cannot promote the finite claim ladder."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / "scripts/verify-cold-distillation.py"
spec = importlib.util.spec_from_file_location("distillation", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LadderTests(unittest.TestCase):
    def test_missing_or_failed_checks_never_promote(self):
        good = {name: True for name, *_ in module.JOBS}
        self.assertEqual(module.ledger(good)["status"], "PASS")
        for results in ({}, dict(good, alpha_profile=False),
                        {k: v for k, v in good.items() if k != "source_budget"}):
            report = module.ledger(results)
            self.assertEqual(report["status"], "FAIL")
            self.assertEqual(report["claimLevels"]["fixture"], "NOT_ESTABLISHED")
        self.assertEqual(module.ledger(good)["claimLevels"]["human"], "NOT_ESTABLISHED")
        self.assertEqual(module.ledger(good)["claimLevels"]["product_bridge"], "NOT_ESTABLISHED")

    def test_success_text_needs_success_exit(self):
        for rc, text, expected in ((0, "PASS\n", True), (1, "PASS\n", False),
                                   (0, "FAIL\n", False), (0, "PASS\nPASS\n", False)):
            self.assertEqual(module.accepted(rc, text, "PASS"), expected)

    def test_empty_skipped_or_missing_suite_refuses(self):
        self.assertTrue(module.accepted(0, "Ran 2 tests in 0.1s\n\nOK\n", count=2))
        for output in ("OK\n", "Ran 0 tests in 0.1s\nOK\n",
                       "Ran 2 tests in 0.1s\nOK (skipped=1)\n",
                       "Ran 1 test in 0.1s\nOK\n"):
            self.assertFalse(module.accepted(0, output, count=2))


if __name__ == "__main__":
    unittest.main()
