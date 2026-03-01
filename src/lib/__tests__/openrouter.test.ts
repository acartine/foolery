import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatPricing,
  fetchOpenRouterModels,
  validateOpenRouterApiKey,
} from "../openrouter";

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

  describe("fetchOpenRouterModels", () => {
    beforeEach(() => {
      vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns model list on success", async () => {
      const mockModels = [
        {
          id: "openai/gpt-4",
          name: "GPT-4",
          context_length: 8192,
          pricing: { prompt: "0.00003", completion: "0.00006", image: "0", request: "0" },
        },
      ];
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockModels }), { status: 200 }),
      );

      const result = await fetchOpenRouterModels();
      expect(result).toEqual(mockModels);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({ "X-Title": "Foolery" }),
        }),
      );
    });

    it("throws on non-ok response", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
      );

      await expect(fetchOpenRouterModels()).rejects.toThrow(
        "OpenRouter API error: 429 Too Many Requests",
      );
    });
  });

  describe("validateOpenRouterApiKey", () => {
    beforeEach(() => {
      vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns true for valid key", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: {} }), { status: 200 }),
      );

      const result = await validateOpenRouterApiKey("sk-or-v1-valid");
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/auth/key",
        expect.objectContaining({
          headers: { Authorization: "Bearer sk-or-v1-valid" },
        }),
      );
    });

    it("returns false for invalid key", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 }),
      );

      const result = await validateOpenRouterApiKey("bad-key");
      expect(result).toBe(false);
    });

    it("returns false on network error", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));

      const result = await validateOpenRouterApiKey("sk-or-v1-valid");
      expect(result).toBe(false);
    });
  });
});
