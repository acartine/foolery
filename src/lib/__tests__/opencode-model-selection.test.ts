import {
  describe,
  expect,
  it,
} from "vitest";
import {
  parseOpenCodeModelSelection,
} from "@/lib/opencode-model-selection";

describe("parseOpenCodeModelSelection", () => {
  it("splits provider from slash-bearing model ids", () => {
    expect(
      parseOpenCodeModelSelection(
        "openrouter/z-ai/glm-5.1",
      ),
    ).toEqual({
      providerID: "openrouter",
      modelID: "z-ai/glm-5.1",
    });
  });

  it("omits empty models", () => {
    expect(parseOpenCodeModelSelection(undefined))
      .toBeUndefined();
    expect(parseOpenCodeModelSelection(" "))
      .toBeUndefined();
  });

  it("rejects invalid model references", () => {
    expect(() => parseOpenCodeModelSelection("glm-5.1"))
      .toThrow('expected "<providerID>/<modelID>"');
  });
});
