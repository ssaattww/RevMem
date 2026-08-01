import assert from "node:assert/strict";
import test from "node:test";
import { ReviewDiffUriCodec } from "../../src/application/diff-document/index";
import { ReviewDiffEditorController, type ReviewDiffEditorHost } from "../../src/ui/diff-editor/index";
interface FakeUri { readonly value:string }
class Host implements ReviewDiffEditorHost<FakeUri>{parsed:string[]=[];opened:Array<{original:FakeUri;modified:FakeUri;title:string}>=[];parseUri(value:string){this.parsed.push(value);return{value};}async openDiff(original:FakeUri,modified:FakeUri,title:string){this.opened.push({original,modified,title});}}
const base="0123456789abcdef0123456789abcdef01234567",head="89abcdef0123456789abcdef0123456789abcdef";
test("opens canonical original then modified",async()=>{const host=new Host(),codec=new ReviewDiffUriCodec(),controller=new ReviewDiffEditorController(codec,host);await controller.openReviewDiff({contextId:"c",fileSystemPathSemantics:"posix",original:{filePath:"old.ts",revision:base},modified:{filePath:"new.ts",revision:head},title:"diff"});assert.equal(host.parsed.length,2);assert.equal(codec.decode(host.parsed[0]!).side,"original");assert.equal(codec.decode(host.parsed[1]!).side,"modified");assert.equal(host.opened[0]!.title,"diff");});
test("rejects empty title",async()=>{const host=new Host(),controller=new ReviewDiffEditorController(new ReviewDiffUriCodec(),host);await assert.rejects(controller.openReviewDiff({contextId:"c",fileSystemPathSemantics:"posix",original:{filePath:"a.ts",revision:base},modified:{filePath:"a.ts",revision:head},title:" "}),/title/);assert.equal(host.parsed.length,0);});
