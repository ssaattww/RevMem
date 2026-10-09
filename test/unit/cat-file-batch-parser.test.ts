import { MAX_GIT_BLOB_BATCH_OBJECTS } from "../../src/adapters/local-git/git-blob-reader.js";
import assert from "node:assert/strict";
import test from "node:test";

import {
  CatFileBatchResponseParser,
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

test("cat-file batch parser completes frames within a positive blob limit, including a zero-byte payload", () => {
  const exactLimitOid = oid("a");
  const zeroLimitOid = oid("b");
  const parser = new CatFileBatchResponseParser([exactLimitOid, zeroLimitOid], 3);

  assert.deepEqual(collect(parser, [Buffer.from(
    `${exactLimitOid} blob 3\nabc\n${zeroLimitOid} blob 0\n\n`, "ascii",
  )]), [
    { kind: "blob", objectId: exactLimitOid, bytes: Buffer.from("abc", "ascii") },
    { kind: "blob", objectId: zeroLimitOid, bytes: Buffer.alloc(0) },
  ]);
});

test("cat-file batch parser accepts zero-byte blobs and drains one-byte blobs at a zero-byte limit", () => {
  const oversizedOid = oid("a");
  const emptyOid = oid("b");
  const parser = new CatFileBatchResponseParser([oversizedOid, emptyOid], 0);

  assert.deepEqual(collect(parser, [Buffer.from(
    `${oversizedOid} blob 1\nx\n${emptyOid} blob 0\n\n`, "ascii",
  )]), [
    { kind: "too-large", objectId: oversizedOid, size: 1 },
    { kind: "blob", objectId: emptyOid, bytes: Buffer.alloc(0) },
  ]);
});

test("cat-file batch parser does not buffer an oversized safe-integer declaration before truncated EOF", () => {
  const expectedOid = oid("a");
  const parser = new CatFileBatchResponseParser([expectedOid], 0);

  assert.deepEqual(parser.push(Buffer.from(`${expectedOid} blob 9007199254740991\n`, "ascii")), []);
  assert.deepEqual(parser.push(Buffer.from([0x78, 0x79])), []);
  const pending = Object.getOwnPropertyDescriptor(parser, "pendingObject")?.value as
    { readonly bytes?: Uint8Array } | undefined;
  assert.equal(pending?.bytes, undefined);
  assert.throws(() => parser.finish(), /Truncated/u);
});

test("cat-file batch parser enforces the header byte limit at exactly 128 bytes", () => {
  const expectedOid = "a".repeat(64);
  const exactLimitType = "x".repeat(46);
  const overLimitType = "x".repeat(47);
  const exactLimitHeader = `${expectedOid} ${exactLimitType} 9007199254740991`;
  const overLimitHeader = `${expectedOid} ${overLimitType} 9007199254740991`;

  assert.equal(Buffer.byteLength(exactLimitHeader, "ascii"), 128);
  assert.equal(Buffer.byteLength(overLimitHeader, "ascii"), 129);
  assert.throws(
    () => new CatFileBatchResponseParser([expectedOid], 0).push(Buffer.from(`${exactLimitHeader}\n`, "ascii")),
    /unknown object type/u,
  );
  assert.throws(
    () => new CatFileBatchResponseParser([expectedOid], 0).push(Buffer.from(`${overLimitHeader}\n`, "ascii")),
    /header exceeds its byte limit/u,
  );
});

test("cat-file batch parser rejects invalid blob limits", () => {
  const expectedOid = oid("a");
  for (const invalidLimit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new CatFileBatchResponseParser([expectedOid], invalidLimit), /non-negative safe integer/u);
  }
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

test("cat-file batch parser releases a pending blob buffer when it becomes poisoned", () => {
  const expectedOid = oid("a");
  const parser = new CatFileBatchResponseParser([expectedOid], 1024 * 1024);
  const size = 1024 * 1024;

  parser.push(Buffer.from(`${expectedOid} blob ${size}\n`, "ascii"));
  parser.push(Buffer.alloc(size, 0x78));
  const pendingBeforeError = Object.getOwnPropertyDescriptor(parser, "pendingObject")?.value as
    { readonly bytes?: Uint8Array } | undefined;
  assert.equal(pendingBeforeError?.bytes?.byteLength, size);

  assert.throws(() => parser.push(Buffer.from("!", "ascii")), /LF terminator/u);

  assert.equal(Object.getOwnPropertyDescriptor(parser, "pendingObject")?.value, undefined);
  assert.throws(() => parser.finish(), /poisoned/u);
});

test("cat-file batch parser rejects every push and finish after successful finish", () => {
  const expectedOid = oid("a");
  const parser = new CatFileBatchResponseParser([expectedOid], 16);

  parser.push(Buffer.from(`${expectedOid} blob 0\n\n`, "ascii"));
  parser.finish();

  assert.throws(() => parser.push(new Uint8Array(0)), /already finished/u);
  assert.throws(() => parser.push(Buffer.from("extra", "ascii")), /already finished/u);
  assert.throws(() => parser.finish(), /already finished/u);
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
