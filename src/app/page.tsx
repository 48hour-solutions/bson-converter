"use client";

import type React from 'react';
import { useState, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { UploadCloud, DownloadCloud, AlertCircle } from 'lucide-react';
import LoadingIndicator from '@/components/custom/loading-indicator';
import { useToast } from "@/hooks/use-toast";
import { BSON } from 'bson';
import { Buffer } from 'buffer'; // Import Buffer for client-side usage

interface ConvertedResult {
  originalName: string;
  jsonString?: string;
  downloadName?: string;
  error?: string;
}

// Function to recursively fix object keys
function fixObjectKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => fixObjectKeys(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    const newObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        let newKey = key;
        if (typeof key === 'string' && key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
          newKey = key.substring(1, key.length - 1);
        }
        newObj[newKey] = fixObjectKeys(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}

export default function BsonConverterPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [convertedResults, setConvertedResults] = useState<ConvertedResult[] | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [fileNamesDisplay, setFileNamesDisplay] = useState<string | null>(null);
  const { toast } = useToast();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) {
      const allValid = files.every(f => f.name.endsWith('.db') || f.name.endsWith('.bson'));
      if (!allValid) {
        toast({
          title: "Invalid File Type",
          description: "Please ensure all selected files are .db or .bson files.",
          variant: "destructive",
        });
        setSelectedFiles([]);
        setFileNamesDisplay(null);
        setConvertedResults(null);
        if (event.target) event.target.value = ''; // Reset file input
        return;
      }
      setSelectedFiles(files);
      setFileNamesDisplay(files.map(f => f.name).join(', '));
      setConvertedResults(null);
    } else {
      setSelectedFiles([]);
      setFileNamesDisplay(null);
    }
  };

  const handleConvert = useCallback(async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select one or more .db or .bson files to convert.",
        variant: "destructive",
      });
      return;
    }

    setIsConverting(true);
    setConvertedResults(null);
    const resultsBatch: ConvertedResult[] = [];
    let anyErrors = false;

    for (const file of selectedFiles) {
      try {
        const fileBuffer = await file.arrayBuffer();
        const nodeBuffer = Buffer.from(fileBuffer);
        let offset = 0;
        const documents: any[] = [];
        let fileSpecificErrorToastShown = false;

        if (nodeBuffer.length === 0) {
          resultsBatch.push({ originalName: file.name, error: "File is empty." });
          anyErrors = true;
          continue;
        }

        while (offset < nodeBuffer.length) {
          if (offset + 4 > nodeBuffer.length) {
            if (documents.length > 0 && nodeBuffer.length - offset > 0) {
               // This scenario implies trailing data, which might not be a critical error for already parsed docs.
            }
            break;
          }
          
          const size = nodeBuffer.readInt32LE(offset);

          if (size <= 0 || size > nodeBuffer.length - offset) {
            const errMsg = `Invalid BSON document size in ${file.name}. File may be corrupt.`;
            resultsBatch.push({ originalName: file.name, error: errMsg });
            if (selectedFiles.length === 1) { // Only toast immediately for single files
              toast({ title: "BSON Parsing Error", description: errMsg, variant: "destructive" });
            }
            fileSpecificErrorToastShown = true;
            anyErrors = true;
            break; 
          }

          const documentBuffer = nodeBuffer.subarray(offset, offset + size);
          const rawDoc = BSON.deserialize(documentBuffer, { useBigInt64: true, promoteValues: true });
          const fixedDoc = fixObjectKeys(rawDoc); // Apply key fixing
          documents.push(fixedDoc);
          offset += size;
        }

        if (fileSpecificErrorToastShown) continue; // Skip to next file if critical error occurred

        if (documents.length > 0) {
          const replacer = (key: string, value: any) => (typeof value === 'bigint' ? value.toString() : value);
          const outputData = documents.length === 1 ? documents[0] : documents;
          const jsonString = JSON.stringify(outputData, replacer, 2);
          resultsBatch.push({
            originalName: file.name,
            jsonString,
            downloadName: file.name.replace(/\.(db|bson)$/i, '.json'),
          });
        } else if (nodeBuffer.length > 0) {
           const errMsg = `Could not parse BSON documents from ${file.name}. It may be invalid.`;
           resultsBatch.push({ originalName: file.name, error: errMsg });
           if (selectedFiles.length === 1) {
             toast({ title: "BSON Conversion Failed", description: errMsg, variant: "destructive" });
           }
           anyErrors = true;
        }
      } catch (e: any) {
        console.error(`Conversion error for ${file.name}:`, e);
        const errMsg = e.message || `An unexpected error occurred during conversion of ${file.name}.`;
        resultsBatch.push({ originalName: file.name, error: errMsg });
        if (selectedFiles.length === 1) {
          toast({ title: "Conversion Error", description: errMsg, variant: "destructive" });
        }
        anyErrors = true;
      }
    }

    setConvertedResults(resultsBatch);
    setIsConverting(false);

    if (resultsBatch.length > 0) {
      if (selectedFiles.length === 1) {
        const result = resultsBatch[0];
        if (result.jsonString) {
          toast({
            title: "Conversion Complete",
            description: `Processed ${result.originalName}.`,
          });
        }
      } else {
        const successCount = resultsBatch.filter(r => r.jsonString).length;
        if (successCount > 0) { // Only show toast if at least one file was successful
           const fileWord = successCount === 1 ? 'file' : 'files';
           toast({
             title: "Conversion Complete",
             description: `Processed ${successCount} ${fileWord}.`,
             variant: anyErrors ? "warning" : "default",
           });
        }
      }
    }
  }, [selectedFiles, toast]);

  const handleDownloadIndividual = (result: ConvertedResult) => {
    if (!result.jsonString || !result.downloadName) return;

    const blob = new Blob([result.jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast({
      title: "Download Started",
      description: `${result.downloadName} is downloading.`,
    });
  };

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
      <Card className="w-full max-w-lg bg-card text-card-foreground shadow-2xl rounded-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-headline text-primary mb-2">
            BSONverter
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Upload .db or .bson file(s) and convert to JSON format seamlessly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="file-upload" className="sr-only">Choose file(s)</label>
            <Input 
              id="file-upload" 
              type="file" 
              accept=".db,.bson" 
              multiple
              onChange={handleFileChange}
              className="text-sm text-foreground file:mr-4 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
            {fileNamesDisplay && (
              <p className="text-sm text-muted-foreground text-center">Selected: {fileNamesDisplay}</p>
            )}
          </div>
          <Button 
            onClick={handleConvert} 
            disabled={selectedFiles.length === 0 || isConverting}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90 text-base py-3 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300"
            aria-label="Convert to JSON"
          >
            <UploadCloud className="mr-2 h-5 w-5" />
            {isConverting ? (selectedFiles.length > 1 ? 'Converting files...' : 'Converting...') : 'Convert to JSON'}
          </Button>
        </CardContent>
        <CardFooter className="flex flex-col items-stretch justify-center min-h-[80px] pt-6 space-y-3">
          {isConverting && <LoadingIndicator message={selectedFiles.length > 1 ? 'Converting files...' : 'Converting...'} />}
          {!isConverting && convertedResults && convertedResults.length > 0 && (
            <div className="w-full space-y-3 max-h-60 overflow-y-auto p-1">
              {convertedResults.map((result, index) => (
                <div key={index} className="p-3 border rounded-md bg-background/50">
                  <p className="text-sm font-medium text-foreground truncate mb-2" title={result.originalName}>{result.originalName}</p>
                  {result.jsonString && result.downloadName && (
                    <Button 
                      onClick={() => handleDownloadIndividual(result)}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm py-2 rounded-md shadow-sm hover:shadow-md transition-shadow duration-300"
                      aria-label={`Download JSON for ${result.originalName}`}
                      variant="secondary"
                      size="sm"
                    >
                      <DownloadCloud className="mr-2 h-4 w-4" />
                      Download JSON
                    </Button>
                  )}
                  {result.error && (
                    <div className="flex items-center text-destructive text-sm">
                      <AlertCircle className="mr-2 h-4 w-4 shrink-0" />
                      <p className="flex-1 break-words">Error: {result.error}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
