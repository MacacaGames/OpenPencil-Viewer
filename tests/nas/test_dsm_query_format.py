"""Synthetic format fixtures only; not native evaluator/live acceptance tests."""
import importlib.util
import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

spec = importlib.util.spec_from_file_location("dsm_query_format", Path(__file__).resolve().parents[2] / "tools/nas/dsm_query_format.py")
query = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = query
spec.loader.exec_module(query)

ACCOUNT = b"""User Name   : [fixture-user]
User Type   : [AUTH_LOCAL]
User uid    : [1100]
Primary gid : [100]
Fullname    : [Synthetic fixture]
User Dir    : [/synthetic/home]
User Shell  : [/sbin/nologin]
Expired     : [false]
User Mail   : []
Alloc Size  : [134]
Member Of   : [1]
(100) users
"""

ACL = b"""ACL version: 1
Archive: has_ACL,is_support_ACL
Owner: [root(user)]
---------------------
 [0] group:users:allow:rwxpdDaARWc--:fd-- (level:0)
 [1] group:fixture-readers:allow:r-x---a-R-c--:fd-- (level:0)
====================================================
User/Group: [fixture-user/users,fixture-readers]

Final permission: [r-x---a-R-c--]
"""


class QueryFormatTests(unittest.TestCase):
    def rejects(self, parser, values):
        for raw in values:
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(query.InvalidObservation, "^unsupported-dsm-query-output$"):
                    parser(raw, "fixture-user")

    def test_account_exact_email_empty_and_raw_expired(self):
        account = query.parse_account(ACCOUNT, "fixture-user")
        self.assertIsNone(account.email)
        self.assertFalse(account.expired)
        self.assertEqual(account.groups, ((100, "users"),))
        self.assertFalse(hasattr(account, "enabled"))
        self.assertFalse(hasattr(account, "generation"))
        mail = query.parse_account(ACCOUNT.replace(b"User Mail   : []", b"User Mail   : [Fixture@mock.example]"), "fixture-user")
        self.assertEqual(mail.email, "Fixture@mock.example")
        self.assertTrue(query.parse_account(ACCOUNT.replace(b"[false]", b"[true]"), "fixture-user").expired)
        with self.assertRaises(FrozenInstanceError):
            account.uid = 0

    def test_account_multiple_group_shape_is_synthetic_only(self):
        raw = ACCOUNT.replace(b"Member Of   : [1]", b"Member Of   : [2]") + b"(1100) fixture-readers\n"
        self.assertEqual(len(query.parse_account(raw, "fixture-user").groups), 2)

    def test_account_rejects_truncation_ambiguity_foreign_identity_and_schema(self):
        self.rejects(query.parse_account, [
            ACCOUNT.replace(b"[fixture-user]", b"[foreign-user]"),
            ACCOUNT.replace(b"AUTH_LOCAL", b"AUTH_DOMAIN"),
            ACCOUNT.replace(b"[false]", b"[0]"),
            ACCOUNT.replace(b"(100) users\n", b""),
            ACCOUNT + b"(100) users\n",
            ACCOUNT.replace(b"User Mail", b"Other Key"),
            ACCOUNT.replace(b"User Mail   : []", b"User Mail   : [name without email]"),
            ACCOUNT.replace(b"[1100]", b"[4294967295]"),
            ACCOUNT.replace(b"[fixture-user]", b"[fixture-user]\x00"),
            ACCOUNT + b"Secret: [private]\n",
            b"x" * 65537, b"\xff", b"",
        ])

    def test_permission_observation_binds_identity_and_final_mask(self):
        observation = query.parse_permissions(ACL, "fixture-user")
        self.assertEqual(observation.username, "fixture-user")
        self.assertEqual(observation.groups, ("users", "fixture-readers"))
        self.assertEqual(observation.permissions, "r-x---a-R-c--")
        self.assertFalse(hasattr(observation, "authorized"))
        self.assertFalse(hasattr(observation, "ready"))
        # Same ACEs, different native final result: never calculate grants from ACEs.
        denied = ACL.replace(b"Final permission: [r-x---a-R-c--]", b"Final permission: [-------------]")
        self.assertEqual(query.parse_permissions(denied, "fixture-user").permissions, "-------------")

    def test_non_admin_result_with_six_aces_and_only_users_membership(self):
        # Shape from the operator's second root query; all private names synthetic.
        names = ("administrators", "fixture-dev", "fixture-art", "users", "fixture-design", "fixture-management")
        entries = []
        for index, name in enumerate(names):
            mask = "r-x---a-R-c--" if index == 2 else "rwxpdDaARWc--"
            entries.append(f" [{index}] group:{name}:allow:{mask}:fd-- (level:0)")
        raw = ("ACL version: 1\nArchive: has_ACL,is_support_ACL\nOwner: [root(user)]\n"
               "---------------------\n" + "\n".join(entries) +
               "\n====================================================\nUser/Group: [fixture-user/users]\n"
               "\nFinal permission: [rwxpdDaARWc--]\n").encode()
        result = query.parse_permissions(raw, "fixture-user")
        self.assertEqual(result.groups, ("users",))
        self.assertEqual(result.permissions, "rwxpdDaARWc--")
        self.assertNotIn("administrators", result.groups)
        # An administrator ACE/owner cannot override a denying final result.
        denied = raw.replace(b"Final permission: [rwxpdDaARWc--]", b"Final permission: [-------------]")
        self.assertEqual(query.parse_permissions(denied, "fixture-user").permissions, "-------------")

    def test_permissions_rejects_missing_duplicate_wrong_user_and_bad_positions(self):
        self.rejects(query.parse_permissions, [
            ACL.replace(b"fixture-user/users", b"foreign-user/users"),
            ACL.replace(b"ACL version: 1", b"ACL version: 2"),
            ACL.replace(b"has_ACL", b"unknown_flag"),
            ACL.replace(b"[1] group", b"[0] group"),
            ACL.replace(b"fd--", b"df--"),
            ACL.replace(b"Final permission: [r-x---a-R-c--]", b"Final permission: [x-r---a-R-c--]"),
            ACL.replace(b"Final permission: [r-x---a-R-c--]", b""),
            ACL + b"Final permission: [rwxpdDaARWc--]\n",
            ACL.replace(b"users,fixture-readers]", b"users,users]"),
            ACL.replace(b"Final permission:", b"Error:"),
            b"User/Group: [fixture-user/users]\nFinal permission: [rwxpdDaARWc--]\n",
        ])


if __name__ == "__main__":
    unittest.main()
