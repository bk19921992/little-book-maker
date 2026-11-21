import { StoryGenerator } from '@/components/StoryGenerator';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthGate } from '@/components/AuthGate';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// Deferred sign-up: visitors pick their story and preview its plan before
// being asked for an account. The auth wall appears only when they reach the
// paid steps (writing the full text, illustrations, PDF) or arrive via an
// explicit sign-in/sign-up link.
function BookAppInner() {
  const { user, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [authRequested, setAuthRequested] = useState(false);
  const modeParam = searchParams.get('mode');
  const showAuth = !loading && !user && (authRequested || modeParam === 'sign-up' || modeParam === 'sign-in');
  return (
    <>
      <StoryGenerator onRequestAuth={() => { setSearchParams({ mode: 'sign-up' }); setAuthRequested(true); }} />
      {showAuth && (
        <div className="sprout-auth-overlay" role="dialog" aria-modal="true" aria-label="Sign in or create your account">
          <div className="sprout-auth-overlay-bar">
            <button type="button" className="sprout-auth-overlay-back" onClick={() => { setAuthRequested(false); setSearchParams({}); }}>
              &larr; Keep building without an account
            </button>
          </div>
          <AuthGate>{null}</AuthGate>
        </div>
      )}
    </>
  );
}

export default function BookApp() {
  return <div className="sprout-app-entry"><AuthProvider><BookAppInner /></AuthProvider></div>;
}
