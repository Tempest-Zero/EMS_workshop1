import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AudioRecorder from "./AudioRecorder";

describe("<AudioRecorder />", () => {
  it("shows a record button when there is no clip", () => {
    render(<AudioRecorder value={null} onChange={() => {}} />);
    expect(screen.getByText("Record voice note")).toBeInTheDocument();
  });

  it("renders the player with duration and clears the clip on delete", () => {
    const onChange = vi.fn();
    render(<AudioRecorder value={{ url: "blob:x", durationMs: 5000 }} onChange={onChange} />);
    expect(screen.getByText("0:05")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Delete voice note"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
