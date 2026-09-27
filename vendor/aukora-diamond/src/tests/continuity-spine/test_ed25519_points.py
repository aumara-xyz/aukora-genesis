"""Point-decoding policy, checked without constructing forged receipts."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from diamond import ed25519 as primary
from foreign import ed25519 as secondary


class PointValidationTests(unittest.TestCase):
    def test_official_valid_vector_and_changed_message(self):
        for implementation in (primary, secondary):
            with self.subTest(implementation=implementation.__name__):
                implementation.rfc8032_selftest()

    def test_noncanonical_coordinate_and_sign_refused(self):
        for implementation in (primary, secondary):
            for value in (implementation.P, implementation.P + 1, 1 | (1 << 255)):
                with self.subTest(implementation=implementation.__name__, value=value):
                    with self.assertRaises(ValueError):
                        implementation._decode_point(value.to_bytes(32, 'little'))

    def test_small_order_points_refused(self):
        for implementation in (primary, secondary):
            for value in (0, 1, implementation.P - 1):
                with self.subTest(implementation=implementation.__name__, value=value):
                    with self.assertRaisesRegex(ValueError, 'small-order'):
                        implementation._decode_point(value.to_bytes(32, 'little'))

    def test_wrong_length_refused(self):
        for implementation in (primary, secondary):
            for value in (b'', bytes(31), bytes(33)):
                with self.subTest(implementation=implementation.__name__, length=len(value)):
                    with self.assertRaisesRegex(ValueError, 'point length'):
                        implementation._decode_point(value)


if __name__ == '__main__':
    unittest.main()
