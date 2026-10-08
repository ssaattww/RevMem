import assert from "node:assert/strict";
import test from "node:test";

import {
  CatFileBatchResponseParser,
  MAX_GIT_BLOB_BATCH_OBJECTS,
  type CatFileBatchFrame,
} from "../../src/adapters/local-git/cat-file-batch-parser.js";

const oid = (character: string): string => character.repeat(40);

const collect = (
  parser: CatFileBatchResponseParser,
  chunks: readonly Uint8Array[],
): readonly CatFileBatchFrame[] => {
  const frames: CatFileBatchFrame[] = [];
  for (const chunk of chunks) frames.push(...parser.push(chunk));
  parser.finish();
  return frames;
};

test("cat-file batch parser preserves binary payload and zero-byte blobs across every byte boundary", () => {
  const firstOid = oid("a");
  const secondOid = "b".repeat(64);
  const payload = Buffer.from([0x61, 0x00, 0x0a, 0xff, 0x7a]);
  const wire = Buffer.concat([
    Buffer.from(`${firstOid} blob ${payload.length}\n`, "ascii"),
    payload,
    Buffer.from("\n", "ascii"),
    Buffer.from(`${secondOid} blob 0\n\n`, "ascii"),
  ]);
  const parser = new CatFileBatchResponseParser([firstOid, secondOid], 16);

  const frames = collect(parser, Array.from(wire, (byte) => Uint8Array.of(byte)));

  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { kind: "blob", objectId: firstOid, bytes: payload });
  assert.deepEqual(frames[1], { kind: "blob", objectId: secondOid, bytes: Buffer.alloc(0) });
});

test("cat-file batch parser distinguishes missing objects and non-blob object types", () => {
  const missingOid = oid("a");
  const treeOid = oid("b");
  const blobOid = oid("c");
  const wire = Buffer.concat([
    Buffer.from(`${missingOid} missing\n${treeOid} tree 3\n`, "ascii"),
    Buffer.from([0x00, 0x0a, 0xff, 0x0a]),
    Buffer.from(`${blobOid} blob 1\nx\n`, "ascii"),
  ]);
  const parser = new CatFileBatchResponseParser([missingOid, treeOid, blobOid], 16);

  assert.deepEqual(collect(parser, [wire]), [
    { kind: "missing", objectId: missingOid },
    { kind: "wrong-type", objectId: treeOid, type: "tree", size: 3 },
    { kind: "blob", objectId: blobOid, bytes: Buffer.from("x", "ascii") },
  ]);
});

test("cat-file batch parser drains an oversized blob frame without buffering it", () => {
  const oversizedOid = oid("a");
  const emptyOid = oid("b");
  const wire = Buffer.concat([
    Buffer.from(`${oversizedOid} blob 4\n`, "ascii"),
    Buffer.from([0x00, 0x0a, 0xff, 0x7f, 0x0a]),
    Buffer.from(`${emptyOid} blob 0\n\n`, "ascii"),
  ]);
  const parser = new CatFileBatchResponseParser([oversizedOid, emptyOid], 3);

  assert.deepEqual(collect(parser, [wire]), [
    { kind: "too-large", objectId: oversizedOid, size: 4 },
    { kind: "blob", objectId: emptyOid, bytes: Buffer.alloc(0) },
  ]);
});

test("cat-file batch parser rejects incomplete, malformed, mismatched, and extra frames", () => {
  const expectedOid = oid("a");
  const anotherOid = oid("b");
  const invalidWires = [
    { label: "truncated header", wire: Buffer.from(`${expectedOid} blob `, "ascii") },
    { label: "non-decimal size", wire: Buffer.from(`${expectedOid} blob 1.5\n`, "ascii") },
    { label: "unsafe integer size", wire: Buffer.from(`${expectedOid} blob 9007199254740992\n`, "ascii") },
    { label: "leading-zero size", wire: Buffer.from(`${expectedOid} blob 01\n`, "ascii") },
    { label: "OID mismatch", wire: Buffer.from(`${anotherOid} blob 0\n\n`, "ascii") },
    { label: "unknown type syntax", wire: Buffer.from(`${expectedOid} BLOB 0\n\n`, "ascii") },
    { label: "unknown object type", wire: Buffer.from(`${expectedOid} blobish 0\n\n`, "ascii") },
    { label: "truncated payload", wire: Buffer.from(`${expectedOid} blob 2\nx`, "ascii") },
    { label: "missing payload LF", wire: Buffer.from(`${expectedOid} blob 1\nx`, "ascii") },
    { label: "extra frame", wire: Buffer.from(`${expectedOid} blob 0\n\n${anotherOid} missing\n`, "ascii") },
  ];

  for (const invalid of invalidWires) {
    const parser = new CatFileBatchResponseParser([expectedOid], 16);
    assert.throws(() => {
      parser.push(invalid.wire);
      parser.finish();
    }, invalid.label);
  }
});

test("cat-file batch parser is poisoned after a push protocol error", () => {
  const expectedOid = oid("a");
  const parser = new CatFileBatchResponseParser([expectedOid], 16);

  assert.throws(() => parser.push(Buffer.from(`${expectedOid} blobish 0\n\n`, "ascii")), /unknown object type/u);
  assert.throws(() => parser.push(Buffer.from(`${expectedOid} blob 0\n\n`, "ascii")), /poisoned/u);
  assert.throws(() => parser.finish(), /poisoned/u);
});

test("cat-file batch parser is poisoned after finish detects a truncated frame", () => {
  const expectedOid = oid("a");
  const parser = new CatFileBatchResponseParser([expectedOid], 16);

  parser.push(Buffer.from(`${expectedOid} blob 2\nx`, "ascii"));

  assert.throws(() => parser.finish(), /Truncated/u);
  assert.throws(() => parser.push(Buffer.from("y\n", "ascii")), /poisoned/u);
  assert.throws(() => parser.finish(), /poisoned/u);
});

test("cat-file batch parser rejects a response that omits requested objects", () => {
  const firstOid = oid("a");
  const secondOid = oid("b");
  const parser = new CatFileBatchResponseParser([firstOid, secondOid], 16);

  parser.push(Buffer.from(`${firstOid} missing\n`, "ascii"));

  assert.throws(() => parser.finish(), /expected 2 response frames/u);
});

test("cat-file batch parser enforces the 128-object operation boundary", () => {
  const objectIds = Array.from({ length: MAX_GIT_BLOB_BATCH_OBJECTS }, (_, index) =>
    index.toString(16).padStart(40, "0"));

  assert.doesNotThrow(() => new CatFileBatchResponseParser(objectIds, 0));
  assert.throws(
    () => new CatFileBatchResponseParser([...objectIds, oid("f")], 0),
    /at most 128 object IDs/u,
  );
});
