import { describe, expect, it } from "vitest";
import { isTesterName, testerName, trustKeys } from "./graft-tester-lib.ts";

describe("trustKeys", () => {
  it("turns drive paths to forward slashes and keeps their case", () => {
    expect(trustKeys("C:/Users/Me/Tests/a", "C:\\Users\\Me\\Tests\\a", "C:\\Users\\Me")).toEqual({
      keys: ["C:/Users/Me/Tests/a"],
    });
  });

  it("keeps both forms when the real path differs", () => {
    expect(trustKeys("c:/link/a", "D:\\Real\\a\\", "C:\\Users\\Me")).toEqual({
      keys: ["c:/link/a", "D:/Real/a"],
    });
  });

  it("turns UNC paths to forward slashes", () => {
    expect(
      trustKeys("\\\\server\\share\\repo", "\\\\server\\share\\repo", "C:\\Users\\Me"),
    ).toEqual({ keys: ["//server/share/repo"] });
  });

  it("leaves POSIX paths unchanged", () => {
    expect(trustKeys("/Users/me/tests/a", "/private/tests/a", "/Users/me")).toEqual({
      keys: ["/Users/me/tests/a", "/private/tests/a"],
    });
  });

  it.each([
    ["the home directory", "C:/Users/Me", "C:\\Users\\Me"],
    ["the home directory in another case and form", "c:\\users\\me\\", "c:\\users\\me"],
    ["a POSIX home directory", "/Users/me", "/Users/me"],
    ["a drive root", "C:/", "C:\\"],
    ["a bare drive", "D:", "D:\\"],
    ["a share root", "//server/share", "\\\\server\\share"],
    ["a server root", "\\\\server", "\\\\server"],
    ["the POSIX root", "/", "/"],
    ["an ancestor of home", "C:/Users", "C:\\Users"],
    ["a POSIX ancestor of home", "/Users", "/Users"],
  ])("refuses %s", (_, root, realRoot) => {
    const home = root.startsWith("/") && !root.startsWith("//") ? "/Users/me" : "C:\\Users\\Me";
    expect(trustKeys(root, realRoot, home)).toHaveProperty("refusal");
  });

  it("refuses when only the real path is home", () => {
    expect(trustKeys("C:/link", "C:\\Users\\Me", "C:\\Users\\Me")).toHaveProperty("refusal");
  });

  it("does not refuse a sibling whose name starts with home's name", () => {
    expect(trustKeys("C:/Users/Me2", "C:\\Users\\Me2", "C:\\Users\\Me")).toEqual({
      keys: ["C:/Users/Me2"],
    });
  });
});

describe("testerName", () => {
  it("makes a different name that isTesterName matches each time", () => {
    const [a, b] = [testerName(), testerName()];
    expect(a).not.toBe(b);
    expect(isTesterName(a)).toBe(true);
  });
});

describe("isTesterName", () => {
  it.each(["graft-tester", "graft-tester (2)", "graft-tester-0a1b2c", "graft-tester-0a1b2c (2)"])(
    "matches %s",
    (name) => expect(isTesterName(name)).toBe(true),
  );

  it.each(["graft-30", "graft-tester-x", "my-graft-tester", "graft-tester-0a1b2c-old"])(
    "does not match %s",
    (name) => expect(isTesterName(name)).toBe(false),
  );
});
