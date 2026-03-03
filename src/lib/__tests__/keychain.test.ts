import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecAsync = vi.fn();
const mockPlatform = vi.fn();

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

vi.mock("node:os", () => ({
  platform: () => mockPlatform(),
  homedir: () => "/mock/home",
}));

// Must import AFTER mocking
const { keychainSet, keychainGet, keychainDelete } = await import(
  "@/lib/keychain"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("keychainGet", () => {
  it("reads from macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockResolvedValue({
      stdout: "sk-or-v1-secret\n",
      stderr: "",
    });

    const result = await keychainGet();
    expect(result).toBe("sk-or-v1-secret");
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("find-generic-password"),
    );
  });

  it("reads from Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockExecAsync.mockResolvedValue({
      stdout: "linux-secret\n",
      stderr: "",
    });

    const result = await keychainGet();
    expect(result).toBe("linux-secret");
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("secret-tool lookup"),
    );
  });

  it("returns null when keychain entry not found", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockRejectedValue(new Error("not found"));

    const result = await keychainGet();
    expect(result).toBeNull();
  });

  it("returns null on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainGet();
    expect(result).toBeNull();
  });
});

describe("keychainSet", () => {
  it("stores in macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await keychainSet("my-secret");
    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("add-generic-password"),
    );
  });

  it("stores in Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await keychainSet("my-secret");
    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("secret-tool store"),
    );
  });

  it("returns false on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainSet("my-secret");
    expect(result).toBe(false);
  });

  it("returns false on exec failure", async () => {
    mockPlatform.mockReturnValue("darwin");
    // First call (delete) succeeds, second call (add) fails
    mockExecAsync
      .mockResolvedValueOnce({ stdout: "", stderr: "" })
      .mockRejectedValueOnce(new Error("permission denied"));

    const result = await keychainSet("my-secret");
    expect(result).toBe(false);
  });

  it("delegates to keychainDelete when key is empty", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await keychainSet("");
    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("delete-generic-password"),
    );
  });
});

describe("keychainDelete", () => {
  it("deletes from macOS keychain", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await keychainDelete();
    expect(result).toBe(true);
  });

  it("deletes from Linux secret-tool", async () => {
    mockPlatform.mockReturnValue("linux");
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await keychainDelete();
    expect(result).toBe(true);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining("secret-tool clear"),
    );
  });

  it("returns true even if entry didn't exist", async () => {
    mockPlatform.mockReturnValue("darwin");
    mockExecAsync.mockRejectedValue(new Error("not found"));

    const result = await keychainDelete();
    expect(result).toBe(true);
  });

  it("returns false on unsupported OS", async () => {
    mockPlatform.mockReturnValue("win32");

    const result = await keychainDelete();
    expect(result).toBe(false);
  });
});
