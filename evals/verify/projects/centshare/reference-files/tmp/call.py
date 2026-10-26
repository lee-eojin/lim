import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import centshare

name, *args = sys.argv[1:]
values = [int(arg) if arg.lstrip("-").isdigit() else arg for arg in args]
print(json.dumps(getattr(centshare, name)(*values)))
