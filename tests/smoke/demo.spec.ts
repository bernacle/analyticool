import { expect, test } from "@playwright/test";

test("review, approve, embed, reset, and reload the synthetic metric", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Describe a metric.",
  );
  await expect(page.getByRole("status")).toHaveText("Awaiting your review.");
  const dashboard = page.getByRole("region", {
    name: "Example revenue dashboard",
  });
  await expect(dashboard).toHaveCount(0);

  await page.getByText("View exact values", { exact: true }).click();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(table).toContainText("$2,000.00");
  await expect(table).toContainText("$3,420.00");

  await page.getByRole("button", { name: "Approve demo metric" }).focus();
  await page.keyboard.press("Enter");
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText("Jun 2026 collected revenue");
  await expect(dashboard).toContainText("$3,420.00");
  await page.screenshot({
    path: "test-results/demo-desktop.png",
    fullPage: true,
  });
  await expect(page.getByRole("status")).toHaveText(
    "Approved for this local demo session.",
  );

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

  await page.getByRole("button", { name: "Reset demo approval" }).click();
  await expect(dashboard).toHaveCount(0);
  await page.getByRole("button", { name: "Approve demo metric" }).click();
  await expect(dashboard).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve demo metric" }),
  ).toBeVisible();
  await expect(dashboard).toHaveCount(0);
  expect(errors).toEqual([]);
});
