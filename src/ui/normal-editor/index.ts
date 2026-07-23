/** Public UI API for normal-editor review command registration and decoration. */
export {
  NORMAL_EDITOR_REVIEW_COMMAND_IDS,
  createRefreshingNormalEditorReviewCommandHandlers,
  registerNormalEditorReviewCommands,
  type CommandDisposable,
  type NormalEditorDecorationRefresher,
  type NormalEditorCommandHost,
  type NormalEditorReviewCommandHandlers
} from "./review-command-registration";

export {
  NormalEditorDecorationController,
  type DecorationDisposable,
  type NormalEditorDecorationHost,
  type NormalEditorDecorationSettings
} from "./normal-editor-decoration-controller";
