import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { chatOutputsSignature, mergeChatOutputs, type ChatOutput } from "./chatAgents";

/** Chats with kept outputs; the least recently touched chat's list goes first. */
const KEPT_THREAD_LIMIT = 200;

interface KeptThreadOutputs {
  readonly outputs: ReadonlyArray<ChatOutput>;
  readonly touchedAt: number;
}

interface ChatOutputsState {
  readonly byThread: Readonly<Record<string, KeptThreadOutputs>>;
  /** Folds a chat's derived outputs into its kept list. */
  readonly record: (threadKey: string, outputs: ReadonlyArray<ChatOutput>) => void;
}

export const useChatOutputsStore = create<ChatOutputsState>()(
  persist(
    (set) => ({
      byThread: {},
      record: (threadKey, outputs) =>
        set((state) => {
          const kept = state.byThread[threadKey]?.outputs ?? [];
          const merged = mergeChatOutputs(kept, outputs);
          if (chatOutputsSignature(merged) === chatOutputsSignature(kept)) return state;
          const byThread: Record<string, KeptThreadOutputs> = {
            ...state.byThread,
            [threadKey]: { outputs: merged, touchedAt: Date.now() },
          };
          const keys = Object.keys(byThread);
          if (keys.length > KEPT_THREAD_LIMIT) {
            keys
              .toSorted((left, right) => byThread[left]!.touchedAt - byThread[right]!.touchedAt)
              .slice(0, keys.length - KEPT_THREAD_LIMIT)
              .forEach((key) => delete byThread[key]);
          }
          return { byThread };
        }),
    }),
    {
      name: "t3code:argus-chat-outputs:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byThread: state.byThread }),
    },
  ),
);
