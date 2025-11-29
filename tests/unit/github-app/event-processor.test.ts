import { describe, expect, test } from "bun:test";

import { matchesBranchFilter } from "../../../src/github-app/event-processor";

describe("matchesBranchFilter", () => {
  const defaultBranch = "main";

  describe("null filter (default branch only)", () => {
    test("matches the default branch", () => {
      expect(matchesBranchFilter("main", null, defaultBranch)).toBe(true);
    });

    test("does not match other branches", () => {
      expect(matchesBranchFilter("develop", null, defaultBranch)).toBe(false);
      expect(matchesBranchFilter("feature/foo", null, defaultBranch)).toBe(
        false
      );
    });
  });

  describe("'all' filter", () => {
    test("matches any branch", () => {
      expect(matchesBranchFilter("main", "all", defaultBranch)).toBe(true);
      expect(matchesBranchFilter("develop", "all", defaultBranch)).toBe(true);
      expect(matchesBranchFilter("feature/foo", "all", defaultBranch)).toBe(
        true
      );
      expect(matchesBranchFilter("release/v1.0", "all", defaultBranch)).toBe(
        true
      );
    });
  });

  describe("exact pattern", () => {
    test("matches exact branch name", () => {
      expect(matchesBranchFilter("main", "main", defaultBranch)).toBe(true);
    });

    test("does not match different branch", () => {
      expect(matchesBranchFilter("develop", "main", defaultBranch)).toBe(false);
    });

    test("does not match partial name", () => {
      expect(matchesBranchFilter("main2", "main", defaultBranch)).toBe(false);
      expect(matchesBranchFilter("mains", "main", defaultBranch)).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    test("matches any of the patterns", () => {
      expect(matchesBranchFilter("main", "main,develop", defaultBranch)).toBe(
        true
      );
      expect(
        matchesBranchFilter("develop", "main,develop", defaultBranch)
      ).toBe(true);
    });

    test("does not match if none match", () => {
      expect(
        matchesBranchFilter("feature/foo", "main,develop", defaultBranch)
      ).toBe(false);
    });

    test("handles whitespace in patterns", () => {
      expect(
        matchesBranchFilter("develop", "main, develop", defaultBranch)
      ).toBe(true);
      expect(
        matchesBranchFilter("develop", "main , develop", defaultBranch)
      ).toBe(true);
    });
  });

  describe("glob patterns", () => {
    test("matches release/* pattern", () => {
      expect(
        matchesBranchFilter("release/v1.0", "release/*", defaultBranch)
      ).toBe(true);
      expect(
        matchesBranchFilter("release/v2.0.0", "release/*", defaultBranch)
      ).toBe(true);
    });

    test("does not match non-matching branches", () => {
      expect(matchesBranchFilter("main", "release/*", defaultBranch)).toBe(
        false
      );
      expect(
        matchesBranchFilter("releases/v1.0", "release/*", defaultBranch)
      ).toBe(false);
    });

    test("matches feature-* pattern", () => {
      expect(
        matchesBranchFilter("feature-foo", "feature-*", defaultBranch)
      ).toBe(true);
      expect(
        matchesBranchFilter("feature-bar-baz", "feature-*", defaultBranch)
      ).toBe(true);
    });

    test("matches hotfix/* pattern", () => {
      expect(
        matchesBranchFilter("hotfix/urgent-fix", "hotfix/*", defaultBranch)
      ).toBe(true);
    });
  });

  describe("mixed exact and glob patterns", () => {
    test("matches exact or glob pattern", () => {
      const filter = "main,release/*";
      expect(matchesBranchFilter("main", filter, defaultBranch)).toBe(true);
      expect(matchesBranchFilter("release/v1.0", filter, defaultBranch)).toBe(
        true
      );
      expect(matchesBranchFilter("develop", filter, defaultBranch)).toBe(false);
    });

    test("matches complex mixed pattern", () => {
      const filter = "main,develop,release/*,hotfix/*";
      expect(matchesBranchFilter("main", filter, defaultBranch)).toBe(true);
      expect(matchesBranchFilter("develop", filter, defaultBranch)).toBe(true);
      expect(matchesBranchFilter("release/v1.0", filter, defaultBranch)).toBe(
        true
      );
      expect(matchesBranchFilter("hotfix/fix", filter, defaultBranch)).toBe(
        true
      );
      expect(matchesBranchFilter("feature/foo", filter, defaultBranch)).toBe(
        false
      );
    });
  });
});
