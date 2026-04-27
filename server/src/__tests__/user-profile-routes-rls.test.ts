import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "company-1";
const mockWithCompanyRls = vi.hoisted(() => vi.fn());

vi.mock("../services/company-rls.js", () => ({
  withCompanyRls: mockWithCompanyRls,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ userProfileRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/user-profiles.js")>("../routes/user-profiles.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", userProfileRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("user profile route RLS scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithCompanyRls.mockImplementation(async (_db, _companyId, operation) =>
      operation({
        select: vi.fn(() => ({ from: vi.fn() })),
      }),
    );
  });

  it("enters company RLS scope for company profile reads", async () => {
    mockWithCompanyRls.mockResolvedValue({
      user: {
        id: "user-1",
        slug: "dotta",
        name: "Dotta",
        email: "dotta@example.com",
        image: null,
        membershipRole: "owner",
        membershipStatus: "active",
        joinedAt: new Date().toISOString(),
      },
      stats: [],
      daily: [],
      recentIssues: [],
      recentActivity: [],
      topAgents: [],
      topProviders: [],
    });

    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      companyIds: [companyId],
      isInstanceAdmin: false,
    });
    const res = await request(app).get(`/api/companies/${companyId}/users/dotta/profile`);

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), companyId, expect.any(Function));
  });

  it("checks company access before entering RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      companyIds: ["company-2"],
      isInstanceAdmin: false,
    });
    const res = await request(app).get(`/api/companies/${companyId}/users/dotta/profile`);

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
  });
});
