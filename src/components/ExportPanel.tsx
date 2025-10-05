import React, { useEffect, useMemo, useState } from 'react';
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
import { getSession, markFirstExportUsed } from '@/lib/session';
import { useAuth } from '@/context/AuthContext';

interface ExportPanelProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onBack: () => void;
  onReset: () => void;
}

type PrintProvider = 'PEECHO' | 'BOOKVAULT' | 'LULU' | 'GELATO';

export const ExportPanel: React.FC<ExportPanelProps> = ({
  config,
  onConfigChange,
  onBack,
  onReset,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<PrintProvider>('PEECHO');
  const [printResult, setPrintResult] = useState<{
    ok: boolean;
    provider: string;
    orderId?: string;
    checkoutUrl?: string;
    error?: string;
  } | null>(null);
  const [showExportCheckout, setShowExportCheckout] = useState(false);
  const [showPrintCheckout, setShowPrintCheckout] = useState(false);

  const { user } = useAuth();
  const session = useMemo(() => getSession(user?.id), [user?.id]);
  const [firstExportUsed, setFirstExportUsed] = useState(session.firstExportUsed);

  useEffect(() => {
    setFirstExportUsed(session.firstExportUsed);
  }, [session.sessionId]);

  const exportPDF = async (billingToken?: string) => {
    if (!config.pages || config.pages.length === 0) {
      toast.error('No pages to export');
      return;
    }

    setIsExporting(true);
    try {
      const response = await api.exportPDF(config, config.pages, true, billingToken);

      onConfigChange({
        exports: {
          webPdfUrl: response.webPdfUrl,
          printPdfUrl: response.printPdfUrl,
        },
      });

      if (!firstExportUsed) {
        markFirstExportUsed(user?.id);
        setFirstExportUsed(true);
      }

      toast.success('PDFs generated successfully!');
    } catch (error) {
      toast.error('Failed to generate PDFs');
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
      setShowExportCheckout(false);
    }
  };

  const handleExportClick = () => {
    if (isFirstExport) {
      exportPDF();
    } else {
      setShowExportCheckout(true);
    }
  };

  const handleExportSuccess = (billingToken: string) => {
    setShowExportCheckout(false);
    exportPDF(billingToken);
  };

  const createPrintOrder = async (billingToken?: string) => {
    if (!config.exports?.printPdfUrl) {
      toast.error('Please export PDFs first');
      return;
    }

    setIsPrinting(true);
    try {
      const response = await api.createPrintOrder(
        selectedProvider,
        config.exports.printPdfUrl,
        config.pageSize,
        billingToken
      );

      setPrintResult(response);

      if (response.ok) {
        toast.success(`Print order created with ${response.provider}`);
      } else {
        toast.error(response.error ?? 'Failed to create print order');
      }
    } catch (error) {
      toast.error('Failed to create print order');
      console.error('Print error:', error);
    } finally {
      setIsPrinting(false);
      setShowPrintCheckout(false);
    }
  };

  const handlePrintClick = () => {
    setShowPrintCheckout(true);
  };

  const handlePrintSuccess = (billingToken: string) => {
    setShowPrintCheckout(false);
    createPrintOrder(billingToken);
  };

  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const storyTitle = config.children.length > 0
    ? `${config.children.join(' and ')}'s ${config.storyType} Story`
    : `A ${config.storyType} Story`;

  const isFirstExport = !firstExportUsed;

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
              {isFirstExport && (
                <Badge variant="outline" className="text-story-nature border-story-nature">
                  First export is free
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Generate professionally typeset PDFs that include all text, illustrations, bleed and trim marks.
            </p>
          </div>

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
                disabled={isExporting}
              >
                {isExporting ? (
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

      {/* Print Order */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" />
            Order Printed Books
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Choose a print partner and we'll pass your print-ready PDF straight to their ordering system.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-primary/70" />
              <span className="font-semibold">Professional Print Order</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <Select value={selectedProvider} onValueChange={(value: PrintProvider) => setSelectedProvider(value)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Choose provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEECHO">Peecho</SelectItem>
                  <SelectItem value="BOOKVAULT">BookVault</SelectItem>
                  <SelectItem value="LULU">Lulu</SelectItem>
                  <SelectItem value="GELATO">Gelato</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handlePrintClick}
                disabled={!config.exports?.printPdfUrl || isPrinting}
              >
                {isPrinting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating order...
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4 mr-2" />
                    Checkout
                  </>
                )}
              </Button>
            </div>
          </div>

          {printResult && (
            <Alert variant={printResult.ok ? 'default' : 'destructive'}>
              {printResult.ok ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <AlertDescription>
                {printResult.ok ? (
                  <div className="space-y-2">
                    <p>
                      Order created with <strong>{printResult.provider}</strong>.
                      {printResult.orderId && ` Reference: ${printResult.orderId}.`}
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
                  <p>{printResult.error || 'We couldn’t create the order. Please try again or choose a different provider.'}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Dialog open={showExportCheckout} onOpenChange={setShowExportCheckout}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Complete export purchase
            </DialogTitle>
          </DialogHeader>
          <CheckoutSheet
            item="export"
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
              Print handling checkout
            </DialogTitle>
          </DialogHeader>
          <CheckoutSheet
            item="print"
            onSuccess={handlePrintSuccess}
            onCancel={() => setShowPrintCheckout(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};
