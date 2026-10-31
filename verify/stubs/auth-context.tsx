import React, { ReactNode } from 'react';
// Harness stub: a signed-in user, no session machinery.
export const AuthProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export const useAuth = () => ({
  user: { id: 'verify-user', email: 'verify@example.invalid' } as any,
  loading: false,
  mode: 'sign-in' as const,
  error: null,
  setMode: () => {},
  clearError: () => {},
  signIn: async () => {},
  signUp: async () => true,
  signOut: async () => {},
});
