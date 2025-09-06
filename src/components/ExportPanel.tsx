import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

interface ExportPanelProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onBack: () => void;
}

type PrintProvider = 'PEECHO' | 'BOOKVAULT' | 'LULU' | 'GELATO';

export const ExportPanel: React.FC<ExportPanelProps> = ({
  config,
  onConfigChange,
  onBack,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<PrintProvider>('PEECHO');
  const [printResult, setPrintResult] = useState<{
    ok: boolean;
    provider: string;
    orderId?: string;
    checkoutUrl?: string;
  } | null>(null);

  const exportPDF = async () => {
    if (!config.pages || config.pages.length === 0) {
      toast.error('No pages to export');
      return;
    }

    setIsExporting(true);
    try {
      const response = await api.exportPDF(config, config.pages, true);
      
      onConfigChange({
        exports: {
          webPdfUrl: response.webPdfUrl,
          printPdfUrl: response.printPdfUrl,
        },
      });

      toast.success('PDFs generated successfully!');
    } catch (error) {
      toast.error('Failed to generate PDFs');
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const createPrintOrder = async () => {
    if (!config.exports?.printPdfUrl) {
      toast.error('Please export PDFs first');
      return;
    }

    setIsPrinting(true);
    try {
      const response = await api.createPrintOrder(
        selectedProvider,
        config.exports.printPdfUrl,
        config.pageSize
      );

      setPrintResult(response);
      
      if (response.ok) {
        toast.success(`Print order created with ${response.provider}`);
      } else {
        toast.error('Failed to create print order');
      }
    } catch (error) {
      toast.error('Failed to create print order');
      console.error('Print error:', error);
    } finally {
      setIsPrinting(false);
    }
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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-display font-bold text-gradient">
          Export Your Story
        </h1>
        <p className="text-lg text-muted-foreground">
          Download your storybook or order professional prints
        </p>
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
            PDF Export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-medium">Web PDF</h4>
              <p className="text-sm text-muted-foreground">
                Perfect for reading on screen and sharing digitally
              </p>
              {config.exports?.webPdfUrl ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-story-nature" />
                  <span className="text-sm">Ready for download</span>
                </div>
              ) : (
                <Badge variant="outline">Not generated</Badge>
              )}
            </div>
            
            <div className="space-y-3">
              <h4 className="font-medium">Print PDF</h4>
              <p className="text-sm text-muted-foreground">
                High-resolution with 3mm bleed for professional printing
              </p>
              {config.exports?.printPdfUrl ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-story-nature" />
                  <span className="text-sm">Ready for printing</span>
                </div>
              ) : (
                <Badge variant="outline">Not generated</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={exportPDF}
              disabled={isExporting}
              size="lg"
              className="flex-1 min-w-[200px]"
            >
              {isExporting ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Download className="w-5 h-5 mr-2" />
              )}
              {isExporting ? 'Generating...' : 'Generate PDFs'}
            </Button>

            {config.exports?.webPdfUrl && (
              <Button
                variant="outline"
                onClick={() => downloadFile(config.exports!.webPdfUrl!, `${storyTitle} - Web.pdf`)}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Web PDF
              </Button>
            )}

            {config.exports?.printPdfUrl && (
              <Button
                variant="outline"
                onClick={() => downloadFile(config.exports!.printPdfUrl!, `${storyTitle} - Print.pdf`)}
              >
                <Download className="w-4 h-4 mr-2" />
                Download Print PDF
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Print Services */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-primary" />
            Professional Printing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-medium">Print Provider</h4>
              <Select
                value={selectedProvider}
                onValueChange={(value: PrintProvider) => setSelectedProvider(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEECHO">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Peecho</div>
                        <div className="text-xs text-muted-foreground">UK & EU printing</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="BOOKVAULT">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      <div>
                        <div className="font-medium">BookVault</div>
                        <div className="text-xs text-muted-foreground">UK book printing</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="LULU">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Lulu</div>
                        <div className="text-xs text-muted-foreground">Global printing</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="GELATO">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Gelato</div>
                        <div className="text-xs text-muted-foreground">Global POD network</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <h4 className="font-medium">Book Details</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Format:</span>
                  <span>{config.pageSize}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pages:</span>
                  <span>{config.lengthPages} full-color pages</span>
                </div>
                <div className="flex justify-between">
                  <span>Binding:</span>
                  <span>Softcover</span>
                </div>
                <div className="flex justify-between">
                  <span>Paper:</span>
                  <span>Premium matte</span>
                </div>
              </div>
            </div>
          </div>

          {!config.exports?.printPdfUrl && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Please generate PDFs first before ordering prints.
              </AlertDescription>
            </Alert>
          )}

          {printResult && (
            <Alert className={printResult.ok ? "border-story-nature" : "border-destructive"}>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                {printResult.ok ? (
                  <div className="space-y-2">
                    <p>Print order created successfully with {printResult.provider}!</p>
                    {printResult.orderId && (
                      <p className="font-medium">Order ID: {printResult.orderId}</p>
                    )}
                    {printResult.checkoutUrl && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => window.open(printResult.checkoutUrl, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Complete Order
                      </Button>
                    )}
                  </div>
                ) : (
                  <p>Failed to create print order. Please try again.</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={createPrintOrder}
            disabled={!config.exports?.printPdfUrl || isPrinting}
            size="lg"
            variant="secondary"
            className="w-full"
          >
            {isPrinting ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <CreditCard className="w-5 h-5 mr-2" />
            )}
            {isPrinting ? 'Creating Order...' : `Order Print with ${selectedProvider}`}
          </Button>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back to Editor
        </Button>
        
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">
            Your magical storybook is ready!
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Create Another Story
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};