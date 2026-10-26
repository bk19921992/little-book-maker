import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { coverImageLinks, deleteBook, listBooks, openBook, pdfDownloadLink, type SavedBookSummary } from '../lib/savedBooks';
import type { StoryConfig } from '../types';

interface MyBooksProps {
  open: boolean;
  userId: string;
  onOpenChange: (open: boolean) => void;
  onOpenBook: (config: StoryConfig) => void;
  // Called after a book is actually deleted so the parent can drop any editor
  // state for it (otherwise autosave could quietly re-save a deleted book).
  onDeletedBook?: (storyId: string) => void;
  // Called by the empty-state call to action so "Make your first book" starts a
  // genuinely fresh book instead of just closing the dialog.
  onMakeBook?: () => void;
  // Defaults to the app's client; injected only by isolated fixture renders.
  db?: SupabaseClient;
}

// A delete target is bound to the account that was loaded when it was chosen;
// the confirmation re-checks the binding before anything is removed.
interface PendingDelete {
  book: SavedBookSummary;
  ownerId: string;
}

// The customer's saved books: reopen one to edit or export again, download
// its PDF, or delete it.
export const MyBooks: React.FC<MyBooksProps> = ({ open, userId, onOpenChange, onOpenBook, onDeletedBook, onMakeBook, db = supabase }) => {
  const [books, setBooks] = useState<SavedBookSummary[] | null>(null);
  const [covers, setCovers] = useState<Map<string, string>>(new Map());
  const [failedCovers, setFailedCovers] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const deleteInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listBooks(db);
      setBooks(list);
      // Cover thumbnails are optional decoration: a signing failure must never
      // turn a loaded library into a false empty list.
      try {
        const paths = list.map((book) => book.coverImagePath).filter((path): path is string => !!path);
        setCovers(await coverImageLinks(db, paths));
      } catch (coverError) {
        console.error('Loading book covers failed', coverError);
        setCovers(new Map());
      }
    } catch (error) {
      console.error('Loading saved books failed', error);
      toast.error("We couldn't load your books. Please try again.");
      setBooks([]);
      setCovers(new Map());
    }
  }, [db]);

  // Opening the dialog, closing it, or a change of signed-in account all
  // invalidate the previous read and any pending delete target.
  useEffect(() => {
    setPendingDelete(null);
    setFailedCovers(new Set());
    if (open) {
      setBooks(null);
      setCovers(new Map());
      void refresh();
    }
  }, [open, userId, refresh]);

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
      onOpenBook(await openBook(db, book.storyId));
      onOpenChange(false);
    } catch (error) {
      console.error('Opening book failed', error);
      toast.error("We couldn't open that book. Please try again.");
    }
  });

  const download = (book: SavedBookSummary) => run(`pdf:${book.storyId}`, async () => {
    try {
      window.location.href = await pdfDownloadLink(db, book.webPdfPath!, `${book.title}.pdf`);
    } catch (error) {
      console.error('PDF link failed', error);
      toast.error("We couldn't fetch that PDF. Please try again.");
    }
  });

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    // Guard the synchronous double-action window before state can disable anything.
    if (deleteInFlight.current) return;
    // The account changed while the confirmation was open: never delete against
    // a different user than the one whose library listed this book.
    if (target.ownerId !== userId) return;
    deleteInFlight.current = true;
    void run(`del:${target.book.storyId}`, async () => {
      try {
        await deleteBook(db, userId, target.book.storyId);
        onDeletedBook?.(target.book.storyId);
        await refresh();
      } catch (error) {
        console.error('Delete failed', error);
        toast.error("We couldn't delete that book. Please try again.");
      } finally {
        deleteInFlight.current = false;
      }
    });
  };

  const coverFor = (book: SavedBookSummary): string | undefined => {
    if (!book.coverImagePath || failedCovers.has(book.coverImagePath)) return undefined;
    return covers.get(book.coverImagePath);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>My books</DialogTitle>
            <DialogDescription>Every book you make is saved here. Open one to edit it or export it again.</DialogDescription>
          </DialogHeader>
          {books === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading your books...</div>
          ) : books.length === 0 ? (
            <div className="py-6 space-y-4">
              <p className="text-sm text-muted-foreground">No saved books yet. Books are saved as soon as their pictures are ready.</p>
              <Button size="sm" onClick={() => { onOpenChange(false); onMakeBook?.(); }}>Make your first book</Button>
            </div>
          ) : (
            <ul className="divide-y max-h-[60vh] overflow-y-auto">
              {books.map((book) => {
                const coverUrl = coverFor(book);
                return (
                  <li key={book.storyId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="w-12 h-12 rounded-md object-cover flex-none bg-muted"
                          onError={() => setFailedCovers((prev) => new Set(prev).add(book.coverImagePath!))}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center flex-none" aria-hidden="true">
                          <BookOpen className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{book.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {book.pageCount} pages{book.pageSize ? ` · ${book.pageSize}` : ''} · saved {new Date(book.updatedAt).toLocaleDateString('en-GB')}
                          {book.exportedAt ? ' · PDF ready' : ''}
                        </div>
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
                      <Button size="sm" variant="ghost" aria-label={`Delete ${book.title}`} onClick={() => setPendingDelete({ book, ownerId: userId })} disabled={!!busy}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pendingDelete?.book.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the book, its pictures and its PDFs for good. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep book</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
