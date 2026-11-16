import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

// Persistent, on-page rendering of the server's plain-language export
// refusal (the fail-closed 422 export gate). A toast alone disappears in
// seconds and leaves the family looking at an unchanged screen with no
// idea why nothing downloaded; the server's words stay on the page until
// the next attempt.
export const ExportBlockerNotice = ({ message }: { message: string }) => (
  <Alert variant="destructive">
    <AlertCircle className="h-4 w-4" />
    <AlertTitle>This book isn&rsquo;t quite ready to export</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
  </Alert>
);
