export function renderRequiredPasswordChange({ root, changePassword, logout, complete }) {
  root.innerHTML = `
    <main class="login-page">
      <form class="login-card required-password-card">
        <h1>Update your password</h1>
        <p>To protect your ATEC account, you must choose a new password before continuing.</p>
        <p>Use a unique password that nobody else knows. Never share it or use another person's login.</p>
        <label>Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="new_password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirm new password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="muted-text">Use at least 8 characters. If you cannot change your password, contact Jacques or your ATEC administrator.</p>
        <p role="alert" class="required-password-error"></p>
        <button type="submit">Update password and continue</button>
        <button type="button" class="secondary-btn" data-logout>Sign out</button>
      </form>
    </main>`
  const form = root.querySelector('form')
  const error = form.querySelector('[role="alert"]')
  const submit = form.querySelector('[type="submit"]')
  form.querySelector('[data-logout]').addEventListener('click', logout)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    error.textContent = ''
    const values = new FormData(form)
    if (values.get('new_password') !== values.get('confirm_password')) {
      error.textContent = 'New password and confirmation do not match.'
      return
    }
    submit.disabled = true
    try {
      await changePassword({ current_password: values.get('current_password'), new_password: values.get('new_password') })
      form.reset()
      await complete()
    } catch (err) {
      error.textContent = err.message || 'Unable to change your password. Please try again.'
      submit.disabled = false
    }
  })
}
