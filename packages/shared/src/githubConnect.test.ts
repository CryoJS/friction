/**
 * GitHub's device flow, the pure half: what its answers mean, and which
 * repositories a token may be pointed at.
 */
import { describe, expect, it } from "vitest";
import { interpretDeviceToken, keepWritable, mayManageConnection, parseDeviceCode, writableRepos } from "./index";

describe("parseDeviceCode", () => {
  const answer = { device_code: "3584d83530557fdd1f46af8289938c8ef79f9dc5", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 };

  it("reads GitHub's answer", () => {
    expect(parseDeviceCode(answer)).toEqual({ deviceCode: answer.device_code, userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 });
  });

  it("falls back to GitHub's documented defaults when the timings are missing", () => {
    expect(parseDeviceCode({ ...answer, expires_in: undefined, interval: "soon" })).toMatchObject({ expiresIn: 900, interval: 5 });
  });

  it("is null for an error answer, and for a page that is not github.com: a person is sent there to type a code", () => {
    expect(parseDeviceCode({ error: "incorrect_client_credentials" })).toBeNull();
    expect(parseDeviceCode({ ...answer, verification_uri: "https://github.com.evil.example/login/device" })).toBeNull();
    expect(parseDeviceCode({ ...answer, verification_uri: "http://github.com/login/device" })).toBeNull();
    expect(parseDeviceCode(null)).toBeNull();
    expect(parseDeviceCode("device_code=x")).toBeNull();
  });
});

describe("interpretDeviceToken", () => {
  it("knows each of GitHub's answers", () => {
    expect(interpretDeviceToken({ access_token: "gho_abc", token_type: "bearer", scope: "repo" }, 5)).toEqual({ kind: "granted", token: "gho_abc" });
    expect(interpretDeviceToken({ error: "authorization_pending" }, 5)).toEqual({ kind: "pending" });
    expect(interpretDeviceToken({ error: "access_denied" }, 5)).toEqual({ kind: "denied" });
    expect(interpretDeviceToken({ error: "expired_token" }, 5)).toEqual({ kind: "expired" });
  });

  it("slows down to GitHub's new interval, or by five seconds when it names none", () => {
    expect(interpretDeviceToken({ error: "slow_down", interval: 12 }, 5)).toEqual({ kind: "slow_down", interval: 12 });
    expect(interpretDeviceToken({ error: "slow_down" }, 5)).toEqual({ kind: "slow_down", interval: 10 });
  });

  it("anything else is an error with GitHub's own words, never a grant", () => {
    expect(interpretDeviceToken({ error: "device_flow_disabled", error_description: "Device Flow must be explicitly enabled for this App" }, 5)).toEqual({
      kind: "error",
      message: "Device Flow must be explicitly enabled for this App",
    });
    expect(interpretDeviceToken({ error: "incorrect_client_credentials" }, 5)).toEqual({ kind: "error", message: "incorrect_client_credentials" });
    for (const junk of [null, undefined, {}, [], "access_token=gho_abc", { access_token: 42 }, { access_token: "" }]) expect(interpretDeviceToken(junk, 5).kind).toBe("error");
  });
});

describe("writableRepos", () => {
  const repo = (full_name: string, push: boolean, extra: Record<string, unknown> = {}) => ({ full_name, permissions: { pull: true, push, admin: false }, ...extra });

  it("keeps what the token can push to, sorted, once", () => {
    expect(writableRepos([repo("Kevin-Kolyakov/northpeak-store-test", true), repo("CryoJS/friction", true), repo("kevin-kolyakov/NORTHPEAK-store-test", true)])).toEqual([
      "CryoJS/friction",
      "kevin-kolyakov/NORTHPEAK-store-test",
    ]);
  });

  it("drops read-only, archived, disabled and malformed entries", () => {
    const listed = [repo("a/read-only", false), repo("a/archived", true, { archived: true }), repo("a/disabled", true, { disabled: true }), { full_name: "a/no-permissions" }, repo("not a slug", true), repo("../..", true), null, "a/b", repo("a/ok", true)];
    expect(writableRepos(listed)).toEqual(["a/ok"]);
    expect(writableRepos({ message: "Bad credentials" })).toEqual([]);
  });
});

describe("keepWritable", () => {
  const writable = ["CryoJS/friction", "Kevin-Kolyakov/northpeak-store-test"];

  it("keeps only ticked repositories the token can write to, in the token's spelling", () => {
    expect(keepWritable(["kevin-kolyakov/NORTHPEAK-STORE-TEST", " CryoJS/friction ", "CryoJS/friction"], writable)).toEqual(writable);
  });

  it("a repository that was never offered cannot be ticked", () => {
    expect(keepWritable(["torvalds/linux", "Kevin-Kolyakov/other", ""], writable)).toEqual([]);
  });
});

describe("mayManageConnection", () => {
  it("allows the control room on this machine, and a script on this machine", () => {
    for (const remoteAddress of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(mayManageConnection({ remoteAddress, origin: "http://localhost:5173" })).toBe(true);
      expect(mayManageConnection({ remoteAddress, origin: "http://127.0.0.1:5173" })).toBe(true);
      expect(mayManageConnection({ remoteAddress, origin: undefined })).toBe(true);
    }
  });

  it("refuses another machine, whatever Origin it claims", () => {
    for (const remoteAddress of ["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "", null, undefined]) {
      expect(mayManageConnection({ remoteAddress, origin: "http://localhost:5173" })).toBe(false);
      expect(mayManageConnection({ remoteAddress, origin: undefined })).toBe(false);
    }
  });

  it("refuses a web page that is not local, even in a browser on this machine: CORS admits *.pages.dev, this does not", () => {
    for (const origin of ["https://evil.pages.dev", "https://friction.pages.dev", "https://localhost.evil.example", "http://127.0.0.1.evil.example", "null", "file://", "not a url"]) {
      expect(mayManageConnection({ remoteAddress: "127.0.0.1", origin }), origin).toBe(false);
    }
  });
});
