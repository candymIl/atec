export function createWizardState(initialStep = 0) {
  return {
    currentStep: initialStep,
    dirty: false,
    submitting: false
  }
}

export function markWizardDirty(state) {
  if (state) state.dirty = true
  return state
}

export function beginWizardSubmit(state) {
  if (!state || state.submitting) return false
  state.submitting = true
  return true
}

export function endWizardSubmit(state) {
  if (state) state.submitting = false
  return state
}
