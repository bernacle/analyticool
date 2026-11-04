import { expect, test } from "@playwright/test";

test("review, approve, publish, revise, and reload the synthetic metric", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Describe a metric.",
  );
  const dashboard = page.getByRole("region", {
    name: "Example revenue dashboard",
  });
  const approve = page.getByRole("button", {
    name: "Approve metric",
    exact: true,
  });
  const publish = page.getByRole("button", {
    name: "Publish approved version",
  });

  await page.getByRole("button", { name: "Generate proposal" }).click();
  await expect(page.getByRole("status")).toContainText("draft · version 1");
  await page.getByText("Inspect typed proposal", { exact: true }).click();
  await expect(page.getByLabel("Typed metric proposal")).toContainText(
    "synthetic-billing",
  );
  await page.getByText("Inspect typed proposal", { exact: true }).click();
  await expect(approve).toBeDisabled();
  await expect(publish).toBeDisabled();
  await expect(dashboard).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("status")).toContainText("ready_for_review");
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("approved");
  await expect(dashboard).toHaveCount(0);
  await publish.click();
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText("Jun 2026 collected revenue");
  await expect(dashboard).toContainText("$3,420.00");
  await expect(page.getByRole("status")).toContainText("version 1 · published");
  await expect(approve).toBeDisabled();
  await expect(publish).toBeDisabled();
  await dashboard.getByText("View exact values", { exact: true }).click();
  const table = dashboard.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(table).toContainText("$2,000.00");
  await expect(table).toContainText("$3,420.00");

  await page.getByRole("button", { name: "Create next version" }).click();
  await expect(page.getByRole("status")).toContainText("draft · version 2");
  await expect(
    page.getByText("Published definition v1", { exact: false }),
  ).toBeVisible();
  await expect(dashboard).toBeVisible();
  await expect(approve).toBeDisabled();
  await expect(publish).toBeDisabled();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await approve.click();
  await publish.click();
  await expect(page.getByRole("status")).toContainText("version 2 · published");
  await expect(
    page
      .getByRole("list", { name: "Published versions" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(dashboard).toContainText("$3,420.00");
  await page.screenshot({
    path: "test-results/demo-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(dashboard).toBeVisible();
  await page.screenshot({
    path: "test-results/demo-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate proposal" }),
  ).toBeEnabled();
  await expect(dashboard).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("requires an explicit fallback for net revenue and supports rejection", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Business question")
    .selectOption({ label: "Show net revenue by customer." });
  await page.getByRole("button", { name: "Generate proposal" }).click();
  await expect(
    page.getByText("Net revenue by customer: definition unresolved"),
  ).toBeVisible();
  const fallback = page.getByRole("button", {
    name: "Use monthly collected revenue instead",
  });
  await expect(fallback).toBeDisabled();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("status")).toContainText("needs_clarification");
  await expect(
    page.getByRole("button", { name: "Approve metric", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish approved version" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("region", { name: "Review and approval" })
      .getByText("What does net revenue subtract", { exact: false }),
  ).toBeVisible();
  await fallback.click();
  await expect(page.getByRole("status")).toContainText("draft");
  await expect(
    page.getByText(
      "Confirmed: use monthly collected revenue without customer grouping.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page
    .getByRole("button", { name: "Approve metric", exact: true })
    .click();
  await page.getByRole("button", { name: "Publish approved version" }).click();
  await expect(
    page.getByRole("region", { name: "Example revenue dashboard" }),
  ).toContainText("$3,420.00");

  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Generate proposal" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(
    page.getByRole("button", { name: "Reject proposal" }),
  ).toBeDisabled();
  await page
    .getByLabel("Rejection reason")
    .fill("We require net revenue by customer, not the fallback.");
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await expect(page.getByRole("status")).toContainText("rejected");
  await expect(
    page.getByRole("button", { name: "Approve metric", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish approved version" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Example revenue dashboard" }),
  ).toHaveCount(0);
});
