import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProvider } from "@app/providers/AppContext";
import BeforeAfterMedia from "@features/jobs/components/BeforeAfterMedia";

function renderCard(job, props = {}) {
  return render(
    <AppProvider>
      <BeforeAfterMedia job={job} {...props} />
    </AppProvider>
  );
}

describe("<BeforeAfterMedia />", () => {
  it("renders Before and After columns flagged as needing video when empty", () => {
    renderCard({ id: "x", media: { before: [], after: [] } }, { canCapture: true });
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getAllByText("Video needed")).toHaveLength(2);
  });

  it("marks a phase as satisfied once it has a video", () => {
    const job = {
      id: "y",
      media: { before: [{ id: "1", type: "video", url: "blob:v" }], after: [] },
    };
    renderCard(job, { canCapture: true });
    expect(screen.getByText("Video added")).toBeInTheDocument();
    expect(screen.getByText("Video needed")).toBeInTheDocument();
  });
});
