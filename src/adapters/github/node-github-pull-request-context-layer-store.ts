import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  cloneGitHubPullRequestContextLayer,
  normalizeGitHubPullRequestContextLayer,
  type GitHubPullRequestContextLayer,
  type GitHubPullRequestContextLayerDocument,
} from "../../application/github-pr-context/index";

const STORAGE_FILE_NAME = "github-pr-context-layers.v1.json";

export class NodeGitHubPullRequestContextLayerStore {
  readonly #storagePath: string;
  public constructor(globalStoragePath: string) {
    if (!path.isAbsolute(globalStoragePath)) throw new Error("globalStoragePath must be absolute");
    this.#storagePath = path.join(globalStoragePath, STORAGE_FILE_NAME);
  }
  public async list(): Promise<readonly GitHubPullRequestContextLayer[]> {
    return (await this.#read()).layers.map(cloneGitHubPullRequestContextLayer).sort((a,b)=>a.contextId.localeCompare(b.contextId));
  }
  public async get(contextId: string): Promise<GitHubPullRequestContextLayer | undefined> {
    const found=(await this.#read()).layers.find((layer)=>layer.contextId===contextId);
    return found===undefined?undefined:cloneGitHubPullRequestContextLayer(found);
  }
  public async upsert(candidate: GitHubPullRequestContextLayer): Promise<GitHubPullRequestContextLayer> {
    const normalized=normalizeGitHubPullRequestContextLayer(candidate);
    const current=await this.#read();
    await this.#write({version:1,layers:[...current.layers.filter((layer)=>layer.contextId!==normalized.contextId),normalized]});
    return cloneGitHubPullRequestContextLayer(normalized);
  }
  public async remove(contextId:string):Promise<boolean>{ const current=await this.#read(); const layers=current.layers.filter((layer)=>layer.contextId!==contextId); if(layers.length===current.layers.length)return false; await this.#write({version:1,layers}); return true; }
  async #read():Promise<GitHubPullRequestContextLayerDocument>{ let text:string; try{text=await readFile(this.#storagePath,"utf8");}catch(error:unknown){if(isNodeError(error)&&error.code==="ENOENT")return {version:1,layers:[]}; throw error;} let parsed:unknown; try{parsed=JSON.parse(text);}catch(error:unknown){throw new Error("GitHub PR context layer storage is invalid JSON",{cause:error});} if(!isRecord(parsed)||parsed.version!==1||!Array.isArray(parsed.layers))throw new Error("GitHub PR context layer storage has an unsupported schema"); const layers=parsed.layers.map(normalizeGitHubPullRequestContextLayer); const ids=new Set<string>(); for(const layer of layers){if(ids.has(layer.contextId))throw new Error(`Duplicate GitHub PR context layer: ${layer.contextId}`); ids.add(layer.contextId);} return {version:1,layers}; }
  async #write(document:GitHubPullRequestContextLayerDocument):Promise<void>{await mkdir(path.dirname(this.#storagePath),{recursive:true}); const temporaryPath=`${this.#storagePath}.${process.pid}.${Date.now()}.tmp`; try{await writeFile(temporaryPath,JSON.stringify(document),{encoding:"utf8",mode:0o600,flag:"wx"}); await rename(temporaryPath,this.#storagePath);}finally{await rm(temporaryPath,{force:true});}}
}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
function isNodeError(value:unknown):value is NodeJS.ErrnoException{return value instanceof Error&&"code" in value;}
