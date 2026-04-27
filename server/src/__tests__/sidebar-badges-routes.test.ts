import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "company-1";

const mockWithCompanyRls = vi.hoisted(() =>
  vi.fn(async (_db: unknown, _companyId: string, operation: (scopedDb: unknown) => Promise<unknown>) =>
    operation({ scoped: true, select: mockSelect }),
  ),
);
const mockBadgeService = vi.hoisted(() => ({
  get: vi.fn(),
}));
const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));
const mockDashboardService = vi.hoisted(() => ({
  summary: vi.fn(),
}));
const mockSelect = vi.hoisted(() =>
  vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  })),
);

vi.mock("../services/company-rls.js", () => ({
  withCompanyRls: mockWithCompanyRls,
}));

vi.mock("../services/sidebar-badges.js", () => ({
  sidebarBadgeService: () => mockBadgeService,
}));

vi.mock("../services/access.js", () => ({
  accessService: () => mockAccessService,
}));

vi.mock("../services/dashboard.js", () => ({
  dashboardService: () => mockDashboardService,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ sidebarBadgeRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/sidebar-badges.js")>("../routes/sidebar-badges.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", sidebarBadgeRoutes({ select: mockSelect } as never));
  app.use(errorHandler);
  return app;
}

describe("sidebar badges route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBadgeService.get.mockResolvedValue({
      inbox: 1,
      approvals: 1,
      failedRuns: 0,
      joinRequests: 0,
    });
    mockDashboardService.summary.mockResolvedValue({
      agents: { error: 0 },
      costs: { monthBudgetCents: 0, monthUtilizationPercent: 0 },
    });
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
  });

  it("runs company-scoped badge computation inside RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: [companyId],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get(`/api/companies/${companyId}/sidebar-badges`);

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
    expect(mockBadgeService.get).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        dismissals: expect.any(Map),
        joinRequests: expect.any(Array),
      }),
    );
    expect(mockDashboardService.summary).toHaveBeenCalledWith(companyId);
  });

  it("checks company access before entering RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-2"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get(`/api/companies/${companyId}/sidebar-badges`);

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockBadgeService.get).not.toHaveBeenCalled();
  });
});
