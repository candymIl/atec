export function nextWizardStep(currentStep, totalSteps) {
  return Math.min(totalSteps - 1, currentStep + 1)
}

export function previousWizardStep(currentStep) {
  return Math.max(0, currentStep - 1)
}

export function isWizardReviewStep(currentStep, totalSteps) {
  return currentStep === totalSteps - 1
}
