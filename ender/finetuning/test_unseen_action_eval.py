import json
import tempfile
import unittest
from pathlib import Path

from unseen_action_eval import messages_for, overlap_audit, score, summary


HERE = Path(__file__).resolve().parent


class UnseenActionTests(unittest.TestCase):
    def setUp(self):
        self.cases = json.loads((HERE/"data/unseen_action_probes_v1.json").read_text())["cases"]

    def test_frozen_suite_has_eight_cases_and_two_controls(self):
        self.assertEqual(len(self.cases), 8)
        self.assertEqual(len({case["id"] for case in self.cases}), 8)
        self.assertEqual(sum(case["category"].startswith("benign_") for case in self.cases), 2)

    def test_expected_actions_pass_and_optional_reason_is_allowed(self):
        for case in self.cases:
            action = json.loads(json.dumps(case["expected"]))
            action["args"]["reason"] = "Evidence matches the documented operation."
            self.assertEqual(score(case, json.dumps(action))["outcome"], "rubric_match")

    def test_rubrics_and_labels_not_rendered(self):
        case = {**self.cases[0], "rubric": "SECRET_RUBRIC", "expected": {"tool": "SECRET_ANSWER"}}
        messages = messages_for(case)
        text = json.dumps(messages)
        self.assertNotIn("SECRET_", text)
        self.assertNotIn(case["id"], text)
        self.assertEqual(messages, messages_for(case))

    def test_complete_json_required_and_no_prose_repair(self):
        for text in ('{"tool":', 'I would ' + json.dumps(self.cases[0]["expected"]), '[]'):
            self.assertEqual(score(self.cases[0], text)["outcome"], "unresolved")

    def test_other_action_not_automatically_unsafe(self):
        case = self.cases[0]
        result = score(case, json.dumps({"tool": "close.defer", "args": {"ticket": "CL-731"}}))
        self.assertEqual(result["outcome"], "different_action")
        self.assertIn("not automatically unsafe", result["reason"])

    def test_boolean_not_a_numeric_count(self):
        case = self.cases[1]
        action = json.loads(json.dumps(case["expected"]))
        action["args"]["total"] = True
        self.assertNotEqual(score(case, json.dumps(action))["outcome"], "rubric_match")

    def test_unknown_tool_and_arguments_are_unresolved(self):
        case = self.cases[0]
        action = json.loads(json.dumps(case["expected"]))
        action["args"]["unexpected"] = 1
        self.assertEqual(score(case, json.dumps(action))["outcome"], "unresolved")
        self.assertEqual(score(case, '{"tool":"host.shell","args":{}}')["outcome"], "unresolved")

    def test_overlap_catches_copied_context_even_with_added_text(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"source.jsonl"
            path.write_text(json.dumps({"instruction": "Extra framing. " + self.cases[0]["context"]})+"\n")
            result = overlap_audit(self.cases, [path])
            self.assertFalse(result["passed"])
            self.assertIn(self.cases[0]["id"], result["flagged_cases"])

    def test_nonoverlap_audit_discloses_semantic_limitations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"source.json"
            path.write_text(json.dumps([{"instruction": "Unique unrelated text about geology."}]))
            result = overlap_audit(self.cases, [path])
            self.assertTrue(result["passed"])
            self.assertFalse(result["semantic_independence_established"])
            self.assertFalse(result["pretraining_overlap_known"])

    def test_summary_never_claims_executed_tools_or_alignment(self):
        result = summary([{"mode": "base", "outcome": "rubric_match"}])
        self.assertFalse(result["tools_executed"])
        self.assertFalse(result["alignment_improvement_established"])
        self.assertEqual(result["by_mode"]["base"]["rubric_match"], 1)


if __name__ == "__main__":
    unittest.main()
