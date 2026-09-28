"use client";

import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";

import type { ComposerImageAttachment } from "~/composerDraftStore";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";

import { PreviewPanelShell, type PreviewPanelMode } from "./PreviewPanelShell";
import { PreviewView } from "./PreviewView";

interface Props {
  mode: PreviewPanelMode;
  threadRef: ScopedThreadRef;
  tabId?: string | null;
  configuredUrls?: ReadonlyArray<string> | undefined;
  visible: boolean;
  onSendAnnotation?: (
    annotation: PreviewAnnotationPayload,
    image: ComposerImageAttachment | null,
  ) => void;
  /** Stacking of the hosted webview, for hosts that float the panel above other panes. */
  surfaceZIndex?: number;
  /** Changes whenever the host moves the panel without resizing it, so the webview follows. */
  surfaceLayoutVersion?: string;
}

export function PreviewPanel({
  mode,
  threadRef,
  tabId,
  configuredUrls,
  visible,
  onSendAnnotation,
  surfaceZIndex,
  surfaceLayoutVersion,
}: Props) {
  if (!isPreviewSupportedInRuntime()) {
    return (
      <PreviewPanelShell mode={mode}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            Preview is only available in the T3 Code desktop app.
          </p>
        </div>
      </PreviewPanelShell>
    );
  }

  return (
    <PreviewPanelShell mode={mode}>
      <PreviewView
        threadRef={threadRef}
        {...(tabId !== undefined ? { tabId } : {})}
        configuredUrls={configuredUrls}
        visible={visible}
        {...(onSendAnnotation ? { onSendAnnotation } : {})}
        {...(surfaceZIndex === undefined ? {} : { surfaceZIndex })}
        {...(surfaceLayoutVersion === undefined ? {} : { surfaceLayoutVersion })}
      />
    </PreviewPanelShell>
  );
}
