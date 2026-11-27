import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from operator_journal import GENESIS, JOURNAL_NAME, append, journal_directory, operator_record, verify
from recovery_archive import ArchiveError

WHO = {"operator": "synthetic-operator", "reason": "Synthetic check of the operator journal's chain."}


class OperatorJournalTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.journal = self.root / "journal"
        self.journal.mkdir(mode=0o700)

    def tearDown(self):
        self.temp.cleanup()

    def lines(self):
        return (self.journal / JOURNAL_NAME).read_text().splitlines()

    def test_an_operator_and_a_reason_are_required_in_the_form_the_journal_keeps(self):
        self.assertEqual(operator_record("synthetic-operator", "  A synthetic reason of enough length.  "),
                         {"operator": "synthetic-operator", "reason": "A synthetic reason of enough length."})
        for operator in (None, "", "ab", "Synthetic-Operator", "someone@example.invalid", "-operator", "a" * 70):
            with self.assertRaisesRegex(ArchiveError, "OPERATOR_REQUIRED"):
                operator_record(operator, "A synthetic reason of enough length.")
        for reason in (None, "", "too short", "A synthetic reason\nover two lines.", "x" * 1001):
            with self.assertRaisesRegex(ArchiveError, "OPERATOR_REASON_REQUIRED"):
                operator_record("synthetic-operator", reason)

    def test_the_journal_lives_in_a_private_directory_named_by_its_absolute_path(self):
        self.assertEqual(journal_directory({"VALO_OPERATOR_JOURNAL": str(self.journal)}), self.journal)
        shared = self.root / "shared"
        shared.mkdir(mode=0o755)
        shared.chmod(0o755)
        for env, code in (({}, "OPERATOR_JOURNAL_REQUIRED"),
                          ({"VALO_OPERATOR_JOURNAL": "journal"}, "OPERATOR_JOURNAL_REQUIRED"),
                          ({"VALO_OPERATOR_JOURNAL": str(self.root / "missing")}, "OPERATOR_JOURNAL_REQUIRED"),
                          ({"VALO_OPERATOR_JOURNAL": str(shared)}, "PRIVATE_OPERATOR_JOURNAL_REQUIRED")):
            with self.assertRaisesRegex(ArchiveError, code):
                journal_directory(env)

    def test_each_entry_holds_the_hash_of_the_one_before_and_the_file_stays_private(self):
        self.assertEqual(verify(self.journal), {"entries": 0, "lastSha256": GENESIS})
        first = append(self.journal, WHO, "backup_removal", "backup_plan:" + "a" * 64, "started", {"removing": []})
        second = append(self.journal, WHO, "backup_removal", "backup_plan:" + "a" * 64, "completed", {"done": True})
        self.assertEqual(first["previousSha256"], GENESIS)
        self.assertEqual(second["previousSha256"], first["sha256"])
        self.assertEqual(verify(self.journal), {"entries": 2, "lastSha256": second["sha256"]})
        self.assertEqual([json.loads(line)["outcome"] for line in self.lines()], ["started", "completed"])
        self.assertEqual((self.journal / JOURNAL_NAME).stat().st_mode & 0o777, 0o600)
        for command, target, outcome in (("Backup", "backup_plan:x", "started"), ("backup_removal", "plan", "started"),
                                         ("backup_removal", "backup_plan:x", "done")):
            with self.assertRaises(ArchiveError):
                append(self.journal, WHO, command, target, outcome, {})
        self.assertEqual(verify(self.journal)["entries"], 2)

    def test_a_changed_or_removed_entry_breaks_the_chain_and_stops_every_later_write(self):
        for _ in range(3):
            append(self.journal, WHO, "recovery_restore", "recovery_archive:" + "b" * 64, "started", {})
        lines = self.lines()
        changed = json.loads(lines[1])
        changed["reason"] = "Someone else's synthetic reason, written later."
        for damaged in ([lines[0], json.dumps(changed, sort_keys=True, separators=(",", ":")), lines[2]],
                        [lines[0], lines[2]],
                        [lines[0], json.dumps(json.loads(lines[1]), indent=1), lines[2]]):
            (self.journal / JOURNAL_NAME).write_text("\n".join(damaged) + "\n")
            with self.assertRaisesRegex(ArchiveError, "OPERATOR_JOURNAL_CHAIN_BROKEN"):
                verify(self.journal)
            with self.assertRaisesRegex(ArchiveError, "OPERATOR_JOURNAL_CHAIN_BROKEN"):
                append(self.journal, WHO, "recovery_restore", "recovery_archive:" + "b" * 64, "started", {})
        # Removing the last entries leaves a chain that still holds: the chain shows a change or a
        # removal anywhere but at the end, and the tools' receipts carry the hash of their last entry.
        (self.journal / JOURNAL_NAME).write_text(lines[0] + "\n")
        self.assertEqual(verify(self.journal)["entries"], 1)

    def test_two_operators_writing_at_once_never_take_the_same_place_in_the_chain(self):
        script = (
            "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]);"
            "from operator_journal import append;"
            "who = {'operator': 'synthetic-operator', 'reason': 'Synthetic concurrent writer of the journal.'};"
            "[append(Path(sys.argv[2]), who, 'backup_removal', 'backup_plan:' + 'c' * 64, 'started', {'n': n})"
            " for n in range(25)]"
        )
        here = str(Path(__file__).resolve().parent)
        writers = [subprocess.Popen([sys.executable, "-c", script, here, str(self.journal)]) for _ in range(2)]
        self.assertEqual([writer.wait(timeout=120) for writer in writers], [0, 0])
        self.assertEqual(verify(self.journal)["entries"], 50)


if __name__ == "__main__":
    unittest.main()
