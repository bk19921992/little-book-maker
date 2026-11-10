import { FormEvent, ReactNode, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

interface AuthGateProps {
  children: ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const { user, loading, mode, setMode, error, clearError, signIn, signUp } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmationSent, setConfirmationSent] = useState(false);
  useEffect(() => {
    setMode(searchParams.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in');
  }, [searchParams, setMode]);
  const [formLoading, setFormLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || !password) {
      return;
    }

    setFormLoading(true);
    clearError();

    try {
      if (mode === 'sign-in') {
        await signIn(email, password);
      } else {
        setConfirmationSent(await signUp(email, password));
      }
    } catch (err) {
      console.error('[AuthGate] Authentication failed', err);
    } finally {
      setFormLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-soft" aria-label="Loading your books">
        <Loader2 className="w-8 h-8 animate-spin text-primary" aria-hidden="true" />
        <span role="status" className="sr-only">Opening your books</span>
      </main>
    );
  }

  if (user) {
    return <>{children}</>;
  }

  return (
    <main className="sprout-auth min-h-screen flex items-center justify-center bg-gradient-soft px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-2">
          <Link to="/" className="text-sm underline underline-offset-4">Story Sprout home</Link>
          <h1 className="text-2xl font-display font-semibold leading-none tracking-tight">
            {confirmationSent ? 'Check your email' : mode === 'sign-in' ? 'Sign in to continue' : 'Create your account'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {confirmationSent ? 'Confirm your email to finish setting up your account.' : mode === 'sign-in' ? 'Sign in to make a story or open your saved books.' : 'Create an account to make your first book free and keep your books in one place.'}
          </p>
        </CardHeader>
        <CardContent>
          {confirmationSent && <div role="status" className="mb-4 space-y-3 rounded-lg bg-muted p-4 text-sm"><p>We sent a confirmation link to {email}. Check your inbox and spam folder, then return here to sign in.</p><Button variant="outline" className="w-full" onClick={() => { setSearchParams({ mode: 'sign-in' }); setConfirmationSent(false); setPassword(''); clearError(); }}>Go to sign in</Button></div>}
          {!confirmationSent && <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-email">Email</label>
              <Input
                id="auth-email"
                name="email"
                autoComplete="email"
                spellCheck={false}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="auth-password">Password</label>
              <Input
                id="auth-password"
                name="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                minLength={mode === 'sign-up' ? 8 : undefined}
                aria-describedby={mode === 'sign-up' ? 'auth-password-hint' : undefined}
                required
              />
              {mode === 'sign-up' && <p id="auth-password-hint" className="text-xs text-muted-foreground">Use at least 8 characters.</p>}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : mode === 'sign-in' ? (
                <LogIn className="w-4 h-4 mr-2" />
              ) : (
                <UserPlus className="w-4 h-4 mr-2" />
              )}
              {mode === 'sign-in' ? 'Sign In' : 'Create Account'}
            </Button>
          </form>}

          {!confirmationSent && <div className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'sign-in' ? (
              <button
                className="text-primary font-medium"
                onClick={() => {
                  setSearchParams({ mode: 'sign-up' });
                  setConfirmationSent(false);
                  clearError();
                }}
                type="button"
              >
                Need an account? Create one
              </button>
            ) : (
              <button
                className="text-primary font-medium"
                onClick={() => {
                  setSearchParams({ mode: 'sign-in' });
                  setConfirmationSent(false);
                  clearError();
                }}
                type="button"
              >
                Have an account? Sign in
              </button>
            )}
          </div>}
        </CardContent>
      </Card>
    </main>
  );
};
