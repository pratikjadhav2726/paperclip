import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  remove: vi.fn(),
  resolveByReference: vi.fn(),
}));
const mockSecretService = vi.hoisted(() => ({
  normalizeEnvBindingsForPersistence: vi.fn(),
}));
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockWithCompanyRls = vi.hoisted(() =>
  vi.fn(async (_db: unknown, _companyId: string, operation: (scopedDb: unknown) => Promise<unknown>) =>
    operation({ scoped: true }),
  ),
);

vi.mock("../services/company-rls.js", () => ({
  withCompanyRls: mockWithCompanyRls,
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: mockGetTelemetryClient,
}));

vi.mock("../services/index.js", () => ({
  environmentService: () => mockEnvironmentService,
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  secretService: () => mockSecretService,
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ projectRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/projects.js")>("../routes/projects.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", projectRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function buildProject() {
  return {
    id: "project-1",
    companyId: "company-1",
    urlKey: "project-1",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Project",
    description: null,
    status: "backlog",
    leadAgentId: null,
    targetDate: null,
    color: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: null,
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("project workspace routes RLS scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    mockProjectService.getById.mockResolvedValue(buildProject());
    mockProjectService.listWorkspaces.mockResolvedValue([
      {
        id: "workspace-1",
        companyId: "company-1",
        projectId: "project-1",
        name: "Workspace",
        sourceType: "local_path",
        cwd: "/tmp/project",
        repoUrl: null,
        repoRef: null,
        defaultRef: null,
        visibility: "default",
        setupCommand: null,
        cleanupCommand: null,
        remoteProvider: null,
        remoteWorkspaceRef: null,
        sharedWorkspaceKey: null,
        metadata: null,
        runtimeConfig: null,
        isPrimary: false,
        runtimeServices: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    mockProjectService.createWorkspace.mockResolvedValue({
      id: "workspace-1",
      name: "Workspace",
      cwd: "/tmp/project",
      isPrimary: false,
    });
    mockProjectService.updateWorkspace.mockResolvedValue({
      id: "workspace-1",
      name: "Workspace",
      cwd: "/tmp/project",
      isPrimary: false,
    });
    mockProjectService.removeWorkspace.mockResolvedValue({
      id: "workspace-1",
      name: "Workspace",
    });
    mockProjectService.remove.mockResolvedValue({
      ...buildProject(),
      id: "project-1",
    });
  });

  it("lists project workspaces inside company RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app).get("/api/projects/project-1/workspaces");

    expect(res.status).toBe(200);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockProjectService.listWorkspaces).toHaveBeenCalledWith("project-1");
  });

  it("creates project workspaces inside company RLS scope", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ name: "Workspace", sourceType: "local_path", cwd: "/tmp/project" });

    expect(res.status).toBe(201);
    expect(mockWithCompanyRls).toHaveBeenCalledWith(expect.anything(), "company-1", expect.any(Function));
    expect(mockProjectService.createWorkspace).toHaveBeenCalledWith("project-1", expect.any(Object));
  });

  it("rejects workspace creation before entering RLS scope when company access is missing", async () => {
    const app = await createApp({
      type: "board",
      userId: "board-user",
      companyIds: ["company-2"],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(app)
      .post("/api/projects/project-1/workspaces")
      .send({ name: "Workspace", sourceType: "local_path", cwd: "/tmp/project" });

    expect(res.status).toBe(403);
    expect(mockWithCompanyRls).not.toHaveBeenCalled();
    expect(mockProjectService.createWorkspace).not.toHaveBeenCalled();
  });
});
