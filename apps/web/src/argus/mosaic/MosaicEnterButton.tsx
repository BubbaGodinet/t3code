import { LayoutGridIcon } from "lucide-react";

import { Toggle } from "../../components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { useChatPane } from "./chatPaneContext";
import { useMosaicStore } from "./mosaicStore";

/** Switches the chat surface into the pane mosaic. Hidden inside the mosaic itself. */
export function MosaicEnterButton() {
  const { inMosaic } = useChatPane();
  const setEnabled = useMosaicStore((state) => state.setEnabled);
  if (inMosaic) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Toggle
          className="shrink-0 [-webkit-app-region:no-drag]"
          pressed={false}
          onPressedChange={() => setEnabled(true)}
          aria-label="Open pane grid"
          variant="ghost"
          size="sm"
        >
          <LayoutGridIcon className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">Open pane grid</TooltipPopup>
    </Tooltip>
  );
}
