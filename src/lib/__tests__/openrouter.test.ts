import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OPENROUTER_SELECTED_AGENT_ID,
  formatPricing,
  formatOpenRouterSelectedAgentLabel,
  maskApiKey,
  fetchOpenRouterModels,
  validateOpenRouterApiKey,
  findOpenRouterModel,
  getSelectedOpenRouterModel,
  listUniqueOpenRouterAgentKeys,
  resolveOpenRouterPricing,
} from "../openrouter";

describe("openrouter", () => {
  describe("selected model helpers", () => {
    it("exposes a stable virtual agent id", () => {
      expect(OPENROUTER_SELECTED_AGENT_ID).toBe("openrouter:selected");
    });

    it("returns selected model when OpenRouter is enabled", () => {
      expect(
        getSelectedOpenRouterModel({
          enabled: true,
          model: "mistralai/devstral-small:free",
        }),
      ).toBe("mistralai/devstral-small:free");
    });

    it("returns null when OpenRouter is disabled or model is empty", () => {
      expect(
        getSelectedOpenRouterModel({
          enabled: false,
          model: "mistralai/devstral-small:free",
        }),
      ).toBeNull();
      expect(
        getSelectedOpenRouterModel({
          enabled: true,
          model: "   ",
        }),
      ).toBeNull();
    });

    it("formats the selected-model agent label", () => {
      expect(
        formatOpenRouterSelectedAgentLabel("mistralai/devstral-small:free"),
      ).toBe("OpenRouter (mistralai/devstral-small:free)");
    });
  });

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

  describe("maskApiKey", () => {
    it("returns empty string for empty key", () => {
      expect(maskApiKey("")).toBe("");
    });

    it("returns **** for short keys (8 chars or fewer)", () => {
      expect(maskApiKey("abc")).toBe("****");
      expect(maskApiKey("12345678")).toBe("****");
    });

    it("masks middle of longer keys", () => {
      expect(maskApiKey("sk-or-v1-abcdef123456")).toBe("sk-or-...3456");
    });

    it("preserves first 6 and last 4 chars", () => {
      const key = "abcdefghijklmnop";
      const masked = maskApiKey(key);
      expect(masked).toBe("abcdef...mnop");
    });
  });

  describe("findOpenRouterModel", () => {
    const models = [
      {
        id: "mistralai/devstral-small:free",
        name: "Devstral Small",
        context_length: 131072,
        pricing: { prompt: "0.0000002", completion: "0.0000003", image: "0", request: "0" },
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        context_length: 128000,
        pricing: { prompt: "0.000005", completion: "0.000015", image: "0", request: "0" },
      },
    ];

    it("matches exact model id", () => {
      const match = findOpenRouterModel(models, "openai/gpt-4o");
      expect(match?.id).toBe("openai/gpt-4o");
    });

    it("matches shorthand model references like devstral", () => {
      const match = findOpenRouterModel(models, "devstral");
      expect(match?.id).toBe("mistralai/devstral-small:free");
    });

    it("returns null when there is no match", () => {
      const match = findOpenRouterModel(models, "does-not-exist");
      expect(match).toBeNull();
    });
  });

  describe("resolveOpenRouterPricing", () => {
    const models = [
      {
        id: "mistralai/devstral-small:free",
        name: "Devstral Small",
        context_length: 131072,
        pricing: { prompt: "0.0000002", completion: "0.0000003", image: "0", request: "0" },
      },
    ];

    it("formats prompt and completion prices for matched models", () => {
      const pricing = resolveOpenRouterPricing(models, "devstral");
      expect(pricing).toEqual({
        modelId: "mistralai/devstral-small:free",
        prompt: "$0.20/M",
        completion: "$0.30/M",
      });
    });

    it("returns null when model reference is unknown", () => {
      const pricing = resolveOpenRouterPricing(models, "unknown");
      expect(pricing).toBeNull();
    });
  });

  describe("listUniqueOpenRouterAgentKeys", () => {
    it("deduplicates entries by normalized model id while keeping first key", () => {
      const keys = listUniqueOpenRouterAgentKeys({
        default: { model: "mistralai/devstral-small:free", label: "OpenRouter (devstral)" },
        devmistral: { model: " MISTRALAI/DEVSTRAL-SMALL:FREE ", label: "Devmistral" },
        gpt4o: { model: "openai/gpt-4o", label: "GPT-4o" },
      });
      expect(keys).toEqual(["default", "gpt4o"]);
    });

    it("skips blank model entries", () => {
      const keys = listUniqueOpenRouterAgentKeys({
        blank: { model: "   ", label: "Blank" },
        devstral: { model: "mistralai/devstral-small:free", label: "Devstral" },
      });
      expect(keys).toEqual(["devstral"]);
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
