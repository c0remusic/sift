// `notice-banner.ts` — la recette unique des bandeaux de Revue (doublon, sous 320).
import { describe, expect, it } from "vitest";
import { noticeBannerHtml } from "../frontend/notice-banner";

describe("noticeBannerHtml", () => {
  it("avertissement : fond et encre d'avertissement, icône, titre et ligne", () => {
    const html = noticeBannerHtml({ tone: "warning", icon: "ti-alert-triangle", head: "H", body: "B" });
    expect(html).toContain("background:var(--color-background-warning)");
    expect(html).toContain('class="ti ti-alert-triangle" style="color:var(--color-text-warning)"');
    expect(html).toContain('<div class="sift-dup-banner-head" style="color:var(--color-text-warning)">H</div>');
    expect(html).toContain('<div class="sift-dup-banner-where">B</div>');
  });

  it("neutre : fond secondaire, encre tertiaire", () => {
    const html = noticeBannerHtml({ tone: "neutral", icon: "ti-copy", head: "H", body: "B" });
    expect(html).toContain("background:var(--color-background-secondary)");
    expect(html).toContain("color:var(--color-text-tertiary)");
  });
});
