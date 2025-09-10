// Simple session management for tracking first export usage
// Uses localStorage for client-side persistence (since no user accounts)

export interface SessionData {
  sessionId: string;
  firstExportUsed: boolean;
  createdAt: number;
}

const SESSION_KEY = 'storybook_session';

export function getSession(): SessionData {
  const stored = localStorage.getItem(SESSION_KEY);
  
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      // Invalid data, create new session
    }
  }
  
  // Create new session
  const newSession: SessionData = {
    sessionId: generateSessionId(),
    firstExportUsed: false,
    createdAt: Date.now()
  };
  
  localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
  return newSession;
}

export function updateSession(updates: Partial<SessionData>): SessionData {
  const session = getSession();
  const updatedSession = { ...session, ...updates };
  
  localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
  return updatedSession;
}

export function markFirstExportUsed(): void {
  updateSession({ firstExportUsed: true });
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}