from .digest import subject_line


def send_digest(digest, mailer):
    body = "\n".join(f"- {entry}" for entry in digest.entries)
    for address in digest.recipients:
        mailer.send(to=address, subject=subject_line(digest), body=body)
    return len(digest.recipients)
