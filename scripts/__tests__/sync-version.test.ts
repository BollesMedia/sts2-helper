import { describe, it, expect } from "vitest";
import { applyVersion, stripVersionPrefix } from "../sync-version";

describe("sync-version", () => {
  describe("tauri.conf.json", () => {
    const updater = (content: string, version: string) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    };

    it("updates version field", () => {
      const input = JSON.stringify({ version: "0.9.0", productName: "STS2" }, null, 2);
      const result = applyVersion(input, "0.11.0", updater);
      expect(JSON.parse(result).version).toBe("0.11.0");
    });

    it("preserves other fields", () => {
      const input = JSON.stringify({ version: "0.9.0", productName: "STS2", identifier: "com.test" }, null, 2);
      const result = applyVersion(input, "1.0.0", updater);
      const parsed = JSON.parse(result);
      expect(parsed.productName).toBe("STS2");
      expect(parsed.identifier).toBe("com.test");
    });
  });

  describe("main.tsx Sentry release", () => {
    const updater = (content: string, version: string) =>
      content.replace(/sts2-replay@[\d.]+/, `sts2-replay@${version}`);

    it("updates Sentry release tag", () => {
      const input = '  release: `sts2-replay@0.9.0`,';
      const result = applyVersion(input, "0.11.0", updater);
      expect(result).toBe('  release: `sts2-replay@0.11.0`,');
    });

    it("does not affect other content", () => {
      const input = 'const x = 1;\n  release: `sts2-replay@0.9.0`,\nconst y = 2;';
      const result = applyVersion(input, "2.0.0", updater);
      expect(result).toContain("const x = 1;");
      expect(result).toContain("const y = 2;");
      expect(result).toContain("sts2-replay@2.0.0");
    });
  });

  describe("error-reporter.ts APP_VERSION", () => {
    const updater = (content: string, version: string) =>
      content.replace(
        /const APP_VERSION = "[\d.]+"/,
        `const APP_VERSION = "${version}"`
      );

    it("updates APP_VERSION constant", () => {
      const input = 'const APP_VERSION = "0.9.0";';
      const result = applyVersion(input, "0.11.0", updater);
      expect(result).toBe('const APP_VERSION = "0.11.0";');
    });
  });

  describe("package.json", () => {
    const updater = (content: string, version: string) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    };

    it("updates version field", () => {
      const input = JSON.stringify({ name: "@sts2/desktop", version: "0.3.0" }, null, 2);
      const result = applyVersion(input, "0.11.0", updater);
      expect(JSON.parse(result).version).toBe("0.11.0");
    });
  });

  describe("stripVersionPrefix", () => {
    it("strips v prefix from tag", () => {
      expect(stripVersionPrefix("v0.11.0")).toBe("0.11.0");
    });

    it("leaves bare version unchanged", () => {
      expect(stripVersionPrefix("0.11.0")).toBe("0.11.0");
    });

    it("handles v1.0.0", () => {
      expect(stripVersionPrefix("v1.0.0")).toBe("1.0.0");
    });
  });
});
