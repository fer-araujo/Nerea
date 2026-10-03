import "server-only";
import type {
  Firestore,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/admin/firebase/admin";
import { toJsonObject, type JsonObject } from "@/lib/admin/domain/backup";
import { readInBatches } from "./batched-read";
import { COLLECTIONS } from "./shared";

// The full backup of the admin's data, read for the "Descargar respaldo"
// download (app/admin/api/export/route.ts): EVERY collection, each in
// cursor-paged batches of 500 (see readInBatches), no composite index (each
// read is an unfiltered, unordered scan of one collection).
//
// The file holds personal data — the contact inbox has every visitor's name,
// email and message — so the route that serves it is admin-only, and nothing
// in this file ever logs a document.

export const BACKUP_FORMAT = 1;

/**
 * Safety ceiling PER COLLECTION, so a runaway collection can't exhaust the
 * server's memory. It is far above what this business will ever hold, and it
 * is never silent: a collection that reaches it is named in `truncated`
 * inside the file itself, so a partial backup can't pass for a whole one.
 */
export const BACKUP_MAX_DOCS = 50_000;

// How many materials have their movements read at once: bounds the parallel
// queries without making a long list of materials a long queue.
const MOVEMENT_READS_AT_ONCE = 10;

export interface BackupDocument {
  id: string;
  /** The document's fields as JSON; Timestamps are ISO strings. */
  data: JsonObject;
}

export interface BackupMaterial extends BackupDocument {
  /** The material's `movements` subcollection (its stock history). */
  movements: BackupDocument[];
}

export interface Backup {
  app: "nerea";
  format: typeof BACKUP_FORMAT;
  /** When the backup was read, ISO (UTC). */
  exportedAt: string;
  /**
   * Paths of the collections that reached BACKUP_MAX_DOCS and were cut. Empty
   * means the backup is complete.
   */
  truncated: string[];
  collections: {
    materials: BackupMaterial[];
    purchases: BackupDocument[];
    castings: BackupDocument[];
    pieces: BackupDocument[];
    sales: BackupDocument[];
    contactMessages: BackupDocument[];
    auditLog: BackupDocument[];
  };
}

export interface ReadBackupOptions {
  /** The instant stamped on the file (default: now). */
  now?: Date;
  /** Override of BACKUP_MAX_DOCS, for tests. */
  maxDocsPerCollection?: number;
}

function toBackupDocument(doc: QueryDocumentSnapshot): BackupDocument {
  return { id: doc.id, data: toJsonObject(doc.data()) };
}

async function readCollection(
  query: Query,
  path: string,
  cut: string[],
  maxDocs: number,
): Promise<BackupDocument[]> {
  const { rows, truncated } = await readInBatches(query, toBackupDocument, {
    limit: maxDocs,
  });
  if (truncated) {
    cut.push(path);
  }
  return rows;
}

async function readMaterials(
  db: Firestore,
  cut: string[],
  maxDocs: number,
): Promise<BackupMaterial[]> {
  const materials = await readCollection(
    db.collection(COLLECTIONS.materials),
    COLLECTIONS.materials,
    cut,
    maxDocs,
  );

  const withMovements: BackupMaterial[] = [];
  for (let from = 0; from < materials.length; from += MOVEMENT_READS_AT_ONCE) {
    const group = materials.slice(from, from + MOVEMENT_READS_AT_ONCE);
    // `async` so that a failure while BUILDING a query is a rejection like any
    // other, handled by Promise.all, instead of escaping half-way through the
    // group and leaving its siblings' rejections unhandled.
    const histories = await Promise.all(
      group.map(async (material) =>
        readCollection(
          db
            .collection(COLLECTIONS.materials)
            .doc(material.id)
            .collection(COLLECTIONS.movements),
          `${COLLECTIONS.materials}/${material.id}/${COLLECTIONS.movements}`,
          cut,
          maxDocs,
        ),
      ),
    );
    group.forEach((material, index) => {
      withMovements.push({ ...material, movements: histories[index] });
    });
  }
  return withMovements;
}

/**
 * Reads every collection the admin writes to: the materials with their
 * movements, the purchases, castings, pieces, sales, the contact messages and
 * the audit log. Returns `null` when Firebase isn't configured; a Firestore
 * failure rejects (and the route turns it into a plain 500).
 */
export async function readBackup(
  options: ReadBackupOptions = {},
): Promise<Backup | null> {
  const db = getAdminDb();
  if (!db) {
    return null;
  }

  const maxDocs = options.maxDocsPerCollection ?? BACKUP_MAX_DOCS;
  const cut: string[] = [];
  // `async`, as in readMaterials: building a query can fail like a read can.
  const scan = async (name: string) =>
    readCollection(db.collection(name), name, cut, maxDocs);

  // Independent collections, read together.
  const [
    materials,
    purchases,
    castings,
    pieces,
    sales,
    contactMessages,
    auditLog,
  ] = await Promise.all([
    readMaterials(db, cut, maxDocs),
    scan(COLLECTIONS.purchases),
    scan(COLLECTIONS.castings),
    scan(COLLECTIONS.pieces),
    scan(COLLECTIONS.sales),
    scan(COLLECTIONS.contactMessages),
    scan(COLLECTIONS.auditLog),
  ]);

  return {
    app: "nerea",
    format: BACKUP_FORMAT,
    exportedAt: (options.now ?? new Date()).toISOString(),
    // The reads finish in any order; sorted so the file is the same each time.
    truncated: [...cut].sort(),
    collections: {
      materials,
      purchases,
      castings,
      pieces,
      sales,
      contactMessages,
      auditLog,
    },
  };
}
