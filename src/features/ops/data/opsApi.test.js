import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getHealth,
  getMetrics,
  getRailwayServices,
  getRailwayDeployments,
  getRailwayLogs,
  getRailwayMetrics,
  getSentryIssues,
} from "./opsApi";

beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  );
});

const calledUrl = () => globalThis.fetch.mock.calls[0][0];

describe("opsApi", () => {
  it("health + metrics hit their bare endpoints", async () => {
    await getHealth();
    expect(calledUrl()).toContain("/api/ops/health");
    globalThis.fetch.mockClear();
    await getMetrics();
    expect(calledUrl()).toContain("/api/ops/metrics");
  });

  it("railway services is a bare GET", async () => {
    await getRailwayServices();
    expect(calledUrl()).toContain("/api/ops/railway/services");
  });

  it("deployments encodes the service name", async () => {
    await getRailwayDeployments("efficient tenderness");
    const url = calledUrl();
    expect(url).toContain("/api/ops/railway/deployments?name=efficient%20tenderness");
  });

  it("logs carries limit and an optional filter", async () => {
    await getRailwayLogs("web", { limit: 50, filter: "ERROR boom" });
    const url = calledUrl();
    expect(url).toContain("name=web");
    expect(url).toContain("limit=50");
    expect(url).toContain("filter=ERROR+boom");
  });

  it("logs omits filter when blank", async () => {
    await getRailwayLogs("web");
    const url = calledUrl();
    expect(url).toContain("name=web");
    expect(url).not.toContain("filter=");
  });

  it("metrics passes hours", async () => {
    await getRailwayMetrics("backend", 24);
    const url = calledUrl();
    expect(url).toContain("name=backend");
    expect(url).toContain("hours=24");
  });

  it("sentry issues is bare for 'all', scoped for a project", async () => {
    await getSentryIssues();
    expect(calledUrl()).toContain("/api/ops/sentry/issues");
    expect(calledUrl()).not.toContain("project=");
    globalThis.fetch.mockClear();
    await getSentryIssues("backend");
    expect(calledUrl()).toContain("project=backend");
  });
});
