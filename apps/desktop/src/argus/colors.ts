export const AGENT_HUES: Record<string, string> = {
  cursor: "#9b7dff",
  claude: "#d4a574",
  openai: "#5ecf8e",
  grok: "#a8adb8",
  opencode: "#4ecdc4",
  antigravity: "#7ec8e3",
};

export function agentHue(provider: string, status?: string): string {
  if (status === "error") return "#f07178";
  return AGENT_HUES[provider] ?? "#8b9cff";
}

export function chromeCss(provider: string, status = "idle"): string {
  const hue = agentHue(provider, status);
  const pulse =
    status === "working"
      ? "animation: argus-breath 9s ease-in-out 1;"
      : status === "needs_you"
        ? "animation: argus-flash 720ms ease-out 1;"
        : "";
  return `
    html { box-shadow: inset 0 0 0 2px ${hue}; }
    @keyframes argus-breath {
      0%, 100% { box-shadow: inset 0 0 0 2px ${hue}55; }
      50% { box-shadow: inset 0 0 0 2px ${hue}; }
    }
    @keyframes argus-flash {
      0% { box-shadow: inset 0 0 0 2px ${hue}00; }
      40% { box-shadow: inset 0 0 0 4px ${hue}; }
      100% { box-shadow: inset 0 0 0 2px ${hue}; }
    }
    ${pulse}
  `;
}
