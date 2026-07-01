import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProxyGate from "./ProxyGate";

describe("ProxyGate", () => {
  it("renders nothing while status is loading (null)", () => {
    const { container } = render(<ProxyGate status={null}>data</ProxyGate>);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Not configured' when the integration is off", () => {
    render(
      <ProxyGate status={{ configured: false, available: false, detail: "set the token" }}>
        <div>secret data</div>
      </ProxyGate>
    );
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.queryByText("secret data")).not.toBeInTheDocument();
  });

  it("shows 'Upstream unavailable' when configured but the upstream failed", () => {
    render(
      <ProxyGate status={{ configured: true, available: false, detail: "HTTP 502" }}>
        <div>secret data</div>
      </ProxyGate>
    );
    expect(screen.getByText("Upstream unavailable")).toBeInTheDocument();
    expect(screen.queryByText("secret data")).not.toBeInTheDocument();
  });

  it("renders children when configured and available", () => {
    render(
      <ProxyGate status={{ configured: true, available: true }}>
        <div>secret data</div>
      </ProxyGate>
    );
    expect(screen.getByText("secret data")).toBeInTheDocument();
  });
});
