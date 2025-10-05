import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AuthMode = 'sign-in' | 'sign-up';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  mode: AuthMode;
  error: string | null;
  setMode: (mode: AuthMode) => void;
  clearError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initialise = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (isMounted) {
          setUser(data.user ?? null);
        }
      } catch (err) {
        console.error('[AuthProvider] Failed to load user', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initialise();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        throw signInError;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in';
      setError(message);
      throw err;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window?.location?.origin ?? undefined },
      });
      if (signUpError) {
        throw signUpError;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign up';
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
      const message = err instanceof Error ? err.message : 'Unable to sign out';
      setError(message);
      throw err;
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    mode,
    error,
    setMode,
    clearError,
    signIn,
    signUp,
    signOut,
  }), [user, loading, mode, error, setMode, clearError, signIn, signUp, signOut]);

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
