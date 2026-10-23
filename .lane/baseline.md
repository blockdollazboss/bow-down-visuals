# STACK-100 #2 (WORLD) — baseline on stack28/world @ 0bdfcefa
Sequential --maxWorkers=1, TMPDIR in-worktree. Numbers read from the finished
run output (the .log redirects were lost to relative paths; final verification
will write absolute-path logs into this dir):
- FE typecheck exit 0, API typecheck exit 0
- FE suite: 307 files / 4,070 tests ALL PASSED
- API suite: 408 files / 5,122 tests ALL PASSED
Target after build: same or better, numbers only from finished logs.
