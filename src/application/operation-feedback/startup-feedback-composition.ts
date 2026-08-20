import {
  OperationFeedback,
  reportActiveStorageLockDiagnostic,
  setActiveOperationFeedback,
  type OperationFeedbackHost
} from "./operation-feedback";

/** Installs the production Output boundary before startup persistence runs. */
export const composeStartupFeedback = async (
  host: OperationFeedbackHost,
  startup: (notify: typeof reportActiveStorageLockDiagnostic) => Promise<void>
): Promise<void> => {
  setActiveOperationFeedback(new OperationFeedback(host));
  await startup(reportActiveStorageLockDiagnostic);
};
