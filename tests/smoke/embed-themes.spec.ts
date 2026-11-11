import { expect, test, type Page } from "@playwright/test";

// Committed evidence for docs/design/embed-theming/README.md. Written on every
// smoke run (the smoke run is local/opt-in and not part of CI).
const shots = "docs/design/embed-theming/screenshots";
const themes = ["analyticool", "customer"] as const;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The demo has no favicon; the browser's automatic request 404s.
    if (/favicon\.ico/.test(message.location().url)) return;
    if (message.type() === "error" || /hydrat/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

type Rgba = [number, number, number, number];
const parseColor = (value: string): Rgba => {
  const parts = value.match(/rgba?\(([^)]+)\)/)?.[1]?.split(/[\s,/]+/);
  if (!parts) throw new Error(`Unparsed colour: ${value}`);
  const [r = 0, g = 0, b = 0, a = 1] = parts.filter(Boolean).map(Number);
  return [r, g, b, a];
};
const luminance = ([r, g, b]: Rgba) => {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (text: string, background: string) => {
  const bg = parseColor(background);
  const fg = parseColor(text);
  const blended: Rgba = [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
    1,
  ];
  const [hi, lo] = [luminance(blended), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("server-renders both themed embeds from the same result", async ({
  request,
}) => {
  const html = await (await request.get("/embed-themes")).text();
  expect(html.match(/class="ac-metric-chart host-card"/g)).toHaveLength(2);
  expect(html.match(/class="ac-metric-kpi host-card"/g)).toHaveLength(2);
  expect(html.match(/data-ac-part="series"/g)).toHaveLength(2);
  expect(html.match(/\$3,420\.00/g)?.length).toBeGreaterThanOrEqual(2);
  expect(html).toContain("Synthetic data");
});

test("customer CSS themes the embeds without product CSS leaking", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.goto("/embed-themes");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "One metric, two host themes",
  );

  const probe = await page.evaluate(() => {
    const resolve = (value: string) => {
      const el = document.createElement("span");
      el.style.color = value;
      document.body.append(el);
      const computed = getComputedStyle(el).color;
      el.remove();
      return computed;
    };
    return Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("section[data-theme]")].map(
        (section) => {
          const q = (selector: string) => section.querySelector(selector)!;
          const cs = (selector: string) => getComputedStyle(q(selector));
          const variable = (name: string) =>
            getComputedStyle(section).getPropertyValue(name).trim();
          return [
            section.dataset.theme!,
            {
              sectionFont: getComputedStyle(section).fontFamily,
              chartFont: cs(".ac-metric-chart").fontFamily,
              kpiFont: cs(".ac-metric-kpi").fontFamily,
              fontVariable: variable("--ac-font"),
              seriesStroke: cs('[data-ac-part="series"]').stroke,
              pointFill: cs('[data-ac-part="point"]').fill,
              seriesVariable: resolve(variable("--ac-series")),
              surface: cs(".ac-metric-chart").backgroundColor,
              kpiSurface: cs(".ac-metric-kpi").backgroundColor,
              surfaceVariable: resolve(variable("--ac-surface")),
              radius: cs(".ac-metric-chart").borderTopLeftRadius,
              radiusVariable: variable("--ac-radius"),
            },
          ];
        },
      ),
    );
  });

  const a = probe.analyticool!;
  const c = probe.customer!;
  for (const theme of [a, c]) {
    // Each embed matches its own theme's variables...
    expect(theme.seriesStroke).toBe(theme.seriesVariable);
    expect(theme.pointFill).toBe(theme.seriesVariable);
    expect(theme.surface).toBe(theme.surfaceVariable);
    expect(theme.kpiSurface).toBe(theme.surfaceVariable);
    expect(theme.radius).toBe(theme.radiusVariable);
    // ...and uses the host section's font.
    expect(theme.chartFont).toBe(theme.sectionFont);
    expect(theme.kpiFont).toBe(theme.sectionFont);
  }
  // The two appearances are genuinely different.
  expect(a.chartFont).not.toBe(c.chartFont);
  expect(a.seriesStroke).not.toBe(c.seriesStroke);
  expect(a.surface).not.toBe(c.surface);
  expect(a.chartFont).toContain("Geist");
  expect(a.seriesStroke).toBe("rgb(172, 164, 246)");
  expect(a.surface).toBe("rgb(22, 20, 18)");
  // The customer sets no --ac-font: the font is purely inherited.
  expect(c.fontVariable).toBe("");
  expect(c.chartFont).toContain("Charter");
  expect(c.surface).toBe("rgb(255, 255, 255)");

  // No product CSS on this route: every loaded rule is scoped to the host page.
  const selectors = await page.evaluate(() => {
    const out: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) out.push(rule.selectorText);
        else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
        else out.push(rule.cssText.slice(0, 40));
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return out;
  });
  expect(selectors.length).toBeGreaterThan(0);
  for (const selector of selectors.flatMap((s) => s.split(","))) {
    expect(selector.trim()).toMatch(/^\.embed-themes\b/);
  }
  expect(selectors.join(" ")).not.toMatch(/--tw-|tailwind|:root|\bbody\b/);
  // The UA default body margin is untouched (globals.css would reset it).
  expect(
    await page.evaluate(() => getComputedStyle(document.body).margin),
  ).toBe("8px");

  // Host elements outside the embeds are unaffected by the embeds' presence.
  const hostStyles = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "h1, .embed-themes__intro p, .host-bar h2, .host-bar p, .host-bar button",
        ),
      ].map((el) => {
        const s = getComputedStyle(el);
        return [
          s.fontFamily,
          s.fontSize,
          s.fontWeight,
          s.color,
          s.backgroundColor,
          s.margin,
          s.padding,
          s.borderTopWidth,
          s.outlineStyle,
          s.lineHeight,
        ].join("|");
      }),
    );
  const withEmbeds = await hostStyles();
  expect(withEmbeds).toHaveLength(8);
  await page.evaluate(() =>
    document
      .querySelectorAll(".ac-metric-chart, .ac-metric-kpi")
      .forEach((el) => el.remove()),
  );
  expect(await hostStyles()).toEqual(withEmbeds);
  expect(errors).toEqual([]);
});

test("focus, contrast, tooltips, motion and narrow screens", async ({
  page,
}) => {
  const errors = trackErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/embed-themes");

  for (const theme of themes) {
    const summary = page.locator(
      `[data-theme="${theme}"] [data-ac-part="summary"]`,
    );
    let focused = false;
    for (let i = 0; i < 20 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await summary.evaluate((el) => el === document.activeElement);
    }
    expect(focused, `${theme} summary reachable by Tab`).toBe(true);
    const outline = await summary.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(
      page.locator(`[data-theme="${theme}"] [data-ac-part="table"]`),
    ).toBeVisible();
  }

  for (const theme of themes) {
    const pairs = await page.evaluate((id) => {
      const section = document.querySelector(`[data-theme="${id}"]`)!;
      const surface = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const bg = getComputedStyle(node).backgroundColor;
          if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
        }
        return "rgb(255, 255, 255)";
      };
      const text = (selector: string, svg = false) =>
        [...section.querySelectorAll(selector)].map((el) => ({
          selector,
          color: svg ? getComputedStyle(el).fill : getComputedStyle(el).color,
          background: surface(el),
        }));
      return [
        ...text('[data-ac-part="label"]'),
        ...text('[data-ac-part="value"]'),
        ...text('[data-ac-part="caption"]'),
        ...text('[data-ac-part="summary"]'),
        ...text('[data-ac-part="table"] caption'),
        ...text('[data-ac-part="table"] td'),
        ...text('[data-ac-part="axis"]', true),
      ];
    }, theme);
    expect(pairs.length).toBeGreaterThan(10);
    for (const pair of pairs) {
      expect(
        contrast(pair.color, pair.background),
        `${theme} ${pair.selector} ${pair.color} on ${pair.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }

  // Native per-point tooltip: the hovered point carries its exact value.
  const point = page
    .locator('[data-theme="customer"] [data-ac-part="point"]')
    .last();
  await point.hover();
  const hovered = await page.evaluate(
    () =>
      document
        .querySelector('[data-theme="customer"] [data-ac-part="point"]:hover')
        ?.querySelector("title")?.textContent,
  );
  expect(hovered).toBe("Jun 2026: $3,420.00");

  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(
    await page.evaluate(() => {
      const values = [...document.querySelectorAll("*")].flatMap((el) => {
        const s = getComputedStyle(el);
        return [s.transitionDuration, s.animationName];
      });
      return values.filter((v) => v !== "0s" && v !== "none");
    }),
  ).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  expect(errors).toEqual([]);
});

test("captures desktop and 390px screenshots of both themes", async ({
  page,
}) => {
  await page.goto("/embed-themes");
  for (const theme of themes) {
    await page
      .locator(`[data-theme="${theme}"] [data-ac-part="summary"]`)
      .click();
  }
  // Leave the focus ring visible on the customer disclosure for the record.
  await page
    .locator('[data-theme="customer"] [data-ac-part="summary"]')
    .press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.screenshot({
    path: `${shots}/embed-themes-desktop.png`,
    fullPage: true,
  });
  for (const theme of themes) {
    await page.locator(`[data-theme="${theme}"]`).screenshot({
      path: `${shots}/embed-theme-${theme}.png`,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${shots}/embed-themes-mobile.png`,
    fullPage: true,
  });
});
