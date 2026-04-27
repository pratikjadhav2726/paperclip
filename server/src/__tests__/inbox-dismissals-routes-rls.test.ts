import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "company-1";
const userId = "user-1";

const mockInboxDismissalService = vi.hoisted(() => ({
  list: vi.fn(),
  dismiss: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockWithCompanyRls = vi.hoisted(() =>
  vi.fn(async (_db: unknown, _companyId: string, operation: (scopedDb: unknown) => Promise<unknown>) =>
    operation({ scoped: true }),
  ),
);

vi.mock("../services/company-rls.js", () => ({
  withCompanyRls: mockWithCompanyRls,
}));

vi.mock("../services/index.js", () => ({
  inboxDismissalService: () => mockInboxDismissalService,
  logActivity: mockLogActivity,
}));

async function createApp() {
  const [{ errorHandler }, { inboxDismissalRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/inbox-dismissals.js")>("../routes/inbox-dismissals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId,
      companyIds: [companyId],
      memberships: [{ companyId, status: "active", membershipRole: "admin" }],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", inboxDismissalRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("inbox dismissal routes RLS scoping", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockInboxDismissalService)) mock.mockReset();
    mockLogActivity.mockReset();
    mockWithCompanyRls.mockClear();
  });

  it("lists dismissals inside company RLS scope", async () => {
    mockInboxDismissalService.list.mockResolvedValue([{ itemKey: "approval:1" }]);

    const app = await createApp();
    const res = await request(app).get(`/api/companies/${companyId}/inbox-dismissals`);

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
    expect(mockInboxDismissalService.list).toHaveBeenCalledWith(companyId, userId);
  });

  it("dismisses inbox items and logs activity inside company RLS scope", async () => {
    mockInboxDismissalService.dismiss.mockResolvedValue({
      itemKey: "approval:1",
      dismissedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    const app = await createApp();
    const res = await request(app)
      .post(`/api/companies/${companyId}/inbox-dismissals`)
      .send({ itemKey: "approval:1" });

    expect(res.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
    expect(mockInboxDismissalService.dismiss).toHaveBeenCalledWith(
      companyId,
      userId,
      "approval:1",
      expect.any(Date),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        action: "inbox.dismissed",
        entityType: "company",
      }),
    );
  });

  it("checks company access before entering RLS scope", async () => {
    const app = await createApp();
    const res = await request(app).get("/api/companies/company-2/inbox-dismissals");

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockInboxDismissalService.list).not.toHaveBeenCalled();
  });
});
