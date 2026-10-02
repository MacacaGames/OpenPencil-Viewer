"""Parse operator-observed DSM query formats, without granting authorization.

Pure functions only: no command execution, account database, filesystem or NAS
access. Expired is a raw field, NOT an enabled-state decision. Permission output
is an observation, NOT proof of share restrictions or same-object safe opening.
The blocked native adapter does not import this module.
"""
import re
from dataclasses import dataclass
from typing import Optional, Tuple

PERMISSIONS = "rwxpdDaARWcCo"
FIELDS = ("User Name", "User Type", "User uid", "Primary gid", "Fullname",
          "User Dir", "User Shell", "Expired", "User Mail", "Alloc Size", "Member Of")


class InvalidObservation(ValueError):
    def __init__(self):
        # Never echo private account/ACL output in errors.
        super().__init__("unsupported-dsm-query-output")


@dataclass(frozen=True)
class AccountObservation:
    username: str
    uid: int
    primary_gid: int
    expired: bool
    email: Optional[str]
    groups: Tuple[Tuple[int, str], ...]


@dataclass(frozen=True)
class PermissionObservation:
    username: str
    groups: Tuple[str, ...]
    permissions: str


def _lines(raw):
    if not isinstance(raw, bytes) or not raw or len(raw) > 65536:
        raise InvalidObservation()
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise InvalidObservation() from None
    if any(ord(c) < 32 and c not in "\t\r\n" for c in text) or "\x7f" in text:
        raise InvalidObservation()
    lines = [line.strip(" \t\r") for line in text.split("\n") if line.strip(" \t\r")]
    if len(lines) > 512 or any(len(line) > 4096 or "\r" in line for line in lines):
        raise InvalidObservation()
    return lines


def _name(value):
    if not value or len(value) > 256 or value != value.strip() or not re.fullmatch(r"[\w. @+-]+", value):
        raise InvalidObservation()
    return value


def _number(value, maximum=4294967294):
    if not re.fullmatch(r"0|[1-9][0-9]{0,9}", value) or int(value) > maximum:
        raise InvalidObservation()
    return int(value)


def _mask(value):
    if len(value) != len(PERMISSIONS) or any(c not in ("-", expected) for c, expected in zip(value, PERMISSIONS)):
        raise InvalidObservation()
    return value


def parse_account(raw, expected_username):
    _name(expected_username)
    lines = _lines(raw)
    values = {}
    if len(lines) < len(FIELDS):
        raise InvalidObservation()
    for label, line in zip(FIELDS, lines):
        match = re.fullmatch(r"([A-Za-z][A-Za-z ]*?)\s*:\s*\[([^\[\]]*)\]", line)
        if not match or match[1].strip() != label:
            raise InvalidObservation()
        values[label] = match[2]
    if values["User Name"] != expected_username or values["User Type"] != "AUTH_LOCAL":
        raise InvalidObservation()
    if values["Expired"] not in ("false", "true"):
        raise InvalidObservation()
    uid = _number(values["User uid"])
    gid = _number(values["Primary gid"])
    _number(values["Alloc Size"])
    count = _number(values["Member Of"], 256)
    if len(lines) != len(FIELDS) + count:
        raise InvalidObservation()
    groups = []
    for line in lines[len(FIELDS):]:
        match = re.fullmatch(r"\(([0-9]+)\) +(.+)", line)
        if not match:
            raise InvalidObservation()
        groups.append((_number(match[1]), _name(match[2])))
    if len({group[0] for group in groups}) != count or len({group[1] for group in groups}) != count:
        raise InvalidObservation()
    email = values["User Mail"] or None
    if email is not None and (len(email) > 254 or not re.fullmatch(r"[^\s@<>\[\]]+@[^\s@<>\[\]]+", email)):
        raise InvalidObservation()
    return AccountObservation(expected_username, uid, gid, values["Expired"] == "true", email, tuple(groups))


def parse_permissions(raw, expected_username):
    _name(expected_username)
    lines = _lines(raw)
    if len(lines) < 7 or lines[0] != "ACL version: 1":
        raise InvalidObservation()
    archive = re.fullmatch(r"Archive: ([A-Za-z_,]+)", lines[1])
    known = {"is_inherit", "is_read_only", "is_owner_group", "has_ACL", "is_support_ACL"}
    if not archive or not set(archive[1].split(",")).issubset(known):
        raise InvalidObservation()
    owner = re.fullmatch(r"Owner: \[([^\[\]()]+)\((user|group)\)\]", lines[2])
    if not owner:
        raise InvalidObservation()
    _name(owner[1])
    if not re.fullmatch(r"-{5,}", lines[3]):
        raise InvalidObservation()
    index = 4
    while index < len(lines) and lines[index].startswith("["):
        ace = re.fullmatch(r"\[([0-9]+)\] (user|group|owner|everyone|authenticated_user|system):([^:]+):(allow|deny):([A-Za-z-]+):([fdin-]{4}) \(level:([0-9]+)\)", lines[index])
        if not ace or _number(ace[1], 256) != index - 4:
            raise InvalidObservation()
        if ace[3] != "*":
            _name(ace[3])
        _mask(ace[5])
        if any(c not in ("-", expected) for c, expected in zip(ace[6], "fdin")):
            raise InvalidObservation()
        _number(ace[7], 256)
        index += 1
    if len(lines) != index + 3 or not re.fullmatch(r"={5,}", lines[index]):
        raise InvalidObservation()
    principal = re.fullmatch(r"User/Group: \[([^/\[\]]+)/([^\[\]]*)\]", lines[index + 1])
    final = re.fullmatch(r"Final permission: \[([A-Za-z-]+)\]", lines[index + 2])
    if not principal or principal[1] != expected_username or not final:
        raise InvalidObservation()
    groups = tuple(_name(name) for name in principal[2].split(",")) if principal[2] else ()
    if len(groups) > 256 or len(set(groups)) != len(groups):
        raise InvalidObservation()
    return PermissionObservation(expected_username, groups, _mask(final[1]))
