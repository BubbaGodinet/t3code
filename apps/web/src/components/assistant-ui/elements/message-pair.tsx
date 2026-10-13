"use client";

import type { ComponentProps } from "react";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { ghostButton } from "./surfaces";
import { take } from "../utils/range";

export interface MessagePairProps extends Omit<ComponentProps<"div">, "children" | "onCopy"> {
  userMessage: string;
  words: readonly string[];
  visibleWords: number;
  streaming: boolean;
  variant?: "bubble" | "flat";
  onCopy?: () => void;
  onRegenerate?: () => void;
}

export function MessagePair({
  userMessage,
  words,
  visibleWords,
  streaming,
  variant = "bubble",
  onCopy,
  onRegenerate,
  className,
  ...props
}: MessagePairProps) {
  const shown = take(words, visibleWords);

  return (
    <div
      data-slot="message-pair"
      className={cn("flex w-full max-w-sm flex-col gap-5", className)}

      {...props}
    >
      {userMessage ? (
        <p
          className={cn(
            "max-w-[85%] self-end text-base text-foreground",
            variant === "bubble"
              ? "rounded-[18px] bg-[var(--surface-raised,var(--muted))] px-4 py-2.5"
              : "text-end",
          )}
        >
          {userMessage}
        </p>
      ) : null}
      <div className="group/message flex flex-col items-start gap-2">
        <p className="text-[17px] leading-[1.7] text-foreground">
          {shown.map((word, index) => {
            const fresh = streaming && shown.length - 1 - index < 2;

            return (
              <span
                key={`${word}-${index}`}
                className="fade-in animate-in fill-mode-both duration-500 motion-reduce:animate-none"
              >
                <span
                  className={cn(
                    "transition-colors duration-700 motion-reduce:transition-none",
                    fresh && "text-primary",
                  )}
                >
                  {word}
                </span>{" "}
              </span>
            );
          })}
          {streaming && shown.length > 0 && (
            <span
              aria-hidden
              className="-mb-0.5 ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-foreground motion-reduce:animate-none"
            />
          )}
        </p>
        {(onCopy || onRegenerate) && (
          <div className="flex items-center gap-1 pt-1 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none">
            {onCopy && (
              <button
                type="button"
                aria-label="Copy response"
                onClick={onCopy}
                className={cn(ghostButton, "size-8")}
              >
                <CopyIcon className="size-3.5" />
              </button>
            )}
            {onRegenerate && (
              <button
                type="button"
                aria-label="Regenerate response"
                onClick={onRegenerate}
                className={cn(ghostButton, "size-8")}
              >
                <RefreshCwIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
