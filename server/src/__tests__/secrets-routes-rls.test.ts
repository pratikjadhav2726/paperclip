import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSecretService = vi.hoisted(() => ({
  listProviders: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  rotate: vi.fn(),
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
  secretService: () => mockSecretService,
  logActivity: mockLogActivity,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ secretRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/secrets.js")>("../routes/secrets.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", secretRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("secret routes RLS scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecretService.listProviders.mockReturnValue(["local_encrypted"]);
    mockSecretService.list.mockResolvedValue([]);
    mockSecretService.create.mockResolvedValue({
      id: "secret-1",
      companyId: "company-1",
      name: "API_KEY",
      provider: "local_encrypted",
    });
  });

  it("lists secrets inside company RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const res = await request(app).get("/api/companies/company-1/secrets");

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockSecretService.list).toHaveBeenCalledWith("company-1");
  });

  it("creates secrets inside company RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });
    const res = await request(app)
      .post("/api/companies/company-1/secrets")
      .send({ name: "API_KEY", value: "secret-value" });

    expect(res.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockSecretService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ name: "API_KEY", value: "secret-value" }),
      expect.objectContaining({ userId: "board-user" }),
    );
  });

  it("checks company access before entering RLS scope for list", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-2"],
    });
    const res = await request(app).get("/api/companies/company-1/secrets");

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockSecretService.list).not.toHaveBeenCalled();
  });
});
