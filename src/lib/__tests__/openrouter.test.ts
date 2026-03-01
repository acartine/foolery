import { describe, it, expect } from "vitest";
import { formatPricing } from "../openrouter";

describe("openrouter", () => {
  describe("formatPricing", () => {
    it("returns Free for zero cost", () => {
      expect(formatPricing("0")).toBe("Free");
    });

    it("returns Free for empty string", () => {
      expect(formatPricing("")).toBe("Free");
    });

    it("formats per-million-token cost", () => {
      // $0.000003 per token = $3.00 per million
      expect(formatPricing("0.000003")).toBe("$3.00/M");
    });

    it("formats small costs", () => {
      // $0.0000001 per token = $0.10 per million
      expect(formatPricing("0.0000001")).toBe("$0.10/M");
    });

    it("formats very small costs", () => {
      // $0.00000000001 per token = essentially free
      expect(formatPricing("0.00000000001")).toBe("<$0.01/M");
    });

    it("formats larger costs", () => {
      // $0.00006 per token = $60.00 per million
      expect(formatPricing("0.00006")).toBe("$60.00/M");
    });
  });
});
