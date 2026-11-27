"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Eye } from "lucide-react";
import { DocPreview } from "@/components/document-preview";
import { PublicLink as Link } from "@/components/public-link";
import { buildPublicSampleDocuments } from "@/lib/sample-documents";
import { signUpFor } from "@/lib/start";
import { cn } from "@/lib/utils";

/**
 * Interactive public sample document viewer so visitors can inspect real finished output (rendered
 * with clearly badged synthetic details) before deciding to create an account.
 */
export function SampleDocumentPreview() {
  const samples = useMemo(() => buildPublicSampleDocuments(), []);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(samples[0]!.id);
  const current = samples.find((item) => item.id === activeId) ?? samples[0]!;

  return (
    <div className="mt-6" data-testid="panel-sample-preview">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        data-testid="button-toggle-sample-preview"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        {open ? "Hide sample documents" : "Preview sample finished documents"}
      </button>

      {open && (
        <div className="surface mt-4 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Sample output · Made-up details</p>
              <p className="mt-1 text-sm text-muted-foreground">{current.caption}</p>
            </div>
            <div
              className="inline-flex rounded-full border border-border bg-background p-1"
              role="group"
              aria-label="Sample document types"
            >
              {samples.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  aria-pressed={sample.id === current.id}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    sample.id === current.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveId(sample.id)}
                  data-testid={"tab-sample-" + sample.taskId}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 max-h-[30rem] overflow-y-auto rounded-2xl border border-border bg-sidebar/40 p-3 sm:p-5">
            <DocPreview title={current.title} content={current.content} revision={1} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Made-up sample for illustration only. Your own documents stay private in your workspace.
            </p>
            <Link
              href={signUpFor(current.taskId)}
              className="btn btn-primary btn-sm"
              data-testid="link-start-from-sample"
            >
              Make your own {current.label.toLowerCase()}{" "}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
