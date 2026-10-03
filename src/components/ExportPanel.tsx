import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Download,
  FileText,
  Printer,
  ExternalLink,
  CheckCircle,
  Loader2,
  Package,
  CreditCard,
  AlertCircle
} from 'lucide-react';
import { StoryConfig } from '../types';
import { api } from '../api';
import { toast } from 'sonner';
import { CheckoutSheet } from '@/components/CheckoutSheet';
import { recheckUnreviewedImages } from '../lib/reviewGate';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validateAddress, type ShippingAddress } from '../../supabase/functions/create-print-order/print.ts';
import { saveBook, withDownloadName } from '../lib/savedBooks';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';

// Print stays hidden until Phase 5 - the server refuses orders while the flag is off too.
const PRINT_ENABLED = import.meta.env.VITE_PRINT_ENABLED === 'true';

interface ExportPanelProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onBack: () => void;
  onReset: () => void;
}


export const ExportPanel: React.FC<ExportPanelProps> = ({
  config,
  onConfigChange,
  onBack,
  onReset,
}) => {
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingImages, setIsCheckingImages] = useState(false);
  const [imageCheckMessage, setImageCheckMessage] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [address, setAddress] = useState<ShippingAddress>({ name: '', email: user?.email || '', line1: '', line2: '', city: '', postcode: '', country: 'GB' });
  const [addressErrors, setAddressErrors] = useState<string[]>([]);
  const [printResult, setPrintResult] = useState<{
    ok: boolean;
    provider: string;
    orderId?: string;
    checkoutUrl?: string;
    error?: string;
  } | null>(null);
  const [showExportCheckout, setShowExportCheckout] = useState(false);
  const [showPrintCheckout, setShowPrintCheckout] = useState(false);

  const exportPDF = async () => {
    if (!config.pages || config.pages.length === 0) {
      toast.error('No pages to export');
      return;
    }
    if (!config.storyId) {
      toast.error('This book is missing its id - please go back and generate again.');
      return;
    }

    setIsExporting(true);
    try {
      const response = await api.exportPDF(config, config.pages, config.storyId, true, config.coverImageUrl);

      onConfigChange({
        exports: {
          webPdfUrl: response.webPdfUrl,
          printPdfUrl: response.printPdfUrl,
        },
      });

      toast.success('PDFs generated successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate PDFs';
      toast.error(message);
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
      setShowExportCheckout(false);
    }
  };

  const handleExportClick = async () => {
    // Illustrations the QA reviewer could not check when they were made are
    // re-checked BEFORE checkout, so nobody pays for (or exports) unverified
    // art. Then billing (free first export or payment) is settled with the
    // server as before.
    setImageCheckMessage(null);
    setIsCheckingImages(true);
    try {
      const { updates, blockMessage } = await recheckUnreviewedImages(api, config);
      if (Object.keys(updates).length) onConfigChange(updates);
      if (blockMessage) {
        setImageCheckMessage(blockMessage);
        toast.error(blockMessage);
        return;
      }
    } catch (error) {
      const message = "We couldn't check your illustrations just now. Please try again in a moment.";
      console.error('Image re-check failed', error);
      setImageCheckMessage(message);
      toast.error(message);
      return;
    } finally {
      setIsCheckingImages(false);
    }
    // Save the book to the account before the customer pays, so a paid book
    // survives a closed tab. A save failure is not a reason to block them.
    if (user && config.storyId) {
      try {
        await saveBook(supabase, user.id, config);
      } catch (saveError) {
        console.error('Saving the book before checkout failed', saveError);
      }
    }
    setShowExportCheckout(true);
  };

  const handleExportSuccess = () => {
    setShowExportCheckout(false);
    exportPDF();
  };

  const createPrintOrder = async () => {
    if (!config.storyId) return;
    setIsPrinting(true);
    try {
      const response = await api.createPrintOrder(config.storyId, address);
      setPrintResult(response);
      if (response.ok) {
        toast.success('Your printed book is ordered!');
      } else {
        toast.error(response.error ?? "We couldn't place the order. Please try again.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't place the order. Please try again.";
      setPrintResult({ ok: false, provider: 'PEECHO', error: message });
      toast.error(message);
      console.error('Print error:', error);
    } finally {
      setIsPrinting(false);
      setShowPrintCheckout(false);
    }
  };

  // Check the delivery address first (the same rules the server applies),
  // then take payment, then place the order.
  const handlePrintClick = () => {
    const checked = validateAddress(address);
    if ('errors' in checked) {
      setAddressErrors(checked.errors);
      return;
    }
    setAddressErrors([]);
    setShowPrintCheckout(true);
  };

  const handlePrintSuccess = () => {
    setShowPrintCheckout(false);
    createPrintOrder();
  };

  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement('a');
    // Stored PDFs come back as signed storage links: ask the server for an
    // attachment so the browser downloads instead of leaving the app.
    link.href = withDownloadName(url, filename);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const storyTitle = config.children.length > 0
    ? `${config.children.join(' and ')}'s ${config.storyType} Story`
    : `A ${config.storyType} Story`;

  const handleCreateAnother = () => {
    onReset();
    toast.success('Start a fresh story whenever you are ready!');
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="flex flex-col gap-4 text-center sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-display font-bold text-gradient">
            Export Your Story
          </h1>
          <p className="text-lg text-muted-foreground">
            Download your storybook or order professional prints
          </p>
        </div>
        <Button variant="ghost" onClick={handleCreateAnother} className="self-center sm:self-auto">
          <Package className="w-4 h-4 mr-2" />
          Create Another Story
        </Button>
      </div>

      {/* Story Summary */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle>Story Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Title</div>
              <div className="text-sm text-muted-foreground">{storyTitle}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Pages</div>
              <div className="text-sm text-muted-foreground">{config.lengthPages} pages</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Page Size</div>
              <div className="text-sm text-muted-foreground">{config.pageSize}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Reading Level</div>
              <div className="text-sm text-muted-foreground">{config.readingLevel}</div>
            </div>
          </div>
          {config.personal.dedication && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="text-sm font-medium mb-1">Dedication</div>
              <div className="text-sm text-muted-foreground italic">
                {config.personal.dedication}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PDF Export */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Export PDFs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Includes print-ready & web PDF</Badge>
              <Badge variant="outline" className="text-story-nature border-story-nature">
                First export is free
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Generate professionally typeset PDFs of your book: one for reading on screen, and a print-ready one with 3 mm bleed.
            </p>
          </div>

          {imageCheckMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{imageCheckMessage}</AlertDescription>
            </Alert>
          )}

          {config.exports?.webPdfUrl && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                PDFs generated. Download them or head to print.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={onBack}>
              Back to Editor
            </Button>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  if (config.exports?.webPdfUrl) {
                    downloadFile(config.exports.webPdfUrl, `${storyTitle}-web.pdf`);
                  }
                }}
                disabled={!config.exports?.webPdfUrl}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Web PDF
              </Button>
              <Button
                onClick={handleExportClick}
                disabled={isExporting || isCheckingImages}
              >
                {isCheckingImages ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking illustrations...
                  </>
                ) : isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing PDFs...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate PDFs
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Print Order - hidden until Phase 5 */}
      {PRINT_ENABLED && (
      <Card className="story-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" />
            Order Printed Books
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            We print and post a paperback of your book. Generate your PDFs first, then tell us where to send it.
          </p>

          {config.pageSize !== 'A5 portrait' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Printed books currently look best at A5. At {config.pageSize} the pictures print less sharply.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['name', 'Full name', 'Sam Smith'],
              ['email', 'Email for delivery updates', 'you@example.com'],
              ['line1', 'Address line 1', '1 High Street'],
              ['line2', 'Address line 2 (optional)', ''],
              ['city', 'Town or city', 'Leeds'],
              ['postcode', 'Postcode', 'LS1 1AA'],
            ] as const).map(([field, label, placeholder]) => (
              <div key={field} className="space-y-1">
                <Label htmlFor={`ship-${field}`}>{label}</Label>
                <Input
                  id={`ship-${field}`}
                  value={address[field] || ''}
                  placeholder={placeholder}
                  autoComplete={field === 'name' ? 'name' : field === 'email' ? 'email' : field === 'postcode' ? 'postal-code' : field === 'city' ? 'address-level2' : field === 'line1' ? 'address-line1' : 'address-line2'}
                  onChange={(e) => setAddress({ ...address, [field]: e.target.value })}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="ship-country">Country</Label>
              <Select value={address.country} onValueChange={(country) => setAddress({ ...address, country })}>
                <SelectTrigger id="ship-country"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                  <SelectItem value="IE">Ireland</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {addressErrors.length > 0 && (
            <p className="text-sm text-destructive">Please check: {addressErrors.join(', ')}.</p>
          )}

          <div className="flex justify-end">
            <Button onClick={handlePrintClick} disabled={!config.exports?.printPdfUrl || isPrinting}>
              {isPrinting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Placing your order...
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4 mr-2" />
                  Order printed book
                </>
              )}
            </Button>
          </div>

          {printResult && (
            <Alert variant={printResult.ok ? 'default' : 'destructive'}>
              {printResult.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <AlertDescription>
                {printResult.ok ? (
                  <div className="space-y-2">
                    <p>
                      Your book is ordered and on its way to the printer.
                      {printResult.orderId && ` Order reference: ${printResult.orderId}.`}
                    </p>
                    {printResult.checkoutUrl && (
                      <Button variant="link" asChild className="px-0">
                        <a href={printResult.checkoutUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1">
                          <ExternalLink className="w-4 h-4" /> Complete checkout
                        </a>
                      </Button>
                    )}
                  </div>
                ) : (
                  <p>{printResult.error || 'We couldn’t place the order. Please try again - your payment is kept for this book.'}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      )}

      <Dialog open={showExportCheckout} onOpenChange={setShowExportCheckout}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Download this book PDF
            </DialogTitle>
          </DialogHeader>
          <CheckoutSheet
            item="export"
            storyId={config.storyId}
            onSuccess={handleExportSuccess}
            onCancel={() => setShowExportCheckout(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showPrintCheckout} onOpenChange={setShowPrintCheckout}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              Printed book checkout
            </DialogTitle>
          </DialogHeader>
          <CheckoutSheet
            item="print"
            storyId={config.storyId}
            onSuccess={handlePrintSuccess}
            onCancel={() => setShowPrintCheckout(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};
