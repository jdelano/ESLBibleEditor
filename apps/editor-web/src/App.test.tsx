import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the editor shell", async () => {
    render(<App />);
    expect(await screen.findByText("KJVeasy-ISL Editor")).toBeInTheDocument();
    expect(await screen.findByText("Chapter Editor")).toBeInTheDocument();
    expect(await screen.findByText("Phase 3 Tools")).toBeInTheDocument();
  });
});
