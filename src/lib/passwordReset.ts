export const PASSWORD_MIN_LENGTH = 8;

export interface NewPasswordCheck {
  valid: boolean;
  message: string | null;
}

// Validate the replacement password and its confirmation before calling Supabase.
export function checkNewPassword(password: string, confirmation: string): NewPasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password !== confirmation) {
    return { valid: false, message: 'The two passwords do not match.' };
  }
  return { valid: true, message: null };
}

// Only recovery links carry type=recovery; sign-up confirmations and sign-ins must not open the reset form.
export function isRecoveryCallback(search: string, hash: string): boolean {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  return query.get('type') === 'recovery' || fragment.get('type') === 'recovery';
}
