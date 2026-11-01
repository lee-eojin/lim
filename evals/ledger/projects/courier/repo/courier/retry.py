from .config import MAX_ATTEMPTS
from .policy import RETRYABLE


def should_retry(status, attempt):
    return attempt < MAX_ATTEMPTS and status in RETRYABLE
