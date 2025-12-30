/**
 * @fileoverview Unit tests for the StatusBadge component.
 */
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../../../app/_components/StatusBadge";

describe("StatusBadge", () => {
  it("renders success badge", () => {
    render(<StatusBadge status="SUCCESS" />);
    const badge = screen.getByText("SUCCESS");
    expect(badge).toHaveClass("success");
  });

  it("renders failed badge", () => {
    render(<StatusBadge status="FAILED" />);
    const badge = screen.getByText("FAILED");
    expect(badge).toHaveClass("failed");
  });

  it("renders pending badge", () => {
    render(<StatusBadge status="PENDING" />);
    const badge = screen.getByText("PENDING");
    expect(badge).toHaveClass("pending");
  });
});
