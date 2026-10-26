# logsift

Filter and count the lines of a log file by level. One script, standard library only, Python 3.9 or later. Nothing to install: run `./logsift.py` or `python3 logsift.py`.

```
$ ./logsift.py --min wrn examples/oven.log
2026-03-02 05:12:40 WRN flour bin low at 8%
2026-03-02 05:31:15 ERR proofing drawer door ajar
2026-03-02 05:40:00 WRN humidity 38% in drawer 1

$ ./logsift.py --grep FAN examples/oven.log
2026-03-02 05:00:04 DBG fan speed 3
2026-03-02 05:41:20 DBG fan speed 2

$ ./logsift.py --levels examples/oven.log
DBG 2
INF 2
WRN 2
ERR 1
```

- A log line is `<date> <time> <LEVEL> <message>`. The levels, lowest first, are `DBG`, `INF`, `WRN`, and `ERR`. Lines without a level, such as indented details, are left out.
- Without options, every log line is printed as it is in the file.
- `--min <level>` keeps lines at that level or higher. The level name ignores case, so `wrn` and `WRN` are the same.
- `--grep <text>` keeps lines whose message contains the text, ignoring case.
- `--levels` prints how many lines each level has, one `<LEVEL> <number>` line per level that has any, lowest level first. It counts after `--min` and `--grep`.
- When no line is left, nothing is printed and the exit code is 1.
- A level that is not one of the four prints `Unknown level: <name> (use DBG, INF, WRN, or ERR)` to stderr and exits with code 2.
- A file that does not exist prints `No such file: <file>` to stderr and exits with code 2.
- No file, or an option it does not know, prints `Usage: logsift [--min LEVEL] [--grep TEXT] [--levels] FILE` to stderr and exits with code 2.
