export function wizardProgressLabel(currentStep, totalSteps) {
  return `Step ${currentStep + 1} of ${totalSteps}`
}

export function wizardProgressValue(currentStep, totalSteps) {
  return {
    value: Math.min(totalSteps, currentStep + 1),
    max: totalSteps
  }
}
