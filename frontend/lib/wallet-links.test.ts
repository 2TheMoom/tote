import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMobileUserAgent, metamaskAppLink } from "./wallet-links.ts";

describe("isMobileUserAgent", () => {
  it("detects phones and tablets", () => {
    assert.equal(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
    assert.equal(isMobileUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), true);
    assert.equal(isMobileUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), true);
  });

  it("treats desktop browsers as desktop", () => {
    assert.equal(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0"), false);
    assert.equal(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15"), false);
    assert.equal(isMobileUserAgent(""), false);
  });
});

describe("metamaskAppLink", () => {
  it("uses MetaMask's dapp format with no protocol", () => {
    assert.equal(metamaskAppLink("tote-frontend.vercel.app", "/"), "https://metamask.app.link/dapp/tote-frontend.vercel.app");
  });

  it("keeps a non-root path", () => {
    assert.equal(metamaskAppLink("example.com", "/markets/1"), "https://metamask.app.link/dapp/example.com/markets/1");
  });

  it("treats an empty path as the root", () => {
    assert.equal(metamaskAppLink("example.com", ""), "https://metamask.app.link/dapp/example.com");
  });
});
