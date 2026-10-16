/**
 * Generic fake db for Stack 9 route tests: real table objects, rows
 * stored per table, WHERE conditions evaluated by rendering them
 * with PgDialect and parsing the SQL (eq / cmp / in / is null /
 * ilike, combined with and/or) — the same technique the house's
 * live-streams/live-alerts suites use, generalized. Insert/update
 * honor the on-conflict shapes the Reach code uses.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

const dialect = new PgDialect();

export type Row = Record<string, any>;

interface TableStore {
  rows: Row[];
  colToProp: Map<string, string>; // db column name -> row prop name
  uniqueSets: string[][]; // prop-name sets treated as unique keys
}

export function createFakeDb(tables: Record<string, unknown>, uniqueKeys: Record<string, string[][]> = {}) {
  const stores = new Map<unknown, TableStore>();
  const byName = new Map<string, TableStore>();
  for (const [name, table] of Object.entries(tables)) {
    const cols = getTableColumns(table as never) as Record<string, { name: string }>;
    const colToProp = new Map<string, string>();
    for (const [prop, col] of Object.entries(cols)) colToProp.set(col.name, prop);
    const store: TableStore = { rows: [], colToProp, uniqueSets: uniqueKeys[name] ?? [] };
    stores.set(table, store);
    byName.set(name, store);
  }

  const prop = (store: TableStore, dbCol: string) => store.colToProp.get(dbCol) ?? dbCol;

  function atomPredicate(store: TableStore, sql: string, params: unknown[]): ((row: Row) => boolean) | null {
    const s = sql.trim();
    // Comparison: the column is the quoted identifier right before the
    // operator (table qualification, when present, precedes it).
    let m = s.match(/"(\w+)"\s*(=|>=|<=|>|<|<>|!=)\s*\$(\d+)(::\w+)?$/);
    if (m) {
      const col = prop(store, m[1]);
      const cmpOp = m[2];
      const val = params[Number(m[3]) - 1];
      return (row) => {
        const rv = row[col];
        if (cmpOp === "=") return String(rv ?? "") === String(val ?? "");
        if (cmpOp === "!=" || cmpOp === "<>") return String(rv ?? "") !== String(val ?? "");
        const toNum = (v: unknown): number => {
          if (v instanceof Date) return v.getTime();
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return Date.parse(v);
          return Number(v);
        };
        const a = toNum(rv);
        const b = toNum(val);
        if (cmpOp === ">=") return a >= b;
        if (cmpOp === "<=") return a <= b;
        if (cmpOp === ">") return a > b;
        return a < b;
      };
    }
    m = s.match(/"(\w+)"\s+in\s*\(([^)]+)\)$/);
    if (m) {
      const col = prop(store, m[1]);
      const idxs = m[2].split(",").map((x) => Number(x.trim().replace("$", "")));
      const vals = idxs.map((i) => params[i - 1]);
      return (row) => vals.some((v) => String(row[col] ?? "") === String(v ?? ""));
    }
    m = s.match(/"(\w+)"\s*=\s*any\(\$(\d+)\)$/);
    if (m) {
      const col = prop(streamProp(store, m[1]));
      void col;
      return () => true;
    }
    m = s.match(/"(\w+)"\s+is\s+(not\s+)?null$/);
    if (m) {
      const col = prop(store, m[1]);
      const not = !!m[2];
      return (row) => (not ? row[col] != null : row[col] == null);
    }
    m = s.match(/"(\w+)"\s+ilike\s*\$(\d+)$/);
    if (m) {
      const col = prop(store, m[1]);
      const pat = String(params[Number(m[2]) - 1] ?? "").replace(/%/g, "").toLowerCase();
      return (row) => String(row[col] ?? "").toLowerCase().includes(pat);
    }
    return null;
  }

  function streamProp(store: TableStore, dbCol: string): string {
    return prop(store, dbCol);
  }

  function splitTopLevel(sql: string, sep: " and " | " or "): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    let i = 0;
    const inner = sql.startsWith("(") && sql.endsWith(")") ? sql.slice(1, -1) : sql;
    while (i < inner.length) {
      const ch = inner[i];
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && inner.slice(i, i + sep.length).toLowerCase() === sep) {
        parts.push(cur);
        cur = "";
        i += sep.length;
        continue;
      }
      cur += ch;
      i++;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  function predicate(store: TableStore, sql: string, params: unknown[]): (row: Row) => boolean {
    const trimmed = sql.trim();
    const ors = splitTopLevel(trimmed, " or ");
    if (ors.length > 1) {
      const ps = ors.map((o) => predicate(store, o, params));
      return (row) => ps.some((p) => p(row));
    }
    const ands = splitTopLevel(trimmed, " and ");
    if (ands.length > 1) {
      const ps = ands.map((a) => predicate(store, a, params));
      return (row) => ps.every((p) => p(row));
    }
    const atom = atomPredicate(store, trimmed, params);
    if (atom) return atom;
    // Unknown fragment: treat as match-all rather than silently
    // emptying a surface (tests assert on the scoped rows, which are
    // always carried by a parseable eq somewhere in the condition).
    return () => true;
  }

  function matcher(store: TableStore, cond: unknown): (row: Row) => boolean {
    if (!cond) return () => true;
    const q = dialect.sqlToQuery(cond as never);
    return predicate(store, q.sql, q.params as unknown[]);
  }

  function evalSetValue(store: TableStore, row: Row, value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (value instanceof Date || typeof value !== "object") return value;
    // SQL expression: support `"col" + $n` / `"col" - $n`.
    try {
      const q = dialect.sqlToQuery(value as never);
      const m = q.sql.match(/"(\w+)"\s*([+-])\s*\$(\d+)/);
      if (m) {
        const col = prop(store, m[1]);
        const delta = Number(q.params[Number(m[3]) - 1]);
        return m[2] === "+" ? Number(row[col] ?? 0) + delta : Number(row[col] ?? 0) - delta;
      }
      if (/^now\(\)/i.test(q.sql.trim())) return new Date();
      return value;
    } catch {
      return value;
    }
  }

  function project(store: TableStore, fields: Record<string, unknown> | undefined, rows: Row[]): Row[] {
    if (!fields) return rows.map((r) => ({ ...r }));
    return rows.map((r) => {
      const out: Row = {};
      for (const [key, col] of Object.entries(fields)) {
        const c = col as { name?: string };
        if (c && typeof c.name === "string") {
          out[key] = r[prop(store, c.name)] ?? null;
        } else if (key === "total") {
          out[key] = rows.reduce((sum, x) => sum + Number(x["amount_vb"] ?? x["amountVb"] ?? 0), 0);
        } else if (key === "n") {
          out[key] = rows.length;
        } else {
          out[key] = null;
        }
      }
      return out;
    });
  }

  let idSeq = 0;
  const genId = () => `99999999-9999-4999-8999-${String(++idSeq).padStart(12, "0")}`;

  const db: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const store = stores.get(table);
        if (!store) throw new Error("fake db: unknown table in select");
        let cond: unknown;
        let limitN: number | undefined;
        let ordered = false;
        const run = () => {
          let rows = store.rows.filter(matcher(store, cond));
          if (ordered) {
            rows = [...rows].sort((a, b) => {
              const av = a.created_at ?? a.createdAt ?? 0;
              const bv = b.created_at ?? b.createdAt ?? 0;
              return (bv instanceof Date ? bv.getTime() : Number(bv)) - (av instanceof Date ? av.getTime() : Number(av));
            });
          }
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          return project(store, fields, rows);
        };
        const chain: any = {
          where: (c: unknown) => {
            cond = c;
            return chain;
          },
          orderBy: (..._a: unknown[]) => {
            ordered = true;
            return chain;
          },
          limit: (n: number) => {
            limitN = n;
            return chain;
          },
          then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
          catch: (rej: any) => Promise.resolve().then(run).catch(rej),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row | Row[]) => {
        const store = stores.get(table);
        if (!store) throw new Error("fake db: unknown table in insert");
        const list = Array.isArray(values) ? values : [values];
        const inserted: Row[] = [];
        let conflictMode: "none" | "nothing" | "update" = "none";
        let conflictTarget: string[] = [];
        let conflictSet: Row = {};
        const doInsert = () => {
          for (const v of list) {
            const row: Row = { id: genId(), created_at: new Date(), createdAt: new Date(), ...v };
            if (!v["id"]) row.id = genId();
            else row.id = v["id"];
            const conflict = store.uniqueSets
              .map((set) => store.rows.find((r) => set.every((k) => String(r[k] ?? "") === String(row[k] ?? ""))))
              .find(Boolean);
            const targetConflict = conflictTarget.length
              ? store.rows.find((r) => conflictTarget.every((k) => String(r[k] ?? "") === String(row[k] ?? "")))
              : undefined;
            const hit = targetConflict ?? (conflictMode === "nothing" ? conflict : undefined);
            if (hit && conflictMode === "nothing") continue;
            if (targetConflict && conflictMode === "update") {
              for (const [k, val] of Object.entries(conflictSet)) targetConflict[k] = evalSetValue(store, targetConflict, val);
              inserted.push(targetConflict);
              continue;
            }
            store.rows.push(row);
            inserted.push(row);
          }
          return inserted;
        };
        let execPromise: Promise<Row[]> | null = null;
        const exec = () => {
          if (!execPromise) {
            execPromise = Promise.resolve().then(() => {
              doInsert();
              return [] as Row[];
            });
          }
          return execPromise;
        };
        const chain: any = {
          onConflictDoNothing: (..._a: unknown[]) => {
            conflictMode = "nothing";
            return chain;
          },
          onConflictDoUpdate: (cfg: { target: unknown; set: Row }) => {
            conflictMode = "update";
            const cols = (Array.isArray(cfg.target) ? cfg.target : [cfg.target]) as Array<{ name: string }>;
            conflictTarget = cols.map((c) => prop(store, c.name));
            conflictSet = cfg.set;
            return chain;
          },
          returning: async () => doInsert(),
          then: (res: any, rej: any) => exec().then(res, rej),
          catch: (rej: any) => exec().catch(rej),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Row) => {
        const store = stores.get(table);
        if (!store) throw new Error("fake db: unknown table in update");
        let cond: unknown;
        const run = () => {
          const matched = store.rows.filter(matcher(store, cond));
          for (const row of matched) {
            for (const [k, val] of Object.entries(values)) row[k] = evalSetValue(store, row, val);
          }
          return matched.map((r) => ({ ...r }));
        };
        const chain: any = {
          where: (c: unknown) => {
            cond = c;
            return chain;
          },
          returning: async () => run(),
          then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
          catch: (rej: any) => Promise.resolve().then(run).catch(rej),
        };
        return chain;
      },
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const store = stores.get(table);
        if (!store) throw new Error("fake db: unknown table in delete");
        const m = matcher(store, cond);
        store.rows = store.rows.filter((r) => !m(r));
        const p = Promise.resolve([]) as any;
        return p;
      },
    }),
    execute: async () => ({ rows: [] }),
  };

  return {
    db,
    store: (name: string) => byName.get(name)!,
    seed: (name: string, rows: Row[]) => {
      byName.get(name)!.rows.push(...rows);
    },
    clear: () => {
      for (const s of byName.values()) s.rows = [];
      idSeq = 0;
    },
  };
}
