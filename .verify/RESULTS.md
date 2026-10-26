=== run-all started 2026-10-26T12:47:04Z ===
--- lib/db dist rebuild (tsc -b .) ---
db_build_exit=0
--- API typecheck ---
src/routes/health.ts(2,37): error TS6305: Output file '/home/hatch/workspace/bdv-wt-rem-supporter/lib/api-zod/dist/index.d.ts' has not been built from source file '/home/hatch/workspace/bdv-wt-rem-supporter/lib/api-zod/src/index.ts'.
src/routes/supporter-board.ts(78,47): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
src/routes/supporter-board.ts(166,47): error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
  Type 'string[]' is not assignable to type 'string'.
api_typecheck_exit=1
--- FE typecheck ---
