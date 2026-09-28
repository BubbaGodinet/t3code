import { createContext, use } from "react";

export interface ChatPaneContextValue {
  /** Only the active pane answers window-level shortcuts, paste-to-focus, and focus restores. */
  readonly active: boolean;
  readonly inMosaic: boolean;
}

export const ChatPaneContext = createContext<ChatPaneContextValue>({
  active: true,
  inMosaic: false,
});

export function useChatPane(): ChatPaneContextValue {
  return use(ChatPaneContext);
}
