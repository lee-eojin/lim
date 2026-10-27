from notices.digest import TEAM_INBOX, build_digest, subject_line


def test_team_inbox_gets_the_digest():
    digest = build_digest(["release 2.1 shipped"])
    assert digest.recipients == [TEAM_INBOX]


def test_subject_counts_updates():
    assert subject_line(build_digest(["a"])) == "1 update"
    assert subject_line(build_digest(["a", "b"])) == "2 updates"
