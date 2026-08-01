import assert from "node:assert/strict";
import test from "node:test";
import { DiffEditorReviewCommandService } from "../../src/application/review-commands/index";
test("diff command returns no-op for empty selection collection",async()=>{let opened=false;const service=new DiffEditorReviewCommandService<{side:"modified"}>({getSide:e=>e.side,getLineCount:()=>1,getSelections:()=>[],openSession:async()=>{opened=true;throw new Error("unexpected");},confirmWholeFileOperation:async()=>true,requestHistory:async()=>undefined});assert.equal(await service.markSelectionReviewed({side:"modified"}),"no-op");assert.equal(opened,false);});
