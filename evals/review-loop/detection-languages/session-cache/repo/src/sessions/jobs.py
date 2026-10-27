import logging

log = logging.getLogger(__name__)


def report_size():
    from .lookup import _sessions

    log.info("sessions cached: %d", len(_sessions))


EVERY_MINUTE = [report_size]


def run_minutely():
    for job in EVERY_MINUTE:
        job()
