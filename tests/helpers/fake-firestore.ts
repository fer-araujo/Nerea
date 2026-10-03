// An in-memory stand-in for the slice of the Firestore Admin SDK that
// lib/admin/data uses: collections, documents, transactions and simple
// queries. It is deliberately STRICT about the rules the data layer promises
// to respect, so a test passing means the rule held:
//
//   - a transaction must do all its reads before its first write;
//   - writes are buffered and applied atomically on commit: a transaction
//     whose callback throws leaves NOTHING behind;
//   - `create` refuses to overwrite an existing document (this is what makes
//     the movements ledger append-only);
//   - a query that would need a composite index (an equality filter combined
//     with a range/orderBy, or a range/orderBy spanning two fields) throws,
//     like Firestore's FAILED_PRECONDITION "requires an index" error.
//
// It is a test helper, not a test: vitest only collects *.test.ts(x).

type Data = Record<string, unknown>;

/** What FieldValue.serverTimestamp() returns in tests. */
export const SERVER_TIMESTAMP = Object.freeze({ __sentinel: "serverTimestamp" });

export class FakeTimestamp {
  private readonly value: Date;

  constructor(value: Date) {
    this.value = new Date(value.getTime());
  }

  toDate(): Date {
    return new Date(this.value.getTime());
  }
}

export type FakeOp =
  | { kind: "create" | "set" | "update"; path: string; data: Data }
  | { kind: "delete"; path: string };

type Operator = "==" | "<" | "<=" | ">" | ">=";

export interface QueryRecord {
  collection: string;
  wheres: Array<{ field: string; op: Operator; value: unknown }>;
  orderBys: Array<{ field: string; direction: "asc" | "desc" }>;
  offset: number | undefined;
  limit: number | undefined;
  select: string[] | undefined;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as unknown as T;
  }
  // Class instances (FakeTimestamp) and the frozen sentinel are immutable:
  // share them. Only plain objects need a copy.
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !Object.isFrozen(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, clone(inner)]),
    ) as T;
  }
  return value;
}

function comparable(value: unknown): number | string | boolean | undefined {
  if (value instanceof FakeTimestamp) {
    return value.toDate().getTime();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function matches(
  doc: Data,
  where: { field: string; op: Operator; value: unknown },
): boolean {
  const left = comparable(doc[where.field]);
  const right = comparable(where.value);
  if (left === undefined || right === undefined) {
    return false;
  }
  switch (where.op) {
    case "==":
      return left === right;
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
  }
}

function assertNoCompositeIndex(query: QueryRecord): void {
  const equalityFields = query.wheres
    .filter((where) => where.op === "==")
    .map((where) => where.field);
  const orderedOrRanged = new Set([
    ...query.wheres.filter((where) => where.op !== "==").map((where) => where.field),
    ...query.orderBys.map((order) => order.field),
  ]);

  if (orderedOrRanged.size > 1) {
    throw new Error(
      `9 FAILED_PRECONDITION: The query requires an index (range/orderBy over ${[...orderedOrRanged].join(" and ")}).`,
    );
  }
  if (equalityFields.length > 0 && orderedOrRanged.size > 0) {
    throw new Error(
      "9 FAILED_PRECONDITION: The query requires an index (equality filter combined with a range or orderBy).",
    );
  }
}

export class FakeDocRef {
  constructor(
    readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }

  collection(name: string): FakeCollectionRef {
    return new FakeCollectionRef(this.db, `${this.path}/${name}`);
  }
}

export class FakeSnapshot {
  constructor(
    readonly ref: FakeDocRef,
    private readonly stored: Data | undefined,
    private readonly fields?: string[],
  ) {}

  get id(): string {
    return this.ref.id;
  }

  get exists(): boolean {
    return this.stored !== undefined;
  }

  data(): Data | undefined {
    if (this.stored === undefined) {
      return undefined;
    }
    const copy = clone(this.stored);
    if (!this.fields) {
      return copy;
    }
    return Object.fromEntries(
      Object.entries(copy).filter(([key]) => this.fields?.includes(key)),
    );
  }
}

export class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    protected readonly collectionPath: string,
    protected readonly state: Omit<QueryRecord, "collection"> = {
      wheres: [],
      orderBys: [],
      offset: undefined,
      limit: undefined,
      select: undefined,
    },
  ) {}

  private next(patch: Partial<Omit<QueryRecord, "collection">>): FakeQuery {
    return new FakeQuery(this.db, this.collectionPath, { ...this.state, ...patch });
  }

  where(field: string, op: Operator, value: unknown): FakeQuery {
    return this.next({ wheres: [...this.state.wheres, { field, op, value }] });
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): FakeQuery {
    return this.next({
      orderBys: [...this.state.orderBys, { field, direction }],
    });
  }

  offset(offset: number): FakeQuery {
    return this.next({ offset });
  }

  limit(limit: number): FakeQuery {
    return this.next({ limit });
  }

  select(...fields: string[]): FakeQuery {
    return this.next({ select: fields });
  }

  async get(): Promise<{ docs: FakeSnapshot[] }> {
    const record: QueryRecord = { collection: this.collectionPath, ...this.state };
    assertNoCompositeIndex(record);
    this.db.queries.push(record);

    let entries = this.db
      .directChildren(this.collectionPath)
      .filter(({ data }) => record.wheres.every((where) => matches(data, where)));

    // Firestore leaves out documents that lack an orderBy field.
    for (const order of record.orderBys) {
      entries = entries.filter(({ data }) => comparable(data[order.field]) !== undefined);
    }
    for (const order of [...record.orderBys].reverse()) {
      const sign = order.direction === "desc" ? -1 : 1;
      entries = [...entries].sort((a, b) => {
        const left = comparable(a.data[order.field]) as number;
        const right = comparable(b.data[order.field]) as number;
        return left < right ? -sign : left > right ? sign : 0;
      });
    }

    const start = record.offset ?? 0;
    const end = record.limit === undefined ? undefined : start + record.limit;
    return {
      docs: entries
        .slice(start, end)
        .map(
          ({ path, data }) =>
            new FakeSnapshot(new FakeDocRef(this.db, path), data, record.select),
        ),
    };
  }
}

export class FakeCollectionRef extends FakeQuery {
  constructor(db: FakeFirestore, path: string) {
    super(db, path);
  }

  get path(): string {
    return this.collectionPath;
  }

  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.collectionPath}/${id ?? this.db.nextId()}`);
  }
}

export class FakeTransaction {
  private pending: FakeOp[] = [];

  constructor(private readonly db: FakeFirestore) {}

  private assertCanRead(): void {
    if (this.pending.length > 0) {
      throw new Error(
        "Firestore transactions require all reads to be executed before all writes.",
      );
    }
  }

  async get(ref: FakeDocRef): Promise<FakeSnapshot> {
    this.assertCanRead();
    return this.db.snapshot(ref);
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    if (refs.length === 0) {
      throw new Error("Function Transaction.getAll() requires at least 1 argument.");
    }
    this.assertCanRead();
    return refs.map((ref) => this.db.snapshot(ref));
  }

  create(ref: FakeDocRef, data: Data): this {
    this.pending.push({ kind: "create", path: ref.path, data: clone(data) });
    return this;
  }

  set(ref: FakeDocRef, data: Data): this {
    this.pending.push({ kind: "set", path: ref.path, data: clone(data) });
    return this;
  }

  update(ref: FakeDocRef, data: Data): this {
    this.pending.push({ kind: "update", path: ref.path, data: clone(data) });
    return this;
  }

  delete(ref: FakeDocRef): this {
    this.pending.push({ kind: "delete", path: ref.path });
    return this;
  }

  /** Applies every buffered write, or none of them if one is refused. */
  commit(): void {
    const next = new Map(this.db.rawDocs());
    const now = new FakeTimestamp(this.db.tick());
    const resolve = (data: Data): Data =>
      Object.fromEntries(
        Object.entries(clone(data)).map(([key, value]) => [
          key,
          value === SERVER_TIMESTAMP ? now : value,
        ]),
      );

    for (const op of this.pending) {
      switch (op.kind) {
        case "create":
          if (next.has(op.path)) {
            throw new Error(`6 ALREADY_EXISTS: ${op.path}`);
          }
          next.set(op.path, resolve(op.data));
          break;
        case "set":
          next.set(op.path, resolve(op.data));
          break;
        case "update": {
          const existing = next.get(op.path);
          if (!existing) {
            throw new Error(`5 NOT_FOUND: ${op.path}`);
          }
          next.set(op.path, { ...existing, ...resolve(op.data) });
          break;
        }
        case "delete":
          next.delete(op.path);
          break;
      }
    }

    this.db.replaceDocs(next, this.pending);
  }
}

export class FakeFirestore {
  private docs = new Map<string, Data>();
  private idCounter = 0;
  private clock: number;

  /** Every write that was COMMITTED, in order, as it was written. */
  readonly committed: FakeOp[] = [];
  readonly queries: QueryRecord[] = [];
  transactionsRun = 0;

  constructor(start: Date = new Date("2026-10-02T12:00:00Z")) {
    this.clock = start.getTime();
  }

  nextId(): string {
    this.idCounter += 1;
    return `auto${this.idCounter}`;
  }

  /** Advances the fake server clock by one second per commit. */
  tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  seed(path: string, data: Data): this {
    this.docs.set(path, clone(data));
    return this;
  }

  get(path: string): Data | undefined {
    const stored = this.docs.get(path);
    return stored === undefined ? undefined : clone(stored);
  }

  rawDocs(): Map<string, Data> {
    return this.docs;
  }

  replaceDocs(next: Map<string, Data>, ops: FakeOp[]): void {
    this.docs = next;
    this.committed.push(...ops.map((op) => clone(op)));
  }

  snapshot(ref: FakeDocRef): FakeSnapshot {
    return new FakeSnapshot(ref, this.docs.get(ref.path));
  }

  /** Direct children of a collection path, in insertion order. */
  directChildren(collectionPath: string): Array<{ path: string; data: Data }> {
    const prefix = `${collectionPath}/`;
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ path, data }));
  }

  /** Committed writes whose path matches, optionally of one kind. */
  opsMatching(pattern: RegExp, kind?: FakeOp["kind"]): FakeOp[] {
    return this.committed.filter(
      (op) => pattern.test(op.path) && (kind === undefined || op.kind === kind),
    );
  }

  collection(path: string): FakeCollectionRef {
    return new FakeCollectionRef(this, path);
  }

  async runTransaction<T>(
    update: (tx: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionsRun += 1;
    const tx = new FakeTransaction(this);
    // If `update` throws, nothing is committed.
    const result = await update(tx);
    tx.commit();
    return result;
  }
}

export const MOVEMENT_PATH = /^materials\/[^/]+\/movements\/[^/]+$/;
export const MATERIAL_PATH = /^materials\/[^/]+$/;
export const PURCHASE_PATH = /^purchases\/[^/]+$/;
export const CASTING_PATH = /^castings\/[^/]+$/;
export const AUDIT_PATH = /^auditLog\/[^/]+$/;
