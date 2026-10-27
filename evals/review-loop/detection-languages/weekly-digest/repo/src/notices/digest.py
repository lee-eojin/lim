from dataclasses import dataclass, field

TEAM_INBOX = "team@example.com"


@dataclass
class Digest:
    entries: list
    recipients: list = field(default_factory=list)


def build_digest(entries):
    return Digest(entries=list(entries), recipients=[TEAM_INBOX])


def subject_line(digest):
    count = len(digest.entries)
    return f"{count} update" if count == 1 else f"{count} updates"
