import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../data/mediaApi", () => ({ fetchJobMedia: vi.fn() }));

import JobMediaGallery from "./JobMediaGallery";
import { fetchJobMedia } from "../data/mediaApi";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<JobMediaGallery />", () => {
  it("renders a before photo thumbnail from the API", async () => {
    fetchJobMedia.mockResolvedValue({
      before: [{ id: "1", phase: "before", type: "photo", playback_url: "https://x/p.jpg" }],
      after: [],
    });
    render(<JobMediaGallery jobKey="1051" />);
    const img = await screen.findByAltText("before photo");
    expect(img).toHaveAttribute("src", "https://x/p.jpg");
    // The job key is surfaced so the technician knows what to type on the phone.
    expect(screen.getByText("1051")).toBeInTheDocument();
  });

  it("shows a per-phase empty state when there is no media", async () => {
    fetchJobMedia.mockResolvedValue({ before: [], after: [] });
    render(<JobMediaGallery jobKey="1051" />);
    expect(await screen.findByText("No before media yet")).toBeInTheDocument();
    expect(screen.getByText("No after media yet")).toBeInTheDocument();
  });
});
