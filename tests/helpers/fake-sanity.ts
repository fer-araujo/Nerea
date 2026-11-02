import { vi } from "vitest";

// A stand-in for the parts of the Sanity write client that
// lib/commerce/sanity/stock.ts relies on, shared by the unit tests of
// decrementStock and by the webhook tests that run it for real. It behaves
// like Sanity where it matters here:
//   - a transaction is ATOMIC: every step applies, or none does;
//   - `create` of an id that exists is refused with a 409 and rolls the whole
//     transaction back (this is what makes the stock markers idempotent);
//   - `dec` fails on a field that is not there;
//   - a committed transaction answers with the documents AS THEY ARE AFTER it;
//   - a GROQ query is only as good as its text: the draft filter is honored if,
//     and only if, the query contains it.

export interface StoredDoc {
  _id: string;
  slug: string;
  status?: string;
  stock?: number;
}

export interface MarkerDoc {
  _id: string;
  _type: string;
  sessionId: string;
  handle: string;
  qty: number;
  at: string;
}

export type PatchOp =
  | { kind: "setIfMissing"; fields: Record<string, unknown> }
  | { kind: "dec"; fields: Record<string, number> }
  | { kind: "set"; fields: Record<string, unknown> };

/** What the Sanity client throws for a refused `create` (HTTP 409). */
export class ConflictError extends Error {
  readonly statusCode = 409;
}

export const DRAFT_FILTER = '!(_id in path("drafts.**"))';

type Step =
  | { kind: "create"; doc: MarkerDoc }
  | { kind: "patch"; id: string; ops: PatchOp[] };

export class FakeSanity {
  readonly docs = new Map<string, StoredDoc>();
  /** The marker documents that exist, by id. */
  readonly markers = new Map<string, MarkerDoc>();
  /** Every product mutation that reached the "database", one entry per transaction or patch. */
  readonly writes: Array<{ id: string; ops: PatchOp[] }> = [];
  /** Failures to inject, by product slug. */
  failFetchFor = new Set<string>();
  failTransactionFor = new Set<string>();
  failSetFor = new Set<string>();
  /** The transaction LANDS, then reports an error once (a connection reset after commit). */
  failAfterCommitFor = new Set<string>();
  /** Drops the documents from a commit's answer (an unexpected API shape). */
  returnNothing = false;

  readonly fetch = vi.fn(async (query: string, params: { handle: string }) => {
    if (this.failFetchFor.has(params.handle)) {
      throw new Error("503 from Sanity");
    }
    const hidesDrafts = query.includes(DRAFT_FILTER);
    const found = [...this.docs.values()].find(
      (doc) =>
        doc.slug === params.handle &&
        !(hidesDrafts && doc._id.startsWith("drafts.")),
    );
    return found
      ? { _id: found._id, status: found.status, stock: found.stock ?? null }
      : null;
  });

  constructor(...docs: StoredDoc[]) {
    for (const doc of docs) this.docs.set(doc._id, { ...doc });
  }

  /** The stock of the published document with this slug. */
  stockOf(slug: string): number | undefined {
    return [...this.docs.values()].find(
      (doc) => doc.slug === slug && !doc._id.startsWith("drafts."),
    )?.stock;
  }

  private patchBuilder(ops: PatchOp[]) {
    const builder = {
      setIfMissing: (fields: Record<string, unknown>) => {
        ops.push({ kind: "setIfMissing", fields });
        return builder;
      },
      dec: (fields: Record<string, number>) => {
        ops.push({ kind: "dec", fields });
        return builder;
      },
      set: (fields: Record<string, unknown>) => {
        ops.push({ kind: "set", fields });
        return builder;
      },
    };
    return builder;
  }

  private apply(doc: StoredDoc, ops: PatchOp[]): StoredDoc {
    const next: StoredDoc = { ...doc };
    for (const op of ops) {
      if (op.kind === "setIfMissing") {
        if (next.stock === undefined && "stock" in op.fields) {
          next.stock = op.fields.stock as number;
        }
      } else if (op.kind === "dec") {
        // Sanity refuses to decrement a field that does not exist.
        if (next.stock === undefined) {
          throw new Error("dec on a missing field");
        }
        next.stock -= op.fields.stock;
      } else {
        Object.assign(next, op.fields);
      }
    }
    return next;
  }

  transaction() {
    const steps: Step[] = [];
    const transaction = {
      create: (doc: MarkerDoc) => {
        steps.push({ kind: "create", doc });
        return transaction;
      },
      patch: (id: string, build: (patch: unknown) => unknown) => {
        const ops: PatchOp[] = [];
        build(this.patchBuilder(ops));
        steps.push({ kind: "patch", id, ops });
        return transaction;
      },
      commit: async (options?: { returnDocuments?: boolean }) => {
        const patches = steps.filter(
          (step): step is Extract<Step, { kind: "patch" }> => step.kind === "patch",
        );
        const slug = this.docs.get(patches[0]?.id ?? "")?.slug ?? "";
        if (this.failTransactionFor.has(slug)) {
          throw new Error("transaction failed");
        }

        // Atomic: work on copies, publish only if every step applied. There is
        // no `await` between this check and the publish, so two concurrent
        // commits can never both pass it.
        const workingDocs = new Map(this.docs);
        const workingMarkers = new Map(this.markers);
        const answers: unknown[] = [];
        for (const step of steps) {
          if (step.kind === "create") {
            if (workingMarkers.has(step.doc._id)) {
              throw new ConflictError(
                `Document by ID "${step.doc._id}" already exists`,
              );
            }
            workingMarkers.set(step.doc._id, step.doc);
            answers.push({ ...step.doc });
          } else {
            const current = workingDocs.get(step.id);
            if (!current) throw new Error("document not found");
            const next = this.apply(current, step.ops);
            workingDocs.set(step.id, next);
            answers.push({ ...next });
          }
        }

        for (const [id, doc] of workingDocs) this.docs.set(id, doc);
        for (const [id, marker] of workingMarkers) this.markers.set(id, marker);
        // One entry per transaction, with every patch operation in order.
        this.writes.push({
          id: patches[0].id,
          ops: patches.flatMap((patch) => patch.ops),
        });

        if (this.failAfterCommitFor.delete(slug)) {
          throw new Error("connection reset after commit");
        }
        if (this.returnNothing) return [];
        return options?.returnDocuments ? answers : [];
      },
    };
    return transaction;
  }

  // `client.patch(id).set(...).commit()`: the single-document follow-up.
  patch(id: string) {
    const ops: PatchOp[] = [];
    const builder = {
      set: (fields: Record<string, unknown>) => {
        ops.push({ kind: "set", fields });
        return builder;
      },
      commit: async () => {
        const doc = this.docs.get(id);
        if (!doc) throw new Error("document not found");
        if (this.failSetFor.has(doc.slug)) throw new Error("set failed");
        this.docs.set(id, this.apply(doc, ops));
        this.writes.push({ id, ops });
        return this.docs.get(id);
      },
    };
    return builder;
  }
}
