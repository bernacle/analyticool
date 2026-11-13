import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Written to docs so they can be committed; linked from
// docs/design/darkroom/README.md.
const shots = "docs/design/darkroom/screenshots";
const snippet = readFileSync("apps/demo/lib/embed-example.tsx", "utf8");
const monthly = "Show monthly revenue for the last six months.";
const net = "Show net revenue by customer.";
const accent = "rgb(172, 164, 246)";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Hydration and React errors; a missing favicon is not an app error.
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource")
    )
      errors.push(message.text());
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

const live = (page: Page) => page.locator('[aria-live="polite"]');
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function describeVia(page: Page, example: string) {
  await page.getByRole("button", { name: example, exact: true }).click();
  await expect(page.getByLabel("Metric description")).toHaveValue(example);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

/** Press Tab (keyboard only) until the target has focus. */
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Target not reachable with Tab");
}

async function publishV1(page: Page) {
  await describeVia(page, monthly);
  await page.getByRole("button", { name: "Approve metric" }).click();
  await page.getByRole("button", { name: "Add it to your app" }).click();
  await expect(heading(page)).toHaveText("Add it to your app");
}

for (const viewport of viewports) {
  test(`collected revenue: describe → review → approve → embed at ${viewport.width}px`, async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(heading(page)).toHaveText("What do you want to measure?");
    await expect(
      page.getByText("Synthetic fixtures · local session"),
    ).toBeVisible();
    await expect(page.locator("footer")).toContainText(
      "there is no authenticated reviewer, nothing is saved",
    );
    const stages = page.getByRole("list", { name: "Creation stages" });
    if (viewport.name === "desktop") {
      await expect(stages).toBeVisible();
      await expect(stages.locator('[aria-current="step"]')).toHaveText(
        "Describe",
      );
    } else {
      await expect(stages).toBeHidden();
    }
    await expect(page.getByText("Step 1 of 4 · Describe")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/studio-describe-${viewport.name}.png`,
      fullPage: true,
    });

    await describeVia(page, monthly);
    await expect(heading(page)).toHaveText("Monthly collected revenue · v1");
    await expect(heading(page)).toBeFocused();
    await expect(page.getByText("Step 3 of 4 · Review")).toBeVisible();
    await expect(page.getByTestId("hero-figure")).toHaveText("$3,420.00");
    await expect(
      page.getByText("Draft preview · synthetic fixtures · not approved"),
    ).toBeVisible();
    await expect(page.getByText("Draft · awaiting local review")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/studio-review-${viewport.name}.png`,
      fullPage: true,
    });

    const approve = page.getByRole("button", { name: "Approve metric" });
    if (viewport.name === "phone") {
      expect((await approve.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    // Keyboard only: Tab from the focused heading to Approve, then Enter.
    await tabTo(page, approve);
    await page.keyboard.press("Enter");
    await expect(live(page)).toHaveText(
      "Approved v1 locally in this browser session. Not saved and not a numerical verification.",
    );
    await expect(
      page.getByText("Approved locally · synthetic fixtures · not published"),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No authenticated reviewer, not saved, and not a numerical verification.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add it to your app" }).click();
    await expect(heading(page)).toHaveText("Add it to your app");
    await expect(live(page)).toHaveText(
      "Published v1 in this session only. It is not persisted.",
    );
    const preview = page.getByRole("region", { name: "Embed preview" });
    await expect(preview).toContainText("Jun 2026 collected revenue");
    await expect(preview).toContainText("$3,420.00");
    await preview.getByText("View exact values", { exact: true }).click();
    const table = preview.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(7);
    await expect(table).toContainText("$2,000.00");
    await expect(
      page.getByRole("list", { name: "Published versions" }),
    ).toContainText(
      "v1 · studio-proposal-1 · approved by local-session (unauthenticated)",
    );
    await expect(page.getByLabel("React embedding example")).toHaveText(
      snippet,
    );
    await expect(
      page.getByText("is not available: there is no hosted API", {
        exact: false,
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `${shots}/studio-embed-${viewport.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

test("copy puts the exact snippet on the clipboard and announces it", async ({
  page,
  context,
}) => {
  const errors = trackErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await publishV1(page);

  const copy = page.locator("button.copy");
  const width = (await copy.boundingBox())?.width;
  await expect(copy).toHaveAccessibleName("Copy code");
  await copy.click();
  await expect(live(page)).toHaveText(
    "Copied the React code to the clipboard.",
  );
  await expect(copy).toHaveAccessibleName("✓ Copied");
  expect((await copy.boundingBox())?.width).toBe(width);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    snippet,
  );
  await expect(copy).toHaveAccessibleName("Copy code", { timeout: 4_000 });

  // Error state: a refused clipboard write is announced with a fallback.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await copy.click();
  await expect(live(page)).toHaveText(
    "Copy failed: select the code and copy it manually.",
  );
  await expect(copy).toHaveAccessibleName("Copy code");
  expect(errors).toEqual([]);
});

test("revise publishes v2 while v1 stays intact; reload clears the session", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await publishV1(page);

  await page.getByRole("button", { name: "Create next version" }).click();
  await expect(heading(page)).toHaveText("Monthly collected revenue · v2");
  await expect(
    page.getByText("Draft preview · synthetic fixtures · not approved"),
  ).toBeVisible();
  // Leaving the draft keeps both it and the published v1.
  await page.getByRole("button", { name: "Back to embed" }).click();
  await expect(
    page.getByText("Published v1 in this session · not persisted"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to v2 review" }).click();
  await page.getByRole("button", { name: "Approve metric" }).click();
  await page.getByRole("button", { name: "Add it to your app" }).click();
  await expect(
    page.getByText("Published v2 in this session · not persisted"),
  ).toBeVisible();
  const versions = page
    .getByRole("list", { name: "Published versions" })
    .getByRole("listitem");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText("v1 · studio-proposal-1");
  await expect(versions.nth(1)).toContainText("v2 · studio-proposal-2");
  await expect(page.getByText("result v2 ·", { exact: false })).toBeVisible();

  await page.reload();
  await expect(heading(page)).toHaveText("What do you want to measure?");
  await expect(page.getByLabel("Metric description")).toHaveValue("");
  await expect(
    page.getByRole("list", { name: "Published versions" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("net revenue asks a real clarification; keyboard radios resolve it", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await describeVia(page, net);
  await expect(heading(page)).toHaveText("Which of these did you mean?");
  await expect(
    page.getByText("What does net revenue subtract", { exact: false }),
  ).toBeVisible();
  // Nothing is computed until a supported answer is chosen.
  await expect(page.getByTestId("hero-figure")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("$");
  await page.screenshot({
    path: `${shots}/studio-clarify-desktop.png`,
    fullPage: true,
  });

  const fallback = page.getByRole("radio", {
    name: /Use monthly collected revenue instead/,
  });
  const reject = page.getByRole("radio", { name: /Reject this proposal/ });
  await tabTo(page, fallback);
  await page.keyboard.press("ArrowDown");
  await expect(reject).toBeFocused();
  await expect(reject).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowUp");
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Enter");

  await expect(heading(page)).toHaveText("Monthly collected revenue · v1");
  await expect(page.getByTestId("hero-figure")).toHaveText("$3,420.00");
  await expect(page.getByText("Your clarification")).toBeVisible();

  // Back from review discards the local proposal and keeps the prompt.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(heading(page)).toHaveText("What do you want to measure?");
  await expect(page.getByLabel("Metric description")).toHaveValue(net);
  expect(errors).toEqual([]);
});

test("net revenue can be rejected with a reason; nothing is calculated", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await describeVia(page, net);
  await page.getByRole("radio", { name: /Reject this proposal/ }).click();
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Give a reason before rejecting this proposal.",
  );
  await page
    .getByLabel("Rejection reason")
    .fill("We need net revenue by customer, not a fallback.");
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await expect(heading(page)).toHaveText("Proposal rejected");
  await expect(
    page.getByText("Reason: We need net revenue by customer, not a fallback."),
  ).toBeVisible();
  await expect(live(page)).toHaveText("Proposal v1 rejected in this session.");
  await expect(page.locator("main")).not.toContainText("$");
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(heading(page)).toHaveText("What do you want to measure?");
  expect(errors).toEqual([]);
});

test("unsupported free text fails clearly with no calculation", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Metric description").fill("Show churn by plan.");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Analyticool can't build that metric");
  await expect(alert).toContainText(monthly);
  await expect(alert).toContainText(net);
  await expect(heading(page)).toHaveText("What do you want to measure?");
  await expect(page.getByTestId("hero-figure")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("$");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: `${shots}/studio-unsupported-phone.png`,
    fullPage: true,
  });

  await page.getByLabel("Metric description").fill("");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Describe a metric first",
  );
  expect(errors).toEqual([]);
});

test("focus ring uses the accent and press scale respects reduced motion", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/");
  const chip = page.getByRole("button", { name: monthly, exact: true });
  await tabTo(page, chip);
  const ring = await chip.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.outlineStyle, style.outlineWidth, style.outlineColor];
  });
  expect(ring).toEqual(["solid", "2px", accent]);

  const pressed = async () => {
    const continueButton = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    const box = await continueButton.boundingBox();
    if (!box) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const result = await continueButton.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        transform: style.transform,
        transition: style.transitionProperty,
      };
    });
    await page.mouse.move(0, 0);
    await page.mouse.up();
    return result;
  };

  const normal = await pressed();
  expect(normal.transform).not.toBe("none");
  expect(normal.transition).toContain("transform");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await pressed();
  expect(reduced.transform).toBe("none");
  expect(reduced.transition).not.toContain("transform");

  // The flow still completes with reduced motion.
  await publishV1(page);
  await expect(
    page.getByRole("region", { name: "Embed preview" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
