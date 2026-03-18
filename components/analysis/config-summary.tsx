"use client";

import { type AnalysisConfig } from "@/app/lib/api";
import { CheckCircle, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConfigSummaryProps {
  config: AnalysisConfig;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfigSummary({ config }: ConfigSummaryProps) {
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(config, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Success banner */}
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20 px-4 py-3 text-sm text-green-700 dark:text-green-400">
        <CheckCircle size={16} className="shrink-0" />
        <span>
          Configuration prête.{" "}
        </span>
      </div>

      {/* JSON block */}
      <div className="rounded-md border border-border overflow-hidden">
        <div className="flex items-center justify-between bg-muted/60 px-3 py-2 border-b border-border">
          <span className="text-xs font-medium font-mono text-muted-foreground">
            Payload ·
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <CheckCircle size={12} className="text-green-600" />
                Copié
              </>
            ) : (
              <>
                <Copy size={12} />
                Copier
              </>
            )}
          </Button>
        </div>
        <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed bg-background text-foreground max-h-[420px] overflow-y-auto">
          {json}
        </pre>
      </div>
    </div>
  );
}
