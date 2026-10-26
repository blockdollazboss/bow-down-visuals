== build libs (tsc --build root) ==
build-libs: exit=0
== API typecheck ==
api-typecheck: exit=0
== FE typecheck ==
fe-typecheck: exit=0
== scoped lane tests (API) ==
.verify/run-all.sh: line 24: /home/hatch/workspace/bdv-wt-rem-stems/node_modules/.bin/vitest: No such file or directory
scoped-api-tests: exit=127
== scoped lane tests (FE) ==
.verify/run-all.sh: line 28: /home/hatch/workspace/bdv-wt-rem-stems/node_modules/.bin/vitest: No such file or directory
scoped-fe-tests: exit=127
== full API suite ==
.verify/run-all.sh: line 32: /home/hatch/workspace/bdv-wt-rem-stems/node_modules/.bin/vitest: No such file or directory
full-api-suite: exit=127
== full FE suite ==
.verify/run-all.sh: line 36: /home/hatch/workspace/bdv-wt-rem-stems/node_modules/.bin/vitest: No such file or directory
full-fe-suite: exit=127
ALLDONE
