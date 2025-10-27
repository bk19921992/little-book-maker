// Simple session management for tracking first export usage
// Uses localStorage for client-side persistence (since no user accounts)

export interface SessionData {
  sessionId: string;
  firstExportUsed: boolean;
  createdAt: number;
  userId?: string;
}

const SESSION_KEY_PREFIX = 'storybook_session';

const getStorageKey = (userId?: string) =>
  userId ? `${SESSION_KEY_PREFIX}_${userId}` : SESSION_KEY_PREFIX;

export function getSession(userId?: string): SessionData {
  const storageKey = getStorageKey(userId);
  const stored = localStorage.getItem(storageKey);

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
    createdAt: Date.now(),
    userId,
  };

  localStorage.setItem(storageKey, JSON.stringify(newSession));
  return newSession;
}

export function updateSession(updates: Partial<SessionData>, userId?: string): SessionData {
  const session = getSession(userId);
  const updatedSession = { ...session, ...updates, userId: userId ?? session.userId };

  localStorage.setItem(getStorageKey(userId ?? session.userId), JSON.stringify(updatedSession));
  return updatedSession;
}

export function markFirstExportUsed(userId?: string): void {
  updateSession({ firstExportUsed: true }, userId);
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}