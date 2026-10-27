from .digest import build_digest
from .sender import send_digest


def send_weekly(projects, mailer):
    sent = 0
    for project in projects:
        digest = build_digest(project.changes_this_week())
        sent += send_digest(digest, mailer)
    return sent
