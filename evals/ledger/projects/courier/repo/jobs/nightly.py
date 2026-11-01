import os

from courier.config import DEFAULT_TIMEOUT


def export(records, timeout=DEFAULT_TIMEOUT):
    batch = int(os.environ.get("EXPORT_BATCH", "500"))
    return [records[i:i + batch] for i in range(0, len(records), batch)]
