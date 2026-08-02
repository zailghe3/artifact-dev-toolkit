const variationErrorMessages: Record<string, string> = {
  validation_failed: "Enter a valid title and non-empty body.",
  secret_rejected: "The variation contains content that resembles a secret or API key.",
  artifact_too_large: "The variation is too large to save.",
  duplicate_artifact: "A variation with this generated ID already exists. Try saving again.",
  write_permission_required: "The GitHub App does not have permission to create variations.",
  repository_authentication_failed: "GitHub repository authentication failed. Sign in again or contact the administrator.",
  repository_unavailable: "The artifact repository is temporarily unavailable. Try again.",
  repository_configuration: "Variation storage is not correctly configured.",
};

export const unknownVariationErrorMessage = "The variation could not be saved.";

export function variationErrorMessage(code: unknown) {
  return typeof code === "string" ? variationErrorMessages[code] ?? unknownVariationErrorMessage : unknownVariationErrorMessage;
}
