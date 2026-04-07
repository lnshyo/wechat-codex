import { describe, expect, test } from "bun:test";
import path from "node:path";

import { parseCliArgs } from "../../src/companion/local-companion.ts";

describe("local-companion cli helpers", () => {
  test("parseCliArgs keeps headless disabled by default", () => {
    const options = parseCliArgs(["--adapter", "codex"]);

    expect(options.adapter).toBe("codex");
    expect(options.cwd).toBe(process.cwd());
    expect(options.headless).toBe(false);
  });

  test("parseCliArgs accepts --headless and normalizes cwd", () => {
    const options = parseCliArgs([
      "--adapter",
      "codex",
      "--cwd",
      "./tmp/project",
      "--headless",
    ]);

    expect(options.cwd).toBe(path.resolve("./tmp/project"));
    expect(options.headless).toBe(true);
  });
});
