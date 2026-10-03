import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Download, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { deleteBook, listBooks, openBook, pdfDownloadLink, type SavedBookSummary } from '../lib/savedBooks';
import type { StoryConfig } from '../types';

interface MyBooksProps {
  open: boolean;
  userId: string;
  onOpenChange: (open: boolean) => void;
  onOpenBook: (config: StoryConfig) => void;
}

// The customer's saved books: reopen one to edit or export again, download
// its PDF, or delete it.
export const MyBooks: React.FC<MyBooksProps> = ({ open, userId, onOpenChange, onOpenBook }) => {
  const [books, setBooks] = useState<SavedBookSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks(supabase));
    } catch (error) {
      console.error('Loading saved books failed', error);
      toast.error("We couldn't load your books. Please try again.");
      setBooks([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setBooks(null);
      refresh();
    }
  }, [open, refresh]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const reopen = (book: SavedBookSummary) => run(`open:${book.storyId}`, async () => {
    try {
      onOpenBook(await openBook(supabase, book.storyId));
      onOpenChange(false);
    } catch (error) {
      console.error('Opening book failed', error);
      toast.error("We couldn't open that book. Please try again.");
    }
  });

  const download = (book: SavedBookSummary) => run(`pdf:${book.storyId}`, async () => {
    try {
      window.location.href = await pdfDownloadLink(supabase, book.webPdfPath!, `${book.title}.pdf`);
    } catch (error) {
      console.error('PDF link failed', error);
      toast.error("We couldn't fetch that PDF. Please try again.");
    }
  });

  const remove = (book: SavedBookSummary) => run(`del:${book.storyId}`, async () => {
    if (!window.confirm(`Delete "${book.title}"? This removes its pictures and PDFs for good.`)) return;
    try {
      await deleteBook(supabase, userId, book.storyId);
      await refresh();
    } catch (error) {
      console.error('Delete failed', error);
      toast.error("We couldn't delete that book. Please try again.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>My books</DialogTitle>
          <DialogDescription>Every book you make is saved here. Open one to edit it or export it again.</DialogDescription>
        </DialogHeader>
        {books === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading your books...</div>
        ) : books.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No saved books yet. Books are saved as soon as their pictures are ready.</p>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-y-auto">
            {books.map((book) => (
              <li key={book.storyId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{book.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {book.pageCount} pages{book.pageSize ? ` · ${book.pageSize}` : ''} · saved {new Date(book.updatedAt).toLocaleDateString('en-GB')}
                    {book.exportedAt ? ' · PDF ready' : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => reopen(book)} disabled={!!busy}>
                    {busy === `open:${book.storyId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4 mr-1" />}Open
                  </Button>
                  {book.webPdfPath && (
                    <Button size="sm" variant="outline" onClick={() => download(book)} disabled={!!busy}>
                      <Download className="w-4 h-4 mr-1" />PDF
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" aria-label={`Delete ${book.title}`} onClick={() => remove(book)} disabled={!!busy}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
