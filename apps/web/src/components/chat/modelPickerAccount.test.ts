import { describe, expect, it } from "vite-plus/test";

import { modelPickerAccountLabel, modelPickerRowAccountLabel } from "./modelPickerAccount";

describe("modelPickerAccountLabel", () => {
  it("joins the instance label and the signed-in email", () => {
    expect(modelPickerAccountLabel({ displayName: "Motley Fool", email: "me@fool.com" })).toBe(
      "Motley Fool · me@fool.com",
    );
  });

  it("keeps a custom instance label when the probe has no email", () => {
    expect(modelPickerAccountLabel({ displayName: "DoorDash" })).toBe("DoorDash");
  });

  it("still names the only account, and adds its email when T3 has one", () => {
    expect(modelPickerAccountLabel({ displayName: "Claude" })).toBe("Claude");
    expect(modelPickerAccountLabel({ displayName: "Claude", email: "me@personal.test" })).toBe(
      "Claude · me@personal.test",
    );
  });

  it("does not repeat an email that is already the instance label", () => {
    expect(modelPickerAccountLabel({ displayName: "me@fool.com", email: " ME@fool.com " })).toBe(
      "me@fool.com",
    );
  });

  it("ignores a blank email", () => {
    expect(modelPickerAccountLabel({ displayName: "Claude", email: "   " })).toBe("Claude");
  });
});

describe("modelPickerRowAccountLabel", () => {
  it("keeps a catalog sub-provider after the account", () => {
    expect(
      modelPickerRowAccountLabel({
        displayName: "Motley Fool",
        email: "me@fool.com",
        subProvider: "GitHub Copilot",
      }),
    ).toBe("Motley Fool · me@fool.com · GitHub Copilot");
  });
});
