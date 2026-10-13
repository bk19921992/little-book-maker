import { StoryGenerator } from '@/components/StoryGenerator';
import { AuthProvider } from '@/context/AuthContext';
import { AuthGate } from '@/components/AuthGate';

export default function BookApp() {
  return <div className="sprout-app-entry"><AuthProvider><AuthGate><StoryGenerator /></AuthGate></AuthProvider></div>;
}
