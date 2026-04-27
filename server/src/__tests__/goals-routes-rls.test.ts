import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "company-1";

const mockGoalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
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
  goalService: () => mockGoalService,
  logActivity: mockLogActivity,
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: () => null,
}));

async function createApp() {
  const [{ errorHandler }, { goalRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/goals.js")>("../routes/goals.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      userId: "user-1",
      companyIds: [companyId],
      memberships: [{ companyId, status: "active", membershipRole: "admin" }],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", goalRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("goal routes RLS scoping", () => {
  beforeEach(() => {
    for (const mock of Object.values(mockGoalService)) mock.mockReset();
    mockLogActivity.mockReset();
    mockWithCompanyRls.mockClear();
  });

  it("lists company goals inside company RLS scope", async () => {
    mockGoalService.list.mockResolvedValue([{ id: "goal-1", companyId }]);

    const app = await createApp();
    const res = await request(app).get(`/api/companies/${companyId}/goals`);

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
    expect(mockGoalService.list).toHaveBeenCalledWith(companyId);
  });

  it("creates company goals and activity inside company RLS scope", async () => {
    mockGoalService.create.mockResolvedValue({
      id: "goal-1",
      companyId,
      title: "Launch",
      level: "company",
    });

    const app = await createApp();
    const res = await request(app)
      .post(`/api/companies/${companyId}/goals`)
      .send({ title: "Launch", level: "company" });

    expect(res.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
    expect(mockGoalService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ title: "Launch", level: "company" }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        action: "goal.created",
        entityId: "goal-1",
      }),
    );
  });

  it("checks company access before entering RLS scope", async () => {
    const app = await createApp();
    const res = await request(app).get("/api/companies/company-2/goals");

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockGoalService.list).not.toHaveBeenCalled();
  });
});
