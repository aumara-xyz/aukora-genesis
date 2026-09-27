"""The real rewrite-both court requires both the named refusal and exit 2."""
from contextlib import redirect_stderr, redirect_stdout
import inspect
import io
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from diamond import court


class RewriteBothRefusal(unittest.TestCase):
    def assert_four_cases(self, require_refusal):
        for verdict, rc, accepted in (
            ("CHECKPOINT_SIG_FAIL", 2, True),
            ("WRONG", 2, False),
            ("CHECKPOINT_SIG_FAIL", 0, False),
            ("WRONG", 0, False),
        ):
            with self.subTest(verdict=verdict, rc=rc), \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                if accepted:
                    self.assertIsNone(require_refusal(verdict, rc))
                else:
                    with self.assertRaises(SystemExit) as error:
                        require_refusal(verdict, rc)
                    self.assertEqual(error.exception.code, 1)

    def test_actual_court_refusal_requires_both_facts(self):
        self.assert_four_cases(court._require_rewrite_both_refusal)

    def test_reintroduced_and_cannot_pass_single_error_cases(self):
        source = inspect.getsource(court._require_rewrite_both_refusal)
        before = 'verdict != "CHECKPOINT_SIG_FAIL" or rc != 2'
        self.assertEqual(source.count(before), 1)
        namespace = {"_fail": court._fail}
        exec(compile(source.replace(before, before.replace(" or ", " and ")),
                     "<rewrite-both-and-mutant>", "exec"), namespace)
        mutant = namespace["_require_rewrite_both_refusal"]
        # Each single-error case must make the same refusal assertion fail.
        for verdict, rc in (("WRONG", 2), ("CHECKPOINT_SIG_FAIL", 0)):
            with self.subTest(verdict=verdict, rc=rc):
                with self.assertRaises(AssertionError):
                    with self.assertRaises(SystemExit):
                        mutant(verdict, rc)


if __name__ == "__main__":
    unittest.main()
