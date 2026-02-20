import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";

vi.mock("@tanstack/react-router", () => ({
	useSearch: () => ({ url: "" }),
	useNavigate: () => vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: vi.fn(() => ({ data: null, isLoading: false, refetch: vi.fn() })),
}));

vi.mock("@renderer/components/ui/CheckoutDialog", () => ({
	CheckoutDialog: () => null,
}));

vi.mock("@renderer/hooks/useWorkingCopyContext", () => ({
	useWorkingCopyContext: vi.fn(() => ({ data: null, isLoading: false })),
}));

import { RepoBrowserContent } from "../src/routes/repo-browser/RepoBrowserContent";

describe("RepoBrowserContent Working Copy Detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("component structure", () => {
		it("renders without localPath prop", () => {
			render(<RepoBrowserContent />);
			expect(
				screen.getByPlaceholderText(/repository URL/i),
			).toBeInTheDocument();
		});

		it("renders with localPath prop", () => {
			render(<RepoBrowserContent localPath="/path/to/wc" />);
			expect(
				screen.getByPlaceholderText(/repository URL/i),
			).toBeInTheDocument();
		});

		it("displays connect button", () => {
			render(<RepoBrowserContent />);
			expect(
				screen.getByRole("button", { name: /connect/i }),
			).toBeInTheDocument();
		});
	});

	describe("working copy context integration", () => {
		it("accepts localPath as optional prop", () => {
			const { rerender } = render(<RepoBrowserContent />);
			expect(
				screen.getByPlaceholderText(/repository URL/i),
			).toBeInTheDocument();

			rerender(<RepoBrowserContent localPath="/new/path" />);
			expect(
				screen.getByPlaceholderText(/repository URL/i),
			).toBeInTheDocument();
		});

		it("repo browser works standalone without localPath", () => {
			render(<RepoBrowserContent />);
			const urlInput = screen.getByPlaceholderText(/repository URL/i);
			expect(urlInput).toBeInTheDocument();
			expect(urlInput).toHaveValue("");
		});
	});
});
