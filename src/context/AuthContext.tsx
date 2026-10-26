import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { formatSupabaseConnectionError, supabase, supabaseConfigError } from '@/integrations/supabase/client';
import { isRecoveryCallback } from '@/lib/passwordReset';

type AuthMode = 'sign-in' | 'sign-up';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  mode: AuthMode;
  error: string | null;
  recoveryActive: boolean;
  setMode: (mode: AuthMode) => void;
  clearError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  endRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [error, setError] = useState<string | null>(null);
  // Open the reset form even if the PASSWORD_RECOVERY event fired before this listener attached.
  const [recoveryActive, setRecoveryActive] = useState(() => isRecoveryCallback(window.location.search, window.location.hash));

  useEffect(() => {
    let isMounted = true;

    const initialise = async () => {
      try {
        if (supabaseConfigError) {
          throw new Error(supabaseConfigError);
        }

        const { data } = await supabase.auth.getUser();
        if (isMounted) {
          setUser(data.user ?? null);
        }
      } catch (err) {
        console.error('[AuthProvider] Failed to load user', err);
        if (isMounted) {
          setError(formatSupabaseConnectionError(err));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initialise();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryActive(true);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        throw signInError;
      }
    } catch (err) {
      const message = formatSupabaseConnectionError(err) || 'Unable to sign in';
      setError(message);
      throw err;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (signUpError) {
        throw signUpError;
      }
      return !data.session;
    } catch (err) {
      const message = formatSupabaseConnectionError(err) || 'Unable to sign up';
      setError(message);
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }
    } catch (err) {
      const message = formatSupabaseConnectionError(err) || 'Unable to sign out';
      setError(message);
      throw err;
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    setError(null);
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (resetError) {
        throw resetError;
      }
    } catch (err) {
      const message = formatSupabaseConnectionError(err) || 'Unable to send the reset email';
      setError(message);
      throw err;
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    setError(null);
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        throw updateError;
      }
      setRecoveryActive(false);
    } catch (err) {
      const message = formatSupabaseConnectionError(err) || 'Unable to save the new password';
      setError(message);
      throw err;
    }
  }, []);

  const endRecovery = useCallback(() => setRecoveryActive(false), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    mode,
    error,
    recoveryActive,
    setMode,
    clearError,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    endRecovery,
  }), [user, loading, mode, error, recoveryActive, setMode, clearError, signIn, signUp, signOut, requestPasswordReset, updatePassword, endRecovery]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
