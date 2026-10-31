// Handler-level tests for the export QA gate (fail-closed export).
// Portable: the fixture image is embedded below, no local files needed.
// Run with:  deno test --no-check --allow-all supabase/functions/export-pdf/index.handler-test.ts
// (network is used for esm.sh imports and the font CDN; the renderer falls
// back to Helvetica if the font fetch fails.)
//
// Strategy: boot the real serve() handler from index.ts, patch
// globalThis.fetch so the Supabase control plane (auth, entitlements) is
// faked, every storage/books write is RECORDED AND FAILED, and image URLs
// under https://images.test are served by this test with scripted statuses.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  bookFingerprint,
  CONTINUITY_DIMENSIONS,
} from "../_shared/bookContinuity.ts";

const SUPA = "http://supabase.test";
Deno.env.set("SUPABASE_URL", SUPA);
Deno.env.set("SUPABASE_ANON_KEY", "anon-test-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-test-key");

// 300x200 JPEG (3:2, like landscape story art), embedded for portability.
const FIXTURE_JPEG_B64 =
  "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";
const fixtureBytes: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(FIXTURE_JPEG_B64), (c) => c.charCodeAt(0));
// Page-shaped cover fixtures (300x214 ~= A4 landscape ratio) for the
// ink-vs-plate title decision: one light and even, one dark and noisy.
const LIGHT_COVER_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCADWASwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2yiiivHPoAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//2Q==";
const DARK_COVER_JPEG_B64 = "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";
const urlBytes = new Map<string, Uint8Array<ArrayBuffer>>([
  ["https://images.test/cover-light.jpg", Uint8Array.from(atob(LIGHT_COVER_JPEG_B64), (c) => c.charCodeAt(0))],
  ["https://images.test/cover-dark.jpg", Uint8Array.from(atob(DARK_COVER_JPEG_B64), (c) => c.charCodeAt(0))],
]);
const FIXTURE_DATA_URL = `data:image/jpeg;base64,${FIXTURE_JPEG_B64}`;

// Every storage/books write the handler attempted.
const writeAttempts: string[] = [];
// Fetch counts per images.test URL, and the scripted response queue.
const imageFetches = new Map<string, number>();
let imageScript = new Map<string, number[]>(); // url -> statuses to serve in order; last repeats

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(SUPA)) {
    if (url.includes("/auth/v1/user")) {
      return Response.json({ id: "user-1", email: "tester@example.com" });
    }
    if (url.includes("/rest/v1/entitlements")) {
      return Response.json([{ id: "ent-1" }]);
    }
    writeAttempts.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json({ error: "writes disabled in gate test" }, { status: 500 });
  }
  if (url.startsWith("https://images.test/")) {
    imageFetches.set(url, (imageFetches.get(url) ?? 0) + 1);
    const queue = imageScript.get(url) ?? [200];
    const status = queue.length > 1 ? queue.shift()! : queue[0];
    if (status === 200) {
      return new Response(urlBytes.get(url) ?? fixtureBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("scripted failure", { status });
  }
  return await realFetch(input, init);
}) as typeof fetch;

// Import after env + fetch patch; this starts the real handler on :8000.
await import("./index.ts");
await new Promise((r) => setTimeout(r, 300)); // let the listener bind

const CONFIG = {
  children: ["Fern"],
  pageSize: "A4 landscape",
  storyType: "Woodland adventure",
  pageLayout: "split",
};

const post = (body: unknown) =>
  realFetch("http://127.0.0.1:8000", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Whole-book continuity evidence for the exact synthetic book under test:
// the same shape the editor's review panel records. Computed here so the
// legacy gate tests exercise the new fail-closed 409 semantics on the
// approved path, and so a stale or failed review is a deliberate choice in
// the new continuity tests below rather than an accident of fixture drift.
const makeReview = async (config: any, pages: any[], coverImage?: string) => {
  const book = { ...config, pages, coverImageUrl: coverImage || config?.coverImageUrl };
  return {
    version: 1 as const,
    fingerprint: await bookFingerprint(book),
    method: "whole-book-visual" as const,
    reviewer: "synthetic handler-test reviewer",
    pages: [0, ...pages.map((p: any) => p.page)].map((page: number) => ({
      page,
      findings: CONTINUITY_DIMENSIONS.map((dimension) => ({
        dimension,
        verdict: "pass" as const,
        note: "Synthetic handler-test evidence, not a real review.",
      })),
    })),
  };
};

const postReviewed = async (body: any) =>
  post({
    ...body,
    config: {
      ...body.config,
      continuityReview: await makeReview(body.config, body.pages ?? [], body.coverImage),
    },
  });

const reset = () => {
  writeAttempts.length = 0;
  imageFetches.clear();
  imageScript = new Map();
};

Deno.test({
  name: "gate: over-long page is refused with a plain 422 BEFORE any storage or books write",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const longPage = Array.from(
      { length: 14 },
      (_, i) => `Line ${i + 1} of a deliberately far too long page that keeps going and going.`,
    ).join("\n");
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: longPage, imageUrl: FIXTURE_DATA_URL }],
      storyId: "story-gate-block",
      includeBleed: true,
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.success, false);
    assertEquals(typeof body.error, "string");
    assertStringIncludes(body.error, "isn't quite ready to export");
    assertStringIncludes(body.error, "more words than fit nicely");
    assert(Array.isArray(body.blockers) && body.blockers.length > 0, "blockers listed");
    assert(body.blockers.every((b: { where?: string; check?: string }) => b.where && b.check));
    assertEquals(writeAttempts, [], "refusal must not touch storage or the books table");
  },
});

Deno.test({
  name: "gate: clean illustrated book exports and returns QA detail",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-gate-clean",
      includeBleed: true,
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertStringIncludes(body.webPdfUrl, "data:application/pdf;base64,"); // storage writes fail here, inline fallback
    assert(Array.isArray(body.qa), "QA detail returned");
    assert(imageFetches.get("https://images.test/ok.jpg")! >= 2, "image fetched for web and print");
  },
});

Deno.test({
  name: "gate: missing illustration (404, a real miss) blocks - fetched once, never retried",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    imageScript.set("https://images.test/gone.jpg", [404]);
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/gone.jpg" }],
      storyId: "story-gate-404",
      includeBleed: true,
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertStringIncludes(body.error, "illustrations are missing or could not be prepared");
    // 4 embed sites (page + cover, web + print), each fetched exactly once: a
    // 4xx is a real miss and must not be retried.
    assertEquals(imageFetches.get("https://images.test/gone.jpg"), 4);
    assertEquals(writeAttempts, []);
  },
});

Deno.test({
  name: "gate: persistent 5xx exhausts the bounded retry (3 attempts per embed) then blocks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    imageScript.set("https://images.test/flaky-down.jpg", [500]);
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/flaky-down.jpg" }],
      storyId: "story-gate-500",
      includeBleed: true,
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertStringIncludes(body.error, "illustrations are missing or could not be prepared");
    // 4 embed sites x exactly 3 attempts: bounded, never an unbounded loop.
    assertEquals(imageFetches.get("https://images.test/flaky-down.jpg"), 12);
    assertEquals(writeAttempts, []);
  },
});

Deno.test({
  name: "gate: transient 5xx (two failures then success) recovers via the bounded retry",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    imageScript.set("https://images.test/flaky.jpg", [500, 500, 200]);
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/flaky.jpg" }],
      storyId: "story-gate-retry",
      includeBleed: true,
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assert(imageFetches.get("https://images.test/flaky.jpg")! >= 3, "retry recovered the image");
  },
});

Deno.test({
  name: "cover: dedicated cover unreadable after retries -> page art reused, uncropped, with a warning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    imageScript.set("https://images.test/cover-dead.jpg", [500]);
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/page-art.jpg" }],
      storyId: "story-gate-cover",
      includeBleed: true,
      coverImage: "https://images.test/cover-dead.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(imageFetches.get("https://images.test/cover-dead.jpg"), 6, "bounded retry on the cover read (web + print)");
    const warns = body.qa.filter((q: { severity: string; check: string }) => q.severity === "warn").map((q: { check: string }) => q.check);
    assert(warns.some((c: string) => c.includes("dedicated cover illustration could not be read; reused page art")), `fallback warning present in QA: ${JSON.stringify(warns)}`);
  },
});

Deno.test({
  name: "gate: deliberately text-only book (every page imageLocked) still exports",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: CONFIG,
      pages: [
        { page: 1, text: "A quiet page with only words.", imageLocked: true },
        { page: 2, text: "Another page the author chose to keep as text.", imageLocked: true },
      ],
      storyId: "story-gate-textonly",
      includeBleed: true,
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
  },
});

Deno.test({
  name: "cover: light dedicated art still takes the paper plate (safe default, no runtime tone check)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-light",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const coverChecks = (body.qa as { where: string; check: string }[]).filter((q) => q.where === "cover").map((q) => q.check);
    assert(
      coverChecks.some((c) => c.includes("paper plate (safe default")),
      `plate QA line present even on light art: ${JSON.stringify(coverChecks)}`,
    );
    assert(
      !coverChecks.some((c) => c.includes("ink on the art")),
      `no ink-on-art path remains: ${JSON.stringify(coverChecks)}`,
    );
  },
});

Deno.test({
  name: "cover: dark busy dedicated art takes the same paper plate (no art-dependent branch)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-dark",
      includeBleed: true,
      coverImage: "https://images.test/cover-dark.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const coverChecks = (body.qa as { where: string; check: string }[]).filter((q) => q.where === "cover").map((q) => q.check);
    assert(
      coverChecks.some((c) => c.includes("paper plate (safe default")),
      `plate QA line present: ${JSON.stringify(coverChecks)}`,
    );
  },
});

Deno.test({
  name: "cover: an explicit title carrying control characters and excess length is sanitised, with a QA warning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: { ...CONFIG, title: `Fern's Big\nAdventure ${"x".repeat(200)}` },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-title-sanitise",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const warns = (body.qa as { severity: string; check: string }[]).filter((q) => q.severity === "warn").map((q) => q.check);
    assert(
      warns.some((c) => c.includes("cover title sanitised")),
      `sanitise warning present: ${JSON.stringify(warns)}`,
    );
  },
});

Deno.test({
  name: "cover: schema-maximum subtitle (100-char story type) and dedication (200 chars) render without overflow or crash",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: {
        ...CONFIG,
        storyType: "A very long story type description that a family might write to describe their adventure book!!!!!!!", // 100 chars
        personal: { dedication: `For someone very special. ${"With love always and forever. ".repeat(6)}` }, // ~205 chars of input
      },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-long-subtext",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    // Long sub-text is fitted whole (shrunk to the readable floor, the
    // dedication wrapped) and the fit is acknowledged in QA - never
    // silently drawn past the measure, never truncated.
    const checks = (body.qa as { severity: string; check: string }[]).map((q) => `${q.severity}: ${q.check}`);
    const flagged = checks.filter((c) => c.includes("story type") || c.includes("subtitle") || c.includes("dedication"));
    assert(flagged.length > 0, `long sub-text acknowledged in QA: ${JSON.stringify(checks)}`);
    assert(flagged.every((c) => c.startsWith("pass")), `fitted sub-text is acknowledged, not warned: ${JSON.stringify(flagged)}`);
    assert(flagged.every((c) => c.includes("every word preserved")), `no truncation: ${JSON.stringify(flagged)}`);
  },
});

Deno.test({
  name: "cover: a schema-max 100-char story type FITS on the narrowest format (A5 portrait) wrapped to two readable lines",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: { ...CONFIG, pageSize: "A5 portrait", storyType: `a gentle personalised bedtime adventure about courage, kindness and saying goodnight to the wide day` }, // exactly 100 chars
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-storytype-a5",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const checks = (body.qa as { severity: string; check: string }[]).map((q) => `${q.severity}: ${q.check}`);
    const storyType = checks.filter((c) => c.includes("story type"));
    assert(storyType.length > 0, `story type fit acknowledged: ${JSON.stringify(checks)}`);
    assert(storyType.every((c) => c.startsWith("pass")), `no story type failure on A5 portrait: ${JSON.stringify(storyType)}`);
    assert(storyType.every((c) => c.includes("every word preserved")), `no truncation: ${JSON.stringify(storyType)}`);
    assert(storyType.some((c) => c.includes("wrapped to 2 lines")), `bounded two-line layout used: ${JSON.stringify(storyType)}`);
  },
});

Deno.test({
  name: "cover: a refusal for cover lettering says so in plain language (no misleading 'illustrations' reason)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: {
        ...CONFIG,
        pageSize: "A5 portrait",
        personal: { dedication: `For someone very special. ${"With love always and forever. ".repeat(6)}` }, // cannot fit readably: blocks
      },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-plain-reason",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.success, false);
    assert(
      (body.error as string).includes("cover"),
      `the plain-language refusal names the cover words, not the illustrations: ${body.error}`,
    );
  },
});

Deno.test({
  name: "cover: a dedication that cannot fit readably BLOCKS the export (family words are never truncated)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: {
        ...CONFIG,
        pageSize: "A5 portrait", // narrow measure: even two wrapped lines at the 10pt floor cannot hold this
        personal: { dedication: `For someone very special. ${"With love always and forever. ".repeat(6)}` }, // ~205 chars
      },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-unfittable-dedication",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.success, false);
    assert(
      (body.blockers as { check: string }[]).some((b) => b.check.includes("dedication")),
      `the refusal names the dedication with a clear reason: ${JSON.stringify(body.blockers)}`,
    );
  },
});

Deno.test({
  name: "cover: a vetted coverStyle spec is applied and recorded in QA",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: {
        ...CONFIG,
        coverStyle: {
          typeface: "bouncy",
          treatment: "bounce",
          titleColor: "#282C42",
          accentColor: "#C24B5A",
          subtitleColor: "#4E6E9E",
        },
      },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-styled",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const coverChecks = (body.qa as { where: string; check: string }[]).filter((q) => q.where === "cover").map((q) => q.check);
    assert(
      coverChecks.some((c) => c.includes("cover style: bouncy/bounce, title #282C42, accent #C24B5A")),
      `applied style recorded: ${JSON.stringify(coverChecks)}`,
    );
    assert(
      !coverChecks.some((c) => c.includes("coverStyle clamped")),
      `no clamps for a valid spec: ${JSON.stringify(coverChecks)}`,
    );
  },
});

Deno.test({
  name: "cover: an invalid coverStyle is clamped to the safe defaults with a QA warning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: {
        ...CONFIG,
        coverStyle: { typeface: "papyrus", treatment: "spiral", titleColor: "#FCBAA3" },
      },
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-cover-clamped",
      includeBleed: true,
      coverImage: "https://images.test/cover-light.jpg",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    const coverChecks = (body.qa as { where: string; check: string }[]).filter((q) => q.where === "cover").map((q) => q.check);
    assert(
      coverChecks.some((c) => c.includes("coverStyle clamped") && c.includes("papyrus") && c.includes("#FCBAA3")),
      `clamps recorded: ${JSON.stringify(coverChecks)}`,
    );
    assert(
      coverChecks.some((c) => c.includes("cover style: classic/straight")),
      `defaults applied: ${JSON.stringify(coverChecks)}`,
    );
  },
});

Deno.test({
  name: "continuity gate: missing review is refused 409 BEFORE entitlement lookup, storage or books writes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await post({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-continuity-missing",
      includeBleed: true,
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertStringIncludes(body.error, "continuity review");
    assertStringIncludes(body.blockers.join(" "), "Whole-book visual continuity review is missing");
    assertEquals(writeAttempts, []);
    assertEquals(imageFetches.size, 0);
  },
});

Deno.test({
  name: "continuity gate: stale evidence (book changed after review) is refused 409",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const pages = [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }];
    const review = await makeReview(CONFIG, pages);
    const res = await post({
      config: { ...CONFIG, continuityReview: review },
      pages: [{ ...pages[0], text: "Fern rode her bike to the oak instead." }],
      storyId: "story-continuity-stale",
      includeBleed: true,
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assert(
      body.blockers.some((b: string) => b.includes("stale")),
      "stale fingerprint reported",
    );
    assertEquals(writeAttempts, []);
    assertEquals(imageFetches.size, 0);
  },
});

Deno.test({
  name: "continuity gate: a failed dimension with a current fingerprint is still refused 409",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const pages = [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }];
    const review = await makeReview(CONFIG, pages);
    review.pages[1].findings[0] = {
      dimension: "location" as const,
      verdict: "fail" as const,
      note: "School entrance changes to a domestic door without transition.",
    };
    const res = await post({
      config: { ...CONFIG, continuityReview: review },
      pages,
      storyId: "story-continuity-failed",
      includeBleed: true,
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assert(
      body.blockers.some((b: string) => b.includes("Page 1: location")),
      "failed dimension reported per page",
    );
    assertEquals(writeAttempts, []);
    assertEquals(imageFetches.size, 0);
  },
});

Deno.test({
  name: "continuity gate: complete current evidence passes the gate and the approved path exports",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    reset();
    const res = await postReviewed({
      config: CONFIG,
      pages: [{ page: 1, text: "Fern met Badger by the oak.", imageUrl: "https://images.test/ok.jpg" }],
      storyId: "story-continuity-approved",
      includeBleed: true,
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true);
    assertStringIncludes(body.webPdfUrl, "data:application/pdf;base64,");
  },
});
