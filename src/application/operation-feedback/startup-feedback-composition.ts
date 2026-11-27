import {
  OperationFeedback,
  reportActiveOperationFailure,
  reportActiveStorageLockDiagnostic,
  setActiveOperationFeedback,
  type OperationFeedbackHost
} from "./operation-feedback";

export const awaitStartupWithFailureFeedback = async (
  startup: Promise<void>,
  label: string
): Promise<void> => {
  try {
    await startup;
  } catch (error) {
    reportActiveOperationFailure(label, error);
    throw error;
  }
};

/** Installs the production Output boundary before startup persistence runs. */
export const composeStartupFeedback = async (
  host: OperationFeedbackHost,
  startup: (notify: typeof reportActiveStorageLockDiagnostic) => Promise<void>
): Promise<void> => {
  setActiveOperationFeedback(new OperationFeedback(host));
  await startup(reportActiveStorageLockDiagnostic);
};
