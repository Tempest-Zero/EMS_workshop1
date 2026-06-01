import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Avatar from "@shared/ui/Avatar";

describe("<Avatar />", () => {
  it("renders the initials of the given name", () => {
    render(<Avatar name="Imran Ahmed" />);
    expect(screen.getByText("IA")).toBeInTheDocument();
  });

  it("takes at most the first two initials", () => {
    render(<Avatar name="Muhammad Asif Ali" />);
    expect(screen.getByText("MA")).toBeInTheDocument();
  });
});
